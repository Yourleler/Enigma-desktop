import {
  withNativeEngineeringExecution,
  nativeEngineeringPolicy,
} from "./execution-policy.ts";
import { isReadOnlyPermissionMode } from "../../core/session-permission-mode.ts";
import fs from "node:fs/promises";
import path from "node:path";
import { SessionManager } from "../../lib/pi-sdk/index.ts";
import {
  Workspace,
  projectOverview,
  Artifacts,
  artifactPresentation,
  ProjectContext,
  DocumentationStore,
  TaskAcceptance,
  workbenchVerificationEvidence,
  workbenchRequests,
  RunObserver,
} from "enigma-next";
import { readJson, writeJson, safeId, redact, hash } from "enigma-next/storage";
import { WorkbenchSession, type Dialog } from "enigma-next/workbench-session";
import {
  domainAction,
  domainData,
  domainChoices,
  uiActions,
} from "enigma-next/workbench-domain";
import { createEnigmaExtension } from "enigma-next/pi-extension";
import { createProjectExtension } from "enigma-next/pi-project";
import { createRuntimeExtension } from "enigma-next/pi-runtime";
import { createDeliveryExtension } from "enigma-next/pi-delivery";
import { createReuseExtension } from "enigma-next/pi-reuse";
import { createCollaborationExtension } from "enigma-next/pi-collaboration";
import { createLearningExtension } from "enigma-next/pi-learning";
import { createMemoryExtension } from "enigma-next/pi-memory";
import { createMemoryDreamExtension } from "enigma-next/pi-memory-dream";
import { createDocumentationExtension } from "enigma-next/pi-documentation";
import { createTaskAcceptanceExtension } from "enigma-next/pi-task-acceptance";
import { createObserverExtension } from "enigma-next/pi-observer";
import { createHandoffExtension } from "enigma-next/pi-handoff";
import { createReviewExtension, runPiReview } from "enigma-next/pi-review";
import { createChangeReadingExtension } from "enigma-next/pi-change-reading";
import { collectUserNotes } from "enigma-next/pi-session";
import { PlanStore } from "enigma-next";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIDialogOptions,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  modelForPhase,
  validateModelPolicy,
  planningBlocksTool,
  type ModelPolicy,
} from "./model-policy.ts";
import { ConversationConductor, type ConductorLimits } from "./conductor.ts";
import { EngineeringGuardian } from "./guardian-host.ts";
import { EngineeringMemory } from "./memory-host.ts";
import type { GuardianConfig } from "enigma-next";

type PendingModel = {
  provider: string;
  id: string;
  revision: number;
  state: "pending" | "applied" | "failed" | "cancelled";
  error?: string;
};
type Binding = {
  root: string;
  memory: boolean;
  sessionPath: string;
  sessionId?: string;
  pendingModel?: PendingModel;
  modelPolicy?: ModelPolicy;
  kind?: "engineering" | "manager";
  guardian?: GuardianConfig;
  guardianEnabled?: boolean;
  guardianInterventions?: number;
  managedGrant?: { managerPath: string; root: string; models: string[] };
};
const hosts = new WeakMap<object, EngineeringHost>();

/** The only Hana-facing adapter. Engineering code never owns a second main session. */
export function engineeringHost(engine: any): EngineeringHost {
  let host = hosts.get(engine);
  if (!host) {
    host = new EngineeringHost(engine);
    hosts.set(engine, host);
  }
  return host;
}

