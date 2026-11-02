export interface ModelRole {
  provider: string;
  id: string;
  thinking?: "off" | "low" | "medium" | "high" | "max";
}
export interface ModelPolicy {
  mode: "single" | "plan-execute" | "adaptive" | "delegated";
  execution: ModelRole;
  planning?: ModelRole;
  review?: ModelRole;
  /** Default for newly dispatched children; explicit task policies take precedence. */
  worker?: ModelRole;
  phase: "planning" | "execution" | "review";
  requests: number;
  failures: number;
  maxRequests?: number;
}

export function validateModelPolicy(input: unknown): ModelPolicy {
  const value = input as ModelPolicy;
  if (!value || !["single", "plan-execute", "adaptive", "delegated"].includes(value.mode))
    throw new Error('Model policy requires mode single, plan-execute, adaptive or delegated. Use execution for the main model and worker for the child model.');
  for (const role of modelPolicyRoles(value)) {
    if (
      typeof role?.provider !== "string" ||
      !role.provider.trim() ||
      typeof role.id !== "string" ||
      !role.id.trim() ||
      role.provider.length > 100 ||
      role.id.length > 200 ||
      (role.thinking &&
        !["off", "low", "medium", "high", "max"].includes(role.thinking))
    )
      throw new Error(
        "Provide configured model identities and supported thinking levels",
      );
  }
  if (!value.execution || (["plan-execute", "adaptive"].includes(value.mode) && !value.planning))
    throw new Error(
      "Execution and planning models are required for model separation",
    );
  if (value.mode === 'delegated' && !value.worker) throw new Error('Choose a child model for main/child orchestration');
  if (
    value.maxRequests !== undefined &&
    (!Number.isSafeInteger(value.maxRequests) ||
      value.maxRequests < 1 ||
      value.maxRequests > 1000)
  )
    throw new Error("Model-call budget must be 1–1000");
  const role = (input: ModelRole | undefined) =>
    input
      ? {
          provider: input.provider,
          id: input.id,
          ...(input.thinking ? { thinking: input.thinking } : {}),
        }
      : undefined;
  return {
    mode: value.mode,
    execution: role(value.execution)!,
    planning: role(value.planning),
    review: role(value.review),
    worker: role(value.worker),
    maxRequests: value.maxRequests,
    phase: value.mode === "single" || value.mode === 'delegated' ? "execution" : "planning",
    requests: 0,
    failures: 0,
  };
}

export function modelPolicyRoles(policy: Partial<ModelPolicy>): ModelRole[] {
  return [policy.execution, policy.planning, policy.review, policy.worker].filter((role): role is ModelRole => !!role);
}

export function childModelPolicy(policy: ModelPolicy | undefined): ModelPolicy | undefined {
  return policy?.worker ? validateModelPolicy({ mode: 'single', execution: policy.worker }) : undefined;
}

export function modelForPhase(policy: ModelPolicy): ModelRole {
  return policy.phase === "planning"
    ? policy.planning || policy.execution
    : policy.phase === "review"
      ? policy.review || policy.planning || policy.execution
      : policy.execution;
}

/** Planning can collect source and maintain a plan, but cannot start execution
 * indirectly through a background command, recipe, browser action or worker.
 */
export function planningBlocksTool(
  name: string,
  args: Record<string, unknown> = {},
): boolean {
  if (name === 'subagent') return args.access !== 'read';
  if (name === 'conductor') return !['status','wait','preview','diagnose','requirements'].includes(String(args.action));
  if (
    [
      "repo_write",
      "repo_edit",
      "repo_run",
      "repo_stage",
      "write",
      "edit",
      "bash",
      "workspace_verify",
    ].includes(name)
  )
    return true;
  if (
    name === "document_work" &&
    ["example", "update"].includes(String(args.action))
  )
    return true;
  const actions: Record<string, string[]> = {
    service_manage: ["add", "start", "restart", "stop"],
    background_task: ["start", "cancel"],
    browser_validate: ["run"],
    recipe_manage: ["run"],
    delegate_task: ["start", "merge", "cancel"],
    solution_experiment: ["evaluate", "select"],
  };
  return (actions[name] || []).includes(String(args.action));
}
