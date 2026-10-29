import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Workspace } from './workspace.js';
import { ensureDir, readJson, safeId } from './storage.js';
import { exportHandoff, inspectHandoff, type HandoffMode, type ContextNote } from './handoff.js';
import { selectedPiNotes, setupPiHandoff } from './pi-session.js';
import {exportDifferentialHandoff,inspectPortableHandoff} from './differential-handoff.js';

export function createHandoffExtension(options: { workspace?: Workspace } = {}) { return function handoffExtension(pi: ExtensionAPI): void {
  // User commands initiate export/new-session explicitly; no autonomous background export.
  pi.registerCommand('handoff-export', { description: 'Export selected context: JSON {destination,goal,mode,entries:[{id,kind?}],evidence?,includeEvidence?,memories?,checkpoint?}', async handler(args, ctx) {
    if (!ctx.isIdle() || ctx.hasPendingMessages()) throw new Error('Select a settled conversation boundary before exporting context');
    const input = JSON.parse(args) as { destination: string; goal: string; mode: HandoffMode; entries: { id: string; kind?: ContextNote['kind'] }[]; evidence?: string[]; memories?: string[]; checkpoint?: string; includeEvidence?: boolean;baseDirectory?:string };
    const workspace = options.workspace ?? await Workspace.open(process.env.ENIGMA_WORKSPACE ?? ctx.cwd);
    const notes = selectedPiNotes(ctx.sessionManager, input.entries);
    let accounting: { requests: number; inheritedRequests?: number; planFile?: string } = { requests: 0 };
    try { accounting = await readJson(join(workspace.data, `session-${safeId(ctx.sessionManager.getSessionId())}.json`)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const { PlanStore } = await import('./planning.js');
    const plan = await new PlanStore(workspace, accounting.planFile ?? 'active-plan.json').current();
    const handoff={ ...input, notes, source: { agent: 'pi', session: ctx.sessionManager.getSessionId(),
      entry: ctx.sessionManager.getLeafId() ?? undefined, sessionFile: ctx.sessionManager.getSessionFile() ?? undefined, requests: accounting.requests + (accounting.inheritedRequests ?? 0) },
      planOverride: plan ?? null,
      memoryAccess: { session: ctx.sessionManager.getSessionId(), entries: ctx.sessionManager.getBranch().map(entry => entry.id) } };
    const result=input.baseDirectory?(await exportDifferentialHandoff(workspace,input.baseDirectory,input.destination,handoff)).manifest:await exportHandoff(workspace,input.destination,handoff);
    ctx.ui.notify(`Context package ${result.id}: ${input.destination}/handoff.md. Source conversation and code are unchanged.`, 'info');
  } });
  pi.registerCommand('new-context', { description: 'New background task: JSON {goal,entries:[{id,kind?}],memories?}', async handler(args, ctx) {
    if (!ctx.isIdle() || ctx.hasPendingMessages()) throw new Error('New-context requires a settled conversation boundary');
    const input = JSON.parse(args) as { goal: string; entries: { id: string; kind?: ContextNote['kind'] }[]; memories?: string[] };
    const workspace = options.workspace ?? await Workspace.open(process.env.ENIGMA_WORKSPACE ?? ctx.cwd);
    const directory = await ensureDir(join(workspace.data, 'handoffs'));
    const path = join(directory, randomUUID());
    let requests = 0;
    try {
      const accounting = await readJson<{ requests: number; inheritedRequests?: number }>(join(workspace.data, `session-${safeId(ctx.sessionManager.getSessionId())}.json`));
      requests = accounting.requests + (accounting.inheritedRequests ?? 0);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await exportHandoff(workspace, path, { mode: 'background', goal: input.goal, notes: selectedPiNotes(ctx.sessionManager, input.entries), memories: input.memories,
      source: { agent: 'pi', session: ctx.sessionManager.getSessionId(), entry: ctx.sessionManager.getLeafId() ?? undefined, sessionFile: ctx.sessionManager.getSessionFile() ?? undefined, requests },
      memoryAccess: { session: ctx.sessionManager.getSessionId(), entries: ctx.sessionManager.getBranch().map(entry => entry.id) } });
    const inspection = await inspectHandoff(workspace, path);
    const parentSession = ctx.sessionManager.getSessionFile() ?? undefined;
    const changed = await ctx.newSession({ parentSession, setup: manager => setupPiHandoff(workspace, manager, inspection) });
    if (changed.cancelled) throw new Error('New session cancelled; exported context remains available for inspection');
    // Session replacement invalidates this old extension context. Do not use its API afterward.
  } });
  pi.registerCommand('handoff-read', { description: 'Inspect a portable handoff without starting a model or executing source tools', async handler(args, ctx) {
    const workspace = options.workspace ?? await Workspace.open(process.env.ENIGMA_WORKSPACE ?? ctx.cwd);
    const result = await inspectPortableHandoff(workspace, args.trim(),{memoryAccess:{session:ctx.sessionManager.getSessionId(),entries:ctx.sessionManager.getBranch().map(entry=>entry.id)}});
    ctx.ui.notify(JSON.stringify({ mode: result.manifest.mode, goal: result.manifest.goal, code: result.code, evidence: result.evidence, memories: result.memories, warnings: result.warnings }, null, 2), 'info');
  } });
}; }

export default createHandoffExtension();