function scopedFactory(
  factory: (pi: ExtensionAPI) => void | Promise<void>,
  workspace: Workspace,
  engine: any,
  sessionPath: string,
) {
  return (pi: ExtensionAPI) => {
    const scope = (ctx: ExtensionContext) =>
      Object.assign(Object.create(Object.getPrototypeOf(ctx)), ctx, {
        cwd: workspace.root,
      });
    const proxy = new Proxy(pi, {
      get(target, key) {
        if (key === "on")
          return (name: any, handler: any) =>
            target.on(name, (async (event: any, ctx: ExtensionContext) => {
              const result = await withNativeEngineeringExecution(
                engine,
                workspace,
                sessionPath,
                async () => handler(event, scope(ctx)),
              );
              if (
                name === "before_agent_start" &&
                typeof result?.systemPrompt === "string" &&
                result.systemPrompt.startsWith(event.systemPrompt)
              ) {
                // Keep the host's signed/cacheable prefix stable. Dynamic repository facts remain turn context.
                const content = result.systemPrompt.slice(
                  event.systemPrompt.length,
                );
                return {
                  ...result,
                  systemPrompt: event.systemPrompt,
                  message: {
                    customType: "enigma.engineering-context",
                    content,
                    display: false,
                  },
                };
              }
              return result;
            }) as any);
        if (key === "registerCommand")
          return (name: string, definition: any) =>
            target.registerCommand(name, {
              ...definition,
              handler: (args: string, ctx: any) =>
                withNativeEngineeringExecution(
                  engine,
                  workspace,
                  sessionPath,
                  async () => definition.handler(args, scope(ctx)),
                ),
            });
        if (key === "registerTool")
          return (definition: any) =>
            target.registerTool({
              ...definition,
              execute: (...args: any[]) => {
                if (
                  engine.pluginManager?.getPlugin &&
                  engine.pluginManager.getPlugin("enigma")?.status !== "loaded"
                )
                  throw new Error("Engineering plugin is disabled");
                if (args[4]) args[4] = scope(args[4]);
                return withNativeEngineeringExecution(
                  engine,
                  workspace,
                  sessionPath,
                  async () => {
                    const result = await definition.execute(...args);
                    if (
                      definition.name === "artifact_manage" &&
                      args[1]?.action === "add"
                    ) {
                      const files =
                        await engineeringHost(engine).registerArtifacts(
                          sessionPath,
                        );
                      result.details = { ...result.details, mediaItems: files };
                    }
                    return result;
                  },
                );
              },
            });
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    return factory(proxy);
  };
}

export class EngineeringHost {
  private bindings?: Record<string, Binding>;
  private loading?: Promise<Record<string, Binding>>;
  private readonly sessions = new Map<string, NativeEngineeringSession>();
  private readonly overviews = new Map<
    string,
    { at: number; value: unknown }
  >();
  readonly dialogs = new Map<string, { dialog: Dialog; sessionPath: string }>();
  readonly engine: any;
  private bindingWrites: Promise<void> = Promise.resolve();
  private defaultModelPolicy?: ModelPolicy;
  private conductors = new Map<string, ConversationConductor>();
  readonly guardian = new EngineeringGuardian(this);
  readonly memoryWork = new EngineeringMemory(this);
  constructor(engine: any) {
    this.engine = engine;
  }
  isBusy(sessionPath: string) {
    return this.sessions.get(sessionPath)?.operation?.state === "running";
  }
  hasForegroundWork(){
    return [...this.sessions.values()].some(session=>!session.nativeSession.isIdle||session.nativeSession.isCompacting||session.operation?.state==='running');
  }
  async restoreSidecars() {
    const bindings = await this.load();
    for (const binding of Object.values(bindings))
      if (binding.guardianEnabled && binding.guardian) {
        try {
          await this.guardian.start(
            binding.sessionPath,
            binding.guardian,
            true,
          );
        } catch (error) {
          this.publish(binding.sessionPath, "guardian_update", {
            message: "独立监护未能恢复，需要核对宿主和旧状态",
            error: String(error),
          });
        }
      }
  }
  async dispose() {
    await this.guardian.close();
    await this.memoryWork.close();
    await Promise.allSettled(
      [...this.conductors.values()].map((manager) => manager.shutdown()),
    );
    for (const id of this.dialogs.keys())
      this.engine.confirmStore?.resolve(id, "rejected");
    await Promise.all(
      [...this.sessions.values()].map((controller) => controller.detach()),
    );
    this.sessions.clear();
    this.dialogs.clear();
    this.overviews.clear();
  }
  conductor(sessionPath: string) {
    let manager = this.conductors.get(sessionPath);
    if (!manager) {
      manager = new ConversationConductor(this, sessionPath);
      this.conductors.set(sessionPath, manager);
    }
    return manager;
  }
  async createConductor(sourcePath: string, limits?: Partial<ConductorLimits>, options: {inheritUserRequirements?:boolean} = {}) {
    const binding = await this.binding(sourcePath);
    if (!binding)
      throw new Error("Select an engineering project as the manager scope");
    const source =
        this.engine.getSessionByPath(sourcePath) ||
        (await this.engine.ensureSessionLoaded(sourcePath)),
      workspace = await Workspace.open(binding.root);
    const manager = SessionManager.create(
        binding.root,
        path.dirname(sourcePath),
      ),
      targetPath = manager.getSessionFile();
    await this.saveBinding(targetPath, { root: binding.root, memory: false });
    const targetBinding = await this.binding(targetPath);
    targetBinding!.kind = "manager";
    await this.saveBinding(targetPath, targetBinding!);
    const config: ConductorLimits = {
      maxConcurrent: limits?.maxConcurrent ?? 3,
      maxTasks: limits?.maxTasks ?? 8,
      writableRepos:
        limits?.writableRepos ??
        workspace.config.repos
          .filter((repo) => repo.access === "write")
          .map((repo) => repo.id),
      allowRewind: limits?.allowRewind ?? false,
      allowedModels: limits?.allowedModels ?? [
        `${source.model.provider}/${source.model.id}`,
      ],
    };
    // Initialize ownership before the detached runtime loads its manager extension.
    const created = await this.engine.createDetachedSession({
      sessionMgr: manager,
      cwd: binding.root,
      memoryEnabled: false,
      model: source.model,
      agentId: this.engine.resolveSessionOwnership(sourcePath).agentId,
      permissionMode: "auto",
      visibleInSessionList: true,
      sessionKind: "enigma-manager",
    });
    await this.saveBinding(created.sessionPath, {
      root: binding.root,
      memory: false,
    });
    const createdBinding = await this.binding(created.sessionPath);
    createdBinding!.kind = "manager";
    await this.saveBinding(created.sessionPath, createdBinding!);
    await this.conductor(created.sessionPath).initialize(binding.root, config);
    await this.engine.reloadSessionRuntime(created.sessionPath, {
      refreshCapabilitySnapshots: true,
    });
    if(options.inheritUserRequirements){
      const nativeManager=this.engine.getSessionByPath(created.sessionPath)?.sessionManager;
      if(!nativeManager)throw new Error('Created manager runtime is unavailable');
      const managerId=nativeManager.getSessionId();
      const statePath=path.join(workspace.data,`session-${safeId(managerId)}.json`);
      const previous=await readJson<Record<string,any>>(statePath);
      const sourceNotes=[...collectUserNotes(source.sessionManager).values()];
      await writeJson(statePath,{...previous,requirements:[...new Set([...(previous.requirements||[]),...sourceNotes.map(note=>note.text)])]});
      nativeManager.appendCustomEntry('enigma.manager-source',{sourceSession:source.sessionManager.getSessionId(),entries:sourceNotes.map(note=>note.id),purpose:'Original user requirements retained for authorized isolated repair; not a new user instruction.'});
    }
    await this.engine.saveSessionTitle(created.sessionPath, "任务编排管家");
    return {
      sessionPath: created.sessionPath,
      sessionId: created.sessionId,
      kind: "manager",
      sourceSession: source.sessionManager.getSessionId(),
      limits: config,
    };
  }
  isEnabled() {
    if (!this.engine.pluginManager?.getPlugin) return true;
    return this.engine.pluginManager.getPlugin("enigma")?.status === "loaded";
  }
  private get configPath() {
    return path.join(this.engine.hanakoHome, "user", "enigma-bindings.json");
  }
  private async load() {
    if (this.bindings) return this.bindings;
    if (!this.loading)
      this.loading = (async () => {
        let value: {
          schema: number;
          sessions: Record<string, Binding>;
          defaultModelPolicy?: ModelPolicy;
        };
        try {
          value = await readJson(this.configPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          value = { schema: 1, sessions: {} };
        }
        if (
          value.schema !== 1 ||
          !value.sessions ||
          typeof value.sessions !== "object" ||
          Array.isArray(value.sessions) ||
          Object.values(value.sessions).some(
            (binding) =>
              !binding ||
              typeof binding.root !== "string" ||
              !path.isAbsolute(binding.root) ||
              typeof binding.memory !== "boolean" ||
              typeof binding.sessionPath !== "string",
          )
        )
          throw new Error("Invalid engineering session bindings");
        this.bindings = value.sessions;
        this.defaultModelPolicy = value.defaultModelPolicy;
        return this.bindings;
      })();
    try {
      return await this.loading;
    } catch (error) {
      this.loading = undefined;
      throw error;
    }
  }
  async binding(sessionPath: string): Promise<Binding | null> {
    const bindings = await this.load(),
      id = this.engine.getSessionIdForPath?.(sessionPath);
    return (id && bindings[id]) || bindings[sessionPath] || null;
  }
  async saveBinding(
    sessionPath: string,
    input: Pick<Binding, "root" | "memory">,
  ) {
    const bindings = await this.load(),
      sessionId = this.engine.getSessionIdForPath?.(sessionPath) || undefined;
    const key = sessionId || sessionPath;
    bindings[key] = { ...bindings[key], ...input, sessionPath, sessionId };
    if (sessionId) delete bindings[sessionPath];
    const value = JSON.parse(
      JSON.stringify({
        schema: 1,
        sessions: bindings,
        defaultModelPolicy: this.defaultModelPolicy,
      }),
    );
    this.bindingWrites = this.bindingWrites
      .catch(() => {})
      .then(() => writeJson(this.configPath, value));
    await this.bindingWrites;
  }
  async getDefaultModelPolicy() {
    await this.load();
    return this.defaultModelPolicy ? structuredClone(this.defaultModelPolicy) : null;
  }
  async configureDefaultModelPolicy(input: unknown) {
    await this.load();
    const policy = validateModelPolicy(input);
    for (const role of [
      policy.execution,
      policy.planning,
      policy.review,
    ].filter(Boolean))
      if (!(await this.engine.resolveModelWithCredentialsFresh(role)))
        throw new Error(`Model ${role!.id} is unavailable`);
    this.defaultModelPolicy = policy;
    const value = JSON.parse(
      JSON.stringify({
        schema: 1,
        sessions: this.bindings,
        defaultModelPolicy: policy,
      }),
    );
    this.bindingWrites = this.bindingWrites
      .catch(() => {})
      .then(() => writeJson(this.configPath, value));
    await this.bindingWrites;
    return policy;
  }
  async requestModel(
    sessionPath: string,
    provider: string,
    id: string,
    source = "manual",
  ) {
    const binding = await this.binding(sessionPath);
    if (!binding) throw new Error("Select an engineering workspace first");
    await this.assertManagedModel(sessionPath, provider, id);
    const model = await this.engine.resolveModelWithCredentialsFresh({
      provider,
      id,
    });
    if (!model)
      throw new Error(
        "Selected model is unavailable or has no configured credentials",
      );
    const pendingModel: PendingModel = {
      provider,
      id,
      revision: (binding.pendingModel?.revision || 0) + 1,
      state: "pending",
    };
    if (source === "manual" && binding.modelPolicy) {
      const key =
        binding.modelPolicy.phase === "planning"
          ? "planning"
          : binding.modelPolicy.phase === "review"
            ? "review"
            : "execution";
      binding.modelPolicy[key] = { ...binding.modelPolicy[key], provider, id };
    }
    binding.pendingModel = pendingModel;
    await this.saveBinding(sessionPath, binding);
    const native =
      this.engine.getSessionByPath(sessionPath) ||
      (await this.engine.ensureSessionLoaded(sessionPath));
    if (native.isIdle && !native.isCompacting)
      await this.applyRequestedModel(sessionPath);
    this.publish(sessionPath, "model_selection", pendingModel);
    return {
      selection: pendingModel,
      effectiveAt: pendingModel.state === "applied" ? "now" : "next-request",
    };
  }
  async configureModelPolicy(sessionPath: string, input: unknown) {
    const binding = await this.binding(sessionPath);
    if (!binding) throw new Error("Select an engineering workspace first");
    const policy = validateModelPolicy(input);
    for (const role of [
      policy.execution,
      policy.planning,
      policy.review,
    ].filter(Boolean)) {
      await this.assertManagedModel(sessionPath, role!.provider, role!.id);
      if (!(await this.engine.resolveModelWithCredentialsFresh(role)))
        throw new Error(`Model ${role!.provider}/${role!.id} is unavailable`);
    }
    policy.requests = binding.modelPolicy?.requests || 0;
    policy.maxRequests ??= binding.modelPolicy?.maxRequests;
    binding.modelPolicy = policy;
    await this.saveBinding(sessionPath, binding);
    const role = modelForPhase(policy);
    await this.requestModel(sessionPath, role.provider, role.id, "phase");
    return policy;
  }
  async modelPhase(sessionPath: string, phase: ModelPolicy["phase"]) {
    const binding = await this.binding(sessionPath),
      policy = binding?.modelPolicy;
    if (!policy)
      throw new Error("Configure planning/execution model roles first");
    policy.phase = phase;
    policy.failures = 0;
    await this.saveBinding(sessionPath, binding!);
    const role = modelForPhase(policy);
    await this.requestModel(sessionPath, role.provider, role.id, "phase");
    return { ...policy, selected: role };
  }
  modelPolicyFactory(sessionPath: string) {
    return (pi: ExtensionAPI) => {
      pi.on("session_start", () => {
        pi.events.emit("enigma:managed-tools", {
          owner: "native-model-policy",
          names: ["agent_phase"],
        });
        pi.setActiveTools([
          ...new Set([...pi.getActiveTools(), "agent_phase"]),
        ]);
      });
      pi.on("tool_call", async (event) => {
        const policy = (await this.binding(sessionPath))?.modelPolicy;
        if (
          policy?.mode !== "single" &&
          policy?.phase === "planning" &&
          planningBlocksTool(
            event.toolName,
            event.input as Record<string, unknown>,
          )
        )
          return {
            block: true,
            reason:
              "Planning phase has read-only source tools. Build the task plan, then use agent_phase execute before writing or running source commands, recipes, services or delegated execution.",
          };
      });
      pi.on("before_agent_start", async (event) => {
        const policy = (await this.binding(sessionPath))?.modelPolicy;
        return policy
          ? {
              systemPrompt:
                event.systemPrompt +
                `\nConfigured model separation: ${policy.mode}, phase ${policy.phase}. In planning, inspect source and create task_plan; call agent_phase execute after the plan is ready. Execution may call agent_phase replan when evidence disproves the route, or review for an independent review phase. Original checks and user requirements remain authoritative.\n`,
            }
          : undefined;
      });
      pi.on("tool_execution_end", async (event) => {
        const binding = await this.binding(sessionPath),
          policy = binding?.modelPolicy;
        if (
          !policy ||
          policy.mode !== "adaptive" ||
          policy.phase !== "execution" ||
          event.toolName === "agent_phase"
        )
          return;
        if (
          event.isError ||
          ["failed", "timeout"].includes(
            event.result?.structuredContent?.status as string,
          )
        )
          policy.failures++;
        else policy.failures = 0;
        await this.saveBinding(sessionPath, binding!);
        if (policy.failures >= 3) {
          await this.modelPhase(sessionPath, "planning");
          pi.sendMessage(
            {
              customType: "enigma.model-escalation",
              display: true,
              content:
                "Repeated tool failures triggered the configured planning model. Inspect actual errors and revise the plan; do not change the original acceptance criteria.",
            },
            { triggerTurn: false },
          );
        }
      });
      pi.registerTool({
        name: "agent_phase",
        label: "Planning and execution phase",
        description:
          "Inspect configured model roles or switch at the next model request. execute requires a current task plan; replan returns to read-only planning. review runs the configured reviewer in a separate context with only frozen source reading, preserving the main model/context/permissions and charging the shared request budget. Optional baseline selects a current workspace checkpoint. Does not create authority or alter acceptance.",
        executionMode: "sequential",
        parameters: Type.Object({
          action: Type.Union([
            Type.Literal("status"),
            Type.Literal("execute"),
            Type.Literal("replan"),
            Type.Literal("review"),
          ]),
          reason: Type.Optional(Type.String()),
          baseline: Type.Optional(Type.String()),
        }),
        execute: async (_id, args, signal, _update, ctx) => {
          const binding = await this.binding(sessionPath);
          if (!binding?.modelPolicy)
            throw new Error("No model separation configured");
          if (args.action === "execute") {
            const workspace = await Workspace.open(binding.root),
              state = await readJson<{ planFile: string }>(
                path.join(
                  workspace.data,
                  `session-${safeId(ctx.sessionManager.getSessionId())}.json`,
                ),
              );
            if (!(await new PlanStore(workspace, state.planFile).current()))
              throw new Error(
                "Create a source-grounded task plan before entering execution",
              );
          }
          let value: unknown;
          if (args.action === "review") {
            const workspace = await Workspace.open(binding.root),
              policy = binding.modelPolicy;
            const planState = await readJson<{
              planFile: string;
              evidence: string[];
            }>(
              path.join(
                workspace.data,
                `session-${safeId(ctx.sessionManager.getSessionId())}.json`,
              ),
            );
            const plan = await new PlanStore(
              workspace,
              planState.planFile,
            ).current();
            const baseline =
              args.baseline ||
              (await workspace.checkpoints()).find(
                (checkpoint) =>
                  checkpoint.session === ctx.sessionManager.getSessionId(),
              )?.id;
            if (!baseline)
              throw new Error(
                "Select a source checkpoint for independent review",
              );
            const selected =
              policy.review || policy.planning || policy.execution;
            await this.assertManagedModel(
              sessionPath,
              selected.provider,
              selected.id,
            );
            const requirements = [
              ...collectUserNotes(ctx.sessionManager).values(),
            ].map((note) => ({
              text: note.text,
              reference: `pi-user:${note.id}`,
            }));
            value = await runPiReview(
              workspace,
              {
                baseline,
                goal:
                  plan?.goal ||
                  args.reason ||
                  "Review the current changes against original user requirements",
                requirements,
                task:ctx.sessionManager.getSessionId(),planFile:planState.planFile,
                evidence: (planState.evidence || []).slice(-30),
              },
              {
                modelRuntime: await this.engine.modelRegistry.ready(),
                provider: selected.provider,
                model: selected.id,
                agentDir: path.dirname(this.engine.modelsJsonPath),
                signal,
                thinking: selected.thinking,
                onRequest: async () => {
                  const current = await this.binding(sessionPath),
                    budget = current!.modelPolicy!;
                  if (
                    budget.maxRequests !== undefined &&
                    budget.requests >= budget.maxRequests
                  )
                    throw new Error("Configured model-call budget reached");
                  budget.requests++;
                  await this.saveBinding(sessionPath, current!);
                },
              },
            );
            pi.appendEntry("enigma.independent-model-review", value);
          } else
            value =
              args.action === "status"
                ? binding.modelPolicy
                : await this.modelPhase(
                    sessionPath,
                    args.action === "execute" ? "execution" : "planning",
                  );
          return {
            content: [{ type: "text", text: JSON.stringify(value) }],
            details: value,
            structuredContent: JSON.parse(JSON.stringify(value)),
          };
        },
      });
    };
  }
  async applyRequestedModel(sessionPath: string) {
    const binding = await this.binding(sessionPath),
      selection = binding?.pendingModel;
    if (!selection || selection.state !== "pending") return;
    try {
      await this.assertManagedModel(
        sessionPath,
        selection.provider,
        selection.id,
      );
      await this.engine.switchSessionModel(
        sessionPath,
        selection.id,
        selection.provider,
      );
      selection.state = "applied";
    } catch (error) {
      selection.state = "failed";
      selection.error = String(error);
    }
    const current = await this.binding(sessionPath);
    if (current?.pendingModel?.revision === selection.revision) {
      current.pendingModel = selection;
      await this.saveBinding(sessionPath, current);
    }
    this.publish(sessionPath, "model_selection", selection);
  }
  async cancelRequestedModel(sessionPath:string){
    const binding=await this.binding(sessionPath);
    if(binding?.pendingModel?.state==='pending'){
      binding.pendingModel={...binding.pendingModel,revision:binding.pendingModel.revision+1,state:'cancelled'};
      await this.saveBinding(sessionPath,binding);this.publish(sessionPath,'model_selection',binding.pendingModel);
    }
    return {selection:binding?.pendingModel||null};
  }
  async assertManagedModel(sessionPath: string, provider: string, id: string) {
    const grant = (await this.binding(sessionPath))?.managedGrant;
    if (grant && !grant.models.includes(`${provider}/${id}`))
      throw new Error("Worker model is outside its current manager grant");
  }
  async setManagedModels(
    sessionPath: string,
    managerPath: string,
    models: string[],
  ) {
    const binding = await this.binding(sessionPath);
    if (!binding) throw new Error("Worker workspace is not connected");
    if (
      binding.managedGrant &&
      binding.managedGrant.managerPath !== managerPath
    )
      throw new Error("Worker manager ownership mismatch");
    binding.managedGrant = {
      managerPath,
      root: binding.root,
      models: [...models],
    };
    if (
      binding.pendingModel &&
      !models.includes(
        `${binding.pendingModel.provider}/${binding.pendingModel.id}`,
      )
    )
      binding.pendingModel = {
        ...binding.pendingModel,
        state: "failed",
        error: "Manager model grant was revoked",
      };
    const policy = binding.modelPolicy;
    if (
      policy &&
      [policy.execution, policy.planning, policy.review]
        .filter(Boolean)
        .some((role) => !models.includes(`${role!.provider}/${role!.id}`)) &&
      models.length
    ) {
      const slash = models[0]!.indexOf("/");
      binding.modelPolicy = {
        mode: "single",
        phase: "execution",
        execution: {
          provider: models[0]!.slice(0, slash),
          id: models[0]!.slice(slash + 1),
        },
        requests: policy.requests,
        failures: 0,
        maxRequests: policy.maxRequests,
      };
    }
    await this.saveBinding(sessionPath, binding);
  }
  async inherit(sourcePath: string, targetPath: string) {
    const binding = await this.binding(sourcePath);
    if (!binding || !this.isEnabled()) return;
    const workspace = await Workspace.open(binding.root);
    const source =
      this.engine.getSessionByPath(sourcePath)?.sessionManager ||
      SessionManager.open(sourcePath);
    const target = SessionManager.open(targetPath);
    const previous = await readJson<any>(
      path.join(
        workspace.data,
        `session-${safeId(source.getSessionId())}.json`,
      ),
    );
    const sourceNotes = collectUserNotes(source),
      targetNotes = collectUserNotes(target);
    const surviving = new Set(targetNotes.keys()),
      texts = new Set([...targetNotes.values()].map((note) => note.text));
    const requirementEntries = [
      ...new Set([
        ...(previous.requirementEntries || []),
        ...source
          .getBranch()
          .filter(
            (entry) =>
              entry.type === "message" && entry.message.role === "user",
          )
          .map((entry) => entry.id),
      ]),
    ];
    const missing = requirementEntries
      .filter((id) => !surviving.has(id))
      .map((id) => {
        const note = sourceNotes.get(id);
        if (!note)
          throw new Error(
            "Latest original user requirement is missing in the source conversation",
          );
        return note.text;
      });
    const requirements = [
      ...new Set([...(previous.requirements || []), ...missing]),
    ].filter((text) => !texts.has(text));
    const planFile = `active-plan-${safeId(target.getSessionId())}.json`;
    const plan = await new PlanStore(workspace, previous.planFile).current();
    if (plan)
      await new PlanStore(workspace, planFile).create({
        goal: plan.goal,
        steps: plan.steps.map((step) => ({
          id: step.id,
          repo: step.repo,
          goal: step.goal,
          requires: step.requires,
          checks: step.checks,
        })),
      });
    await writeJson(
      path.join(
        workspace.data,
        `session-${safeId(target.getSessionId())}.json`,
      ),
      {
        schema: 1,
        mode: "managed",
        requirements,
        requirementEntries: requirementEntries.filter((id) =>
          surviving.has(id),
        ),
        reviewEntries: requirements.map((_text, index) => `legacy-${index}`),
        reviewCursor: "0:0",
        requests: 0,
        inheritedRequests:
          (previous.requests || 0) + (previous.inheritedRequests || 0),
        corrections: 0,
        evidence: [],
        lastVerification: "unverified",
        sessionFile: targetPath,
        planFile,
        handoff: { mode: "continue", sourceSession: source.getSessionId() },
      },
    );
    await this.saveBinding(targetPath, binding);
    await this.engine.reloadSessionRuntime(targetPath, {
      refreshCapabilitySnapshots: true,
    });
  }
  async prepare(sessionPath: string | null) {
    if (!sessionPath || !this.isEnabled()) return null;
    const binding = await this.binding(sessionPath);
    if (!binding) return null;
    const workspace = await Workspace.open(binding.root);
    nativeEngineeringPolicy(this.engine, workspace, sessionPath);
    const nativeManager = SessionManager.open(sessionPath);
    const statePath = path.join(
      workspace.data,
      `session-${safeId(nativeManager.getSessionId())}.json`,
    );
    try {
      await fs.access(statePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await writeJson(statePath, {
        schema: 1,
        requirements: [],
        requirementEntries: [],
        reviewEntries: [],
        evidence: [],
        requests: 0,
        corrections: 0,
        mode: "managed",
        lastVerification: "unverified",
        planFile: `active-plan-${safeId(nativeManager.getSessionId())}.json`,
      });
    }
    const agentDir = path.dirname(this.engine.modelsJsonPath);
    const approval = "ask" as const;
    if (binding.kind === "manager")
      return {
        workspace,
        binding,
        factories: [
          this.conductor(sessionPath).extension(),
          createObserverExtension({ enabled: true, root: workspace.root }),
        ].map((factory) =>
          scopedFactory(factory, workspace, this.engine, sessionPath),
        ),
      };
    const factories = [
      createEnigmaExtension({ workspace, approval, managed: true }),
      createProjectExtension({ workspace }),
      createRuntimeExtension({ workspace, approval }),
      createDeliveryExtension({ workspace }),
      createReuseExtension({ workspace, approval }),
      createCollaborationExtension({ workspace, approval, agentDir }),
      createLearningExtension({
        workspace,
        approval,
        knowledge: binding.memory,
      }),
      createMemoryExtension({ workspace, enabled: binding.memory }),
      createMemoryDreamExtension({ workspace, enabled: binding.memory }),
      createDocumentationExtension({ workspace, enabled: true }),
      createTaskAcceptanceExtension({ workspace }),
      createObserverExtension({ enabled: true, root: workspace.root }),
      createHandoffExtension({ workspace }),
      createReviewExtension({
        workspace,
        agentDir,
        modelRuntime: await this.engine.modelRegistry.ready(),
      }),
      createChangeReadingExtension({ workspace }),
    ];
    return {
      workspace,
      binding,
      factories: [...factories, this.modelPolicyFactory(sessionPath)].map(
        (factory) =>
          scopedFactory(factory, workspace, this.engine, sessionPath),
      ),
    };
  }
  async attach(sessionPath: string, session: any) {
    const binding = await this.binding(sessionPath);
    if (!binding) return null;
    const previous = this.sessions.get(sessionPath);
    if (previous?.runtime.session === session) return previous;
    await previous?.detach();
    const workspace = await Workspace.open(binding.root);
    nativeEngineeringPolicy(this.engine, workspace, sessionPath);
    const models = await this.engine.modelRegistry.ready();
    const controller = new NativeEngineeringSession(
      this,
      sessionPath,
      session,
      workspace,
      models,
      binding,
    );
    this.sessions.set(sessionPath, controller);
    try {
      await controller.open();
      return controller;
    } catch (error) {
      this.sessions.delete(sessionPath);
      throw error;
    }
  }
  async controller(sessionPath: string) {
    if (!this.isEnabled()) throw new Error("Engineering plugin is disabled");
    const session =
      this.engine.getSessionByPath(sessionPath) ||
      (await this.engine.ensureSessionLoaded(sessionPath));
    if (!session) throw new Error("Native session unavailable");
    const controller = await this.attach(sessionPath, session);
    if (!controller)
      throw new Error(
        "Select an engineering workspace for this conversation first",
      );
    controller.chat.provider = session.model?.provider || "";
    controller.chat.model = session.model?.id || "";
    return controller;
  }
  async connect(sessionPath: string, root: string, memory = false) {
    if (!this.isEnabled()) throw new Error("Engineering plugin is disabled");
    const session =
      this.engine.getSessionByPath(sessionPath) ||
      (await this.engine.ensureSessionLoaded(sessionPath));
    if (!session?.isIdle)
      throw new Error(
        "Wait for or cancel active work before changing the engineering workspace",
      );
    const workspace = await Workspace.open(root);
    if (!workspace.config.repos.length) {
      const isGitRoot = await fs.access(path.join(workspace.root, ".git")).then(
        () => true,
        (error) => {
          if (error.code !== "ENOENT") throw error;
          return false;
        },
      );
      if (isGitRoot)
        await workspace.exclusive(() =>
          workspace.addRepo("main", workspace.root, {
            role: "主要工程仓库",
            access: "write",
          }),
        );
    }
    const previous = await this.binding(sessionPath);
    if (previous?.managedGrant && workspace.root !== previous.managedGrant.root)
      throw new Error("Managed worker cannot change its assigned workspace");
    await this.saveBinding(sessionPath, { root: workspace.root, memory });
    if (!previous && this.defaultModelPolicy)
      await this.configureModelPolicy(sessionPath, this.defaultModelPolicy);
    try {
      await this.engine.reloadSessionRuntime(sessionPath, {
        refreshCapabilitySnapshots: true,
      });
    } catch (error) {
      if (previous) await this.saveBinding(sessionPath, previous);
      else {
        const bindings = await this.load(),
          id = this.engine.getSessionIdForPath?.(sessionPath);
        if (id) delete bindings[id];
        delete bindings[sessionPath];
        await writeJson(this.configPath, { schema: 1, sessions: bindings });
      }
      throw new Error(
        `Engineering workspace was not switched: ${String(error)}`,
      );
    }
    this.overviews.delete(sessionPath);
    return this.snapshot(sessionPath);
  }
  async choices(sessionPath: string, sources: string[], query = '') {
    const controller = await this.controller(sessionPath);
    return controller.safeSnapshot(await domainChoices(controller, sources, query));
  }
  async snapshot(sessionPath: string) {
    if (!this.isEnabled())
      return {
        connected: false,
        disabled: true,
        groups: engineeringGroups,
        actions: [],
      };
    const binding = await this.binding(sessionPath);
    if (!binding)
      return {
        connected: false,
        groups: engineeringGroups,
        actions: uiActions,
      };
    const controller = await this.controller(sessionPath);
    const cached = this.overviews.get(sessionPath);
    const overview =
      cached && Date.now() - cached.at < 10000
        ? cached.value
        : await projectOverview(controller.options.workspace, {
            task: controller.chat.session,
          });
    if (!cached || cached.value !== overview)
      this.overviews.set(sessionPath, { at: Date.now(), value: overview });
    return controller.safeSnapshot({
      connected: true,
      root: binding.root,
      memory: binding.memory,
      groups: engineeringGroups,
      actions: uiActions,
      sessionPath,
      sessionId: this.engine.getSessionIdForPath?.(sessionPath),
      overview,
      modelSelection: binding.pendingModel,
      modelPolicy: binding.modelPolicy,
      kind: binding.kind || "engineering",
      conductorSummary:
        binding.kind === "manager"
          ? await this.conductor(sessionPath).summary()
          : undefined,
      state: controller.snapshot(),
      dialogs: [...this.dialogs.values()]
        .filter((item) => item.sessionPath === sessionPath)
        .map((item) => item.dialog),
    });
  }
  async data(sessionPath: string, group: string, query: string,options:{offset?:number}={}) {
    const controller = await this.controller(sessionPath);
    const workspace = controller.options.workspace;
    if (group === "conductor") {
      const manager = this.conductor(sessionPath);
      return { ...(await manager.status()), summary: await manager.summary() };
    }
    if (group === "documents") {
      const documents = new DocumentationStore(workspace);
      return controller.safeSnapshot({
        items: await documents.list(),
        consistency: await documents.consistency(),
      });
    }
    if (group === "acceptance") {
      const native = this.engine.getSessionByPath(sessionPath),
        notes = [...collectUserNotes(native.sessionManager).values()],
        state = await readJson<{
          planFile?: string;
          lastCheckEvidence?: string;
        }>(
          path.join(
            workspace.data,
            `session-${safeId(native.sessionManager.getSessionId())}.json`,
          ),
        );
      return controller.safeSnapshot(
        await new TaskAcceptance(
          workspace,
          native.sessionManager.getSessionId(),
        ).inspect(notes, {
          planFile: state.planFile,
          verification: workbenchVerificationEvidence(native.sessionManager.getBranch(),state.lastCheckEvidence),
          workbenchRequests:workbenchRequests(native.sessionManager.getEntries()),
        }),
      );
    }
    if (group === "project")
      return controller.safeSnapshot(
        await projectOverview(workspace, { task: controller.chat.session }),
      );
    if (group === "materials")
      return controller.safeSnapshot(
        await new ProjectContext(workspace)
          .search(query, { task: controller.chat.session }, 30)
          .then((result) => ({ ...result, query })),
      );
    if (group === "artifacts") {
      const catalog = await new Artifacts(workspace).catalog(controller.chat.session);
      return controller.safeSnapshot({ ...catalog, items: catalog.items.map(
          (item) => ({
            ...item.record,
            sourceCurrent: item.sourceCurrent,
            evidenceStatus: item.evidence,
          }),
        ) });
    }
    if (group === "choices") {
      const choices = (await domainData(controller, group, query)) as object;
      return controller.safeSnapshot({
        ...choices,
        checkpoints: await workspace.checkpoints(),
        materials: await new ProjectContext(workspace)
          .search(query, { task: controller.chat.session }, 30)
          .then((result) => result.items),
        entries: controller.snapshot().messages,
      });
    }
    return controller.safeSnapshot(await domainData(controller, group, query,options));
  }
  async registerArtifacts(sessionPath: string) {
    const controller = this.sessions.get(sessionPath);
    if (!controller) return [];
    const artifacts = new Artifacts(controller.options.workspace),
      files = [];
    for (const artifact of await artifacts.list(controller.chat.session)) {
      const record = artifact.record;
      const file = this.engine.registerSessionFile({
        sessionPath,
        sessionId: this.engine.getSessionIdForPath(sessionPath),
        filePath: artifact.path,
        label: record.title + record.extension,
        origin: "plugin_output",
        storageKind: "external",
      });
      files.push({
        type: "session_file",
        fileId: file.fileId || file.id,
        sessionId: this.engine.getSessionIdForPath(sessionPath),
        sessionPath,
        filePath: artifact.path,
        label: record.title + record.extension,
      });
    }
    return files;
  }
  async action(
    sessionPath: string,
    action: string,
    args: Record<string, unknown>,
  ) {
    const definition = uiActions.find((item) => item.id === action);
    if (!definition) throw new Error("Unknown engineering action");
    const controller = await this.controller(sessionPath);
    if (
      definition.effect &&
      isReadOnlyPermissionMode(
        this.engine.getSessionPermissionMode(sessionPath),
      )
    )
      throw new Error("Current session is read-only");
    if (!controller.snapshot().idle)
      throw new Error(
        "Wait for or cancel current work before starting another operation",
      );
    void controller
      .perform(
        definition.title,
        (signal) =>
          withNativeEngineeringExecution(
            this.engine,
            controller.options.workspace,
            sessionPath,
            async () => {
              const result = await domainAction(
                controller,
                action,
                args,
                signal,
              );
              if(action==='package-restore')return this.registerRestoredPackage(sessionPath,result,controller.nativeSession);
              if (action !== "artifact-add") return result;
              return {
                ...(result as object),
                sessionFiles: await this.registerArtifacts(sessionPath),
              };
            },
          ),
        { action, args },
      )
      .catch((error) =>
        this.publish(sessionPath, "operation_error", { error: String(error) }),
      )
      .finally(() => this.overviews.delete(sessionPath));
    // Polling keeps approval/cancellation available while long operations are running.
    return { operation: controller.operation, sessionPath };
  }
  async registerRestoredPackage(sourcePath:string,value:unknown,sourceSession:any) {
    const result=value as any,start=result?.session;
    if(!result?.packageRestored||!start?.sessionFile||!start?.sessionId)throw new Error('任务包已写入，但缺少可接续的会话记录，请核对目标目录。');
    const targetPath=path.join(path.dirname(sourcePath),path.basename(start.sessionFile));
    try{await fs.writeFile(targetPath,await fs.readFile(start.sessionFile),{flag:'wx',mode:0o600});}
    catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
    const manager=SessionManager.open(targetPath);
    if(manager.getSessionId()!==start.sessionId||manager.getCwd()!==result.workspace)throw new Error('目标会话身份或工作区不一致，未覆盖已有会话。');
    const workspace=await Workspace.open(result.workspace),statePath=path.join(workspace.data,`session-${safeId(start.sessionId)}.json`),state=await readJson<any>(statePath);
    await writeJson(statePath,{...state,sessionFile:targetPath});
    await this.saveBinding(targetPath,{root:workspace.root,memory:false});
    const existing=this.engine.getSessionByPath(targetPath);
    const created=existing?{sessionPath:targetPath,sessionId:this.engine.getSessionIdForPath(targetPath)}:await this.engine.createDetachedSession({sessionMgr:manager,cwd:workspace.root,memoryEnabled:false,model:sourceSession.model,thinkingLevel:sourceSession.thinkingLevel,agentId:this.engine.resolveSessionOwnership(sourcePath).agentId,permissionMode:this.engine.getSessionPermissionMode(sourcePath),visibleInSessionList:true});
    await this.saveBinding(created.sessionPath,{root:workspace.root,memory:false});
    await this.engine.saveSessionTitle(created.sessionPath,`复现：${result.goal}`.slice(0,120));
    // Hana's display/session ID can differ from Pi's identity. Private imported
    // resources and the engineering state remain bound to the native Pi ID.
    const session={sessionFile:created.sessionPath,sessionId:start.sessionId};
    await writeJson(path.join(workspace.data,'session-start.json'),{schema:1,...session});
    const originPath=path.join(workspace.data,'package-origin.json'),origin=await readJson<any>(originPath);await writeJson(originPath,{...origin,piSession:session});
    this.publish(sourcePath,'workspace_changed',{createdSession:created.sessionPath,root:workspace.root});
    return {...result,session,createdSession:{sessionPath:created.sessionPath,sessionId:created.sessionId}};
  }
  async cancel(sessionPath: string) {
    for (const [id, item] of this.dialogs)
      if (item.sessionPath === sessionPath)
        this.engine.confirmStore?.resolve(id, "rejected");
    const controller = this.sessions.get(sessionPath);
    if (controller) await controller.cancel();
    else await this.engine.getSessionByPath(sessionPath)?.abort();
    return { cancelled: true };
  }
  async content(
    sessionPath: string,
    input: {
      repo?: string;
      file?: string;
      resource?: string;
      artifact?: string;
      maxBytes?: number;
    },
  ) {
    const controller = await this.controller(sessionPath),
      workspace = controller.options.workspace;
    if (input.resource)
      return controller.safeSnapshot(
        await new ProjectContext(workspace).read(input.resource, {
          task: controller.chat.session,
        }),
      );
    if (input.artifact) {
      const artifact = await new Artifacts(workspace).read(
        input.artifact,
        controller.chat.session,
      );
      const presentation = artifactPresentation(artifact.record, await fs.readFile(artifact.path));
      const { content = '', ...preview } = presentation;
      return controller.safeSnapshot({ ...artifact, content, preview });
    }
    if (!input.repo || !input.file)
      throw new Error("Repository and relative file are required");
    const file = await workspace.path(input.repo, input.file);
    const stat = await fs.stat(file);
    const limit = Math.min(
      1024 * 1024,
      Math.max(1024, input.maxBytes || 256000),
    );
    if (!stat.isFile() || stat.size > limit)
      throw new Error("Select a regular file within the preview size limit");
    const bytes = await fs.readFile(file);
    return controller.safeSnapshot({
      repo: input.repo,
      file: input.file,
      content: bytes.toString("utf8"),
      version: hash(bytes),
      size: bytes.length,
      modifiedAt: stat.mtimeMs,
    });
  }
  async confirm(
    sessionPath: string,
    dialog: Omit<Dialog, "id">,
    opts: ExtensionUIDialogOptions = {},
  ) {
    if (
      isReadOnlyPermissionMode(
        this.engine.getSessionPermissionMode(sessionPath),
      )
    )
      return undefined;
    const store = this.engine.confirmStore;
    if (!store) throw new Error("Native confirmation service unavailable");
    if (
      dialog.kind === "confirm" &&
      this.engine.getSessionPermissionMode(sessionPath) === "operate"
    )
      return true;
    if (
      dialog.kind === "confirm" &&
      this.engine.getSessionPermissionMode(sessionPath) === "auto"
    ) {
      const binding = await this.binding(sessionPath);
      const manager = this.engine.getSessionByPath(sessionPath)?.sessionManager;
      const visibleTranscript = (manager?.getBranch() || [])
        .filter(
          (entry) =>
            entry.type === "message" &&
            ["user", "assistant"].includes(entry.message.role),
        )
        .slice(-12)
        .map((entry) => {
          const content = entry.message.content;
          const text =
            typeof content === "string"
              ? content
              : content
                  .filter((block) => block.type === "text")
                  .map((block) => block.text)
                  .join("\n");
          return {
            role: entry.message.role,
            text:
              text.length > 2000 ? text.slice(0, 2000) + "…[truncated]" : text,
          };
        });
      const userIntentSummary =
        visibleTranscript.filter((entry) => entry.role === "user").at(-1)
          ?.text || "";
      const workspace = await Workspace.open(binding.root);
      const sessionState = await readJson<{
        requirements?: string[];
        requirementEntries?: string[];
      }>(
        path.join(
          workspace.data,
          `session-${safeId(manager.getSessionId())}.json`,
        ),
      );
      const notes = collectUserNotes(manager),
        preserved = (sessionState.requirementEntries || [])
          .map((id) => notes.get(id))
          .filter(Boolean)
          .map((note) => ({
            role: "user",
            text:
              note.text.length > 2000
                ? note.text.slice(0, 2000) + "…[truncated]"
                : note.text,
          }));
      for (const text of sessionState.requirements || [])
        preserved.push({ role: "user", text: text.slice(0, 2000) });
      const currentTexts = new Set(visibleTranscript.map((item) => item.text));
      const earlier = preserved
        .slice(-8)
        .filter((item) => !currentTexts.has(item.text));
      const registeredChecks = JSON.stringify(
        workspace.config.checks.map((check) => ({
          id: check.id,
          repo: check.repo,
          cwd: workspace.repo(check.repo).root,
          argv: check.argv,
          joint: check.joint === true,
        })),
      );
      const registeredRepositories = JSON.stringify(
        workspace.config.repos.map((repo) => ({
          id: repo.id,
          root: repo.root,
          access: repo.access,
        })),
      );
      const decision = await this.engine.approvalGateway.review(
        {
          toolName: "enigma_engineering",
          sessionPath,
          sideEffect: {
            summary: dialog.message,
            kind: "engineering_operation",
            registeredChecks,
            registeredRepositories,
          },
        },
        {
          cwd: binding?.root,
          workspaceFolders: binding ? [binding.root] : [],
          authorizedFolders:
            this.engine.getSessionAuthorizedFolders(sessionPath),
          userIntentSummary: userIntentSummary || preserved.at(-1)?.text || "",
          explicitUserAuthorization: userIntentSummary,
          visibleTranscript: [...earlier, ...visibleTranscript].slice(-20),
          sessionPath,
        },
      );
      this.publish(sessionPath, "approval", decision);
      if (decision.action !== "allow")
        throw new Error(
          `Automatic approval review rejected the engineering action: ${decision.reason}`,
        );
      return true;
    }
    const { confirmId, promise } = store.create(
      "engineering",
      dialog,
      {
        sessionPath,
        sessionId: this.engine.getSessionIdForPath?.(sessionPath),
      },
      opts.timeout,
    );
    this.dialogs.set(confirmId, {
      dialog: { ...dialog, id: confirmId },
      sessionPath,
    });
    const abort = () => store.resolve(confirmId, "rejected");
    opts.signal?.addEventListener("abort", abort, { once: true });
    if (opts.signal?.aborted) abort();
    this.publish(sessionPath, "dialog", { ...dialog, id: confirmId });
    try {
      const result = await promise;
      if (
        isReadOnlyPermissionMode(
          this.engine.getSessionPermissionMode(sessionPath),
        ) ||
        opts.signal?.aborted
      )
        return undefined;
      return result.action === "confirmed"
        ? dialog.kind === "confirm"
          ? true
          : result.value
        : undefined;
    } finally {
      opts.signal?.removeEventListener("abort", abort);
      this.dialogs.delete(confirmId);
      this.publish(sessionPath, "refresh", {});
    }
  }
  publish(sessionPath: string, type: string, data: unknown) {
    if(type==='model_selection')this.engine.emitBoundSessionEvent({type:'session_metadata_updated',metadata:{modelSelection:data}},sessionPath);
    this.engine.emitBoundSessionEvent(
      { type: "enigma_event", sessionPath, event: type, data },
      sessionPath,
    );
  }
}

class NativeEngineeringSession extends WorkbenchSession {
  readonly host: EngineeringHost;
  readonly nativePath: string;
  readonly nativeSession: any;
  private createdContext?: { sessionPath: string; sessionId: string };
  private restoreRequestPreparation?: () => void;
  constructor(
    host: EngineeringHost,
    nativePath: string,
    nativeSession: any,
    workspace: Workspace,
    models: any,
    binding: Binding,
  ) {
    super(
      {
        id:
          host.engine.getSessionIdForPath?.(nativePath) ||
          nativeSession.sessionManager.getSessionId(),
        session: nativeSession.sessionManager.getSessionId(),
        sessionFile: nativePath,
        title: "工程任务",
        provider: nativeSession.model?.provider || "",
        model: nativeSession.model?.id || "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        memory: binding.memory,
      },
      {
        workspace,
        models,
        agentDir: path.dirname(host.engine.modelsJsonPath),
        memory: binding.memory,
        approval: "ask",
        emit: (type, _chat, data) => host.publish(nativePath, type, data),
        persist: async () => {},
      },
    );
    this.host = host;
    this.nativePath = nativePath;
    this.nativeSession = nativeSession;
  }
  safeSnapshot(value: unknown) {
    return value === undefined
      ? null
      : JSON.parse(
          redact(JSON.stringify(value), this.options.workspace.secrets),
        );
  }
  async open() {
    this.options.workspace.activity = event => RunObserver.recordForSession(this.options.workspace.root,this.chat.session,event);
    const agent = this.nativeSession.agent,
      previous = agent.prepareRequest;
    const prepare = async (request: any, signal: AbortSignal) => {
      signal?.throwIfAborted();
      await this.host.applyRequestedModel(this.nativePath);
      await this.host.assertManagedModel(
        this.nativePath,
        this.nativeSession.model.provider,
        this.nativeSession.model.id,
      );
      const binding = await this.host.binding(this.nativePath),
        policy = binding?.modelPolicy;
      if (policy) {
        if (
          policy.maxRequests !== undefined &&
          policy.requests >= policy.maxRequests
        )
          throw new Error(
            "Configured model-call budget reached; review the task before extending the budget",
          );
        policy.requests++;
        const role = modelForPhase(policy);
        if (role.thinking)
          this.host.engine.setSessionThinkingLevel(
            this.nativePath,
            role.thinking,
          );
        await this.host.saveBinding(this.nativePath, binding!);
      }
      return previous?.(request, signal);
    };
    agent.prepareRequest = prepare;
    this.restoreRequestPreparation = () => {
      if (agent.prepareRequest === prepare) agent.prepareRequest = previous;
    };
    // The facade delegates lifecycle changes to Hana; it does not construct a Pi runtime.
    this.runtime = {
      session: this.nativeSession,
      dispose: async () => {},
      newSession: async (options: any = {}) => {
        const manager = SessionManager.create(
          this.options.workspace.root,
          path.dirname(this.nativePath),
          { parentSession: this.nativePath },
        );
        await options.setup?.(manager);
        const targetPath = manager.getSessionFile();
        await this.host.saveBinding(targetPath, {
          root: this.options.workspace.root,
          memory: this.chat.memory === true,
        });
        const result = await this.host.engine.createSession(
          manager,
          this.options.workspace.root,
          false,
          this.nativeSession.model,
          {
            visibleInSessionList: true,
            thinkingLevel: this.nativeSession.thinkingLevel,
          },
        );
        this.createdContext = {
          sessionPath: result.sessionPath,
          sessionId: result.sessionId,
        };
        this.host.publish(this.nativePath, "new_context", {
          sessionPath: result.sessionPath,
          sessionId: result.sessionId,
        });
        return { cancelled: false };
      },
      fork: async (entry: string) => {
        const result = await this.host.engine.forkSessionAtNode({
          sessionPath: this.nativePath,
          target: { role: "user", entryId: entry },
        });
        return { cancelled: false, ...result };
      },
      switchSession: async (targetPath: string) => {
        const binding = await this.host.binding(targetPath);
        if (binding?.root !== this.options.workspace.root)
          throw new Error(
            "Conversation switch belongs to another engineering workspace",
          );
        await this.host.engine.switchSession(targetPath);
        return { cancelled: false };
      },
    } as any;
    await this.bind(this.nativeSession);
    return this;
  }
  protected async adopt() {
    /* Hana owns the session identity and lifecycle sidecars. */
  }
  protected operationRequestText(title: string, request: any) {
    this.nativeSession.sessionManager.appendCustomEntry(
      "enigma.operation-request",
      this.safeSnapshot({ title, request }),
    );
    const args = request?.args || {};
    const details = [
      args.goal && `目标：${args.goal}`,
      args.repo && `仓库：${args.repo}`,
      args.file && `文件：${args.file}`,
      args.title && `名称：${args.title}`,
    ].filter(Boolean);
    return `请执行工作台操作：${title}。${details.length ? "\n" + details.join("\n") : ""}`;
  }
  protected dialog(
    input: Omit<Dialog, "id">,
    opts: ExtensionUIDialogOptions = {},
  ) {
    return this.host.confirm(this.nativePath, input, opts);
  }
  async detach() {
    this.restoreRequestPreparation?.();
    // Closing the UI adapter must not dispose Hana's native session.
    this.operationAbort?.abort();
    await this.inflight;
    this.options.workspace.activity=undefined;
    this.closed = true;
    this.unsubscribe?.();
  }
  async runCommand(name: string, args: string) {
    if (name === "new-context") this.createdContext = undefined;
    const result = await super.runCommand(name, args);
    let createdSession: any;
    if (name === "new-context") {
      createdSession = this.createdContext;
      if (createdSession) {
        const input = JSON.parse(args);
        await this.host.engine.saveSessionTitle(
          createdSession.sessionPath,
          String(input.goal || "新背景任务").slice(0, 120),
        );
      }
    }
    if (name === "branch-code") {
      const input = JSON.parse(args),
        fork = await Workspace.open(
          path.resolve(this.options.workspace.root, input.destination),
        );
      const start = await readJson<{ sessionFile: string; sessionId: string }>(
        path.join(fork.data, "session-start.json"),
      ).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;});
      const manager = start ? SessionManager.forkFrom(
        start.sessionFile,
        fork.root,
        path.dirname(this.nativePath),
      ) : SessionManager.create(fork.root,path.dirname(this.nativePath));
      const targetPath = manager.getSessionFile();
      if(start){const previous = await readJson<any>(
        path.join(fork.data, `session-${safeId(start.sessionId)}.json`),
      );
      await writeJson(
        path.join(fork.data, `session-${safeId(manager.getSessionId())}.json`),
        { ...previous, sessionFile: targetPath },
      );}else manager.appendCustomEntry('enigma.code-fork-origin',{checkpoint:input.checkpoint,sourceWorkspace:this.options.workspace.root,contextCopied:false});
      await this.host.saveBinding(targetPath, {
        root: fork.root,
        memory: this.chat.memory === true,
      });
      createdSession = await this.host.engine.createSession(
        manager,
        fork.root,
        false,
        this.nativeSession.model,
        {
          visibleInSessionList: true,
          thinkingLevel: this.nativeSession.thinkingLevel,
        },
      );
      await this.host.engine.saveSessionTitle(
        createdSession.sessionPath,
        "独立代码方案",
      );
      this.host.publish(this.nativePath, "code_fork", {
        sessionPath: createdSession.sessionPath,
        sessionId: createdSession.sessionId,
        root: fork.root,
      });
    }
    this.host.engine.syncSessionBranchHead(
      this.nativePath,
      this.nativeSession.sessionManager,
      "engineering_command",
    );
    this.host.publish(this.nativePath, "workspace_changed", {
      repos: this.options.workspace.config.repos.map((repo) => repo.id),
    });
    return createdSession
      ? {
          ...result,
          createdSession: {
            sessionPath: createdSession.sessionPath,
            sessionId: createdSession.sessionId,
          },
        }
      : result;
  }
}

export const engineeringGroups = [
  { id: "project", label: "项目与仓库", placement: "sidebar" },
  { id: "plan", label: "计划", placement: "task" },
  { id: "collaboration", label: "协作", placement: "task" },
  { id: "timeline", label: "时光机", placement: "task" },
  { id: "observer", label: "运行状态", placement: "task" },
  { id: "reading", label: "代码", placement: "content" },
  { id: "materials", label: "资料", placement: "content" },
  { id: "artifacts", label: "产物", placement: "content" },
  { id: "environment", label: "环境", placement: "content" },
  { id: "review", label: "审查", placement: "content" },
  { id: "memory", label: "记忆", placement: "sidebar" },
  { id: "skills", label: "技能", placement: "sidebar" },
  { id: "handoff", label: "背景交接", placement: "task" },
  { id: "documents", label: "文档维护", placement: "content" },
  { id: "acceptance", label: "要求与验收", placement: "task" },
];
