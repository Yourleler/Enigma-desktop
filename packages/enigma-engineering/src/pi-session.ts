import { SessionManager, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { join } from 'node:path';
import type { UserNote } from './requirements.js';
import type { Checkpoint, ForkHandoff } from './types.js';
import { readJson, safeId, writeJson, ensureDir, hash } from './storage.js';
import type { Workspace } from './workspace.js';
import type { HandoffInspection, ContextNote } from './handoff.js';

type ReadonlySessionManager = ExtensionContext['sessionManager'];

function presentationText(entry:any,entries:Pick<Map<string,any>,'get'>,raw:string):string {
  let parent=entry.parentId;
  for(let depth=0;parent&&depth<16;depth++){
    const current=entries.get(parent);if(!current)break;
    if(current.type==='message'&&current.message?.role!=='system'||current.type==='custom_message')break;
    if(current.type==='custom'&&current.customType==='hana-message-presentation'){
      const text=current.data?.displayText;
      if(typeof text!=='string'||!text.trim()||!raw.endsWith(text))break;
      let prefix=raw.slice(0,raw.length-text.length).trim();
      // Strip only a complete envelope preceding the exact recorded input.
      // Never filter words from the user's own displayText by tag matching.
      while(prefix){
        const start=/^\[hana_(reminder(?: at \d{4}-\d{2}-\d{2} \d{2}:\d{2})?|reference)\]\r?\n/.exec(prefix);if(!start)return raw;
        const end=start[1]!.startsWith('reminder')?'[/hana_reminder]':'[/hana_reference]';
        const index=prefix.indexOf('\n'+end,start[0].length-1);if(index<0)return raw;
        prefix=prefix.slice(index+1+end.length).trim();
      }
      return text;
    }
    parent=current.parentId;
  }
  return raw;
}

export function collectUserNotes(manager: ReadonlySessionManager): Map<string, UserNote> {
  const notes = new Map<string, UserNote>(),entries=manager.getEntries(),byId=new Map(entries.map(entry=>[entry.id,entry]));
  for (const entry of entries) if (entry.type === 'message' && entry.message.role === 'user') {
    const content = entry.message.content;
    const text = typeof content === 'string' ? content : content.filter(part => part.type === 'text').map(part => part.text).join('\n');
    notes.set(entry.id, { id: entry.id, text:presentationText(entry,byId,text) });
  }
  return notes;
}

export function currentUserIds(manager: ReadonlySessionManager): string[] {
  return manager.getBranch().filter(entry => entry.type === 'message' && entry.message.role === 'user').map(entry => entry.id);
}

/** Resolve host-owned history before entering the domain's filesystem operation. */
export async function loadPiForkHandoff(workspace: Workspace, checkpoint: Checkpoint): Promise<ForkHandoff | undefined> {
  if (!checkpoint.session) return undefined;
  const state = await readJson<{ schema: number; sessionFile?: string; requirements?: string[]; requirementEntries?: string[]; requests: number; inheritedRequests?: number }>(
    join(workspace.data, `session-${safeId(checkpoint.session)}.json`));
  if (state.schema !== 1 || !Number.isSafeInteger(state.requests) || state.requests < 0) throw new Error('Invalid source session state');
  const requirements = [...(state.requirements ?? [])];
  if (state.requirementEntries?.length) {
    if (!state.sessionFile) throw new Error('A persistent Pi session is needed to carry original user entries into a code fork');
    const manager = SessionManager.open(state.sessionFile);
    if (manager.getSessionId() !== checkpoint.session) throw new Error('Source session identity does not match checkpoint');
    const notes = collectUserNotes(manager);
    for (const entryId of state.requirementEntries) {
      const note = notes.get(entryId);
      if (!note) throw new Error('Cannot carry missing original user entries into a code fork');
      requirements.push(note.text);
    }
  }
  return { sourceSession: checkpoint.session, requirements: [...new Set(requirements)], requests: state.requests + (state.inheritedRequests ?? 0) };
}

export function selectedPiNotes(manager: ReadonlySessionManager, selected: { id: string; kind?: ContextNote['kind'] }[]): ContextNote[] {
  if (!selected.length) throw new Error('Select source entries for the handoff instead of exporting all history');
  return selected.map(({ id, kind }) => {
    const entry = manager.getEntry(id);
    if (!entry) throw new Error(`Selected source entry unavailable: ${id}`);
    if (entry.type === 'message' && (entry.message.role === 'user' || entry.message.role === 'assistant')) {
      const content = entry.message.content;
      const raw = typeof content === 'string' ? content : content.filter(part => part.type === 'text').map(part => part.text).join('\n');
      const text=entry.message.role==='user'?presentationText(entry,{get:id=>manager.getEntry(id)},raw):raw;
      return { role: entry.message.role, kind: kind ?? 'background', text, reference: `pi:${manager.getSessionId()}:${id}` };
    }
    if (entry.type === 'custom_message') {
      const content = entry.content;
      const text = typeof content === 'string' ? content : content.filter(part => part.type === 'text').map(part => part.text).join('\n');
      return { role: 'source', kind: kind ?? 'observation', text, reference: `pi:${manager.getSessionId()}:${id}` };
    }
    throw new Error('Select a finalized user/assistant text or source message; hidden reasoning, tool history and system prompts are not exported');
  });
}

/** Create a new public Pi session from portable user-role context. Source history is unchanged. */
export async function importPiHandoff(workspace: Workspace, handoff: HandoffInspection): Promise<{ sessionFile: string; sessionId: string }> {
  if (handoff.manifest.mode !== 'background' && !handoff.safeToContinue) throw new Error('Resolve handoff code/operation conflicts before continuing the task');
  const sessionDir = await ensureDir(join(workspace.data, 'sessions'));
  const manager = SessionManager.create(workspace.root, sessionDir, { parentSession: handoff.manifest.source.agent === 'pi' ? handoff.manifest.source.sessionFile : undefined });
  await setupPiHandoff(workspace, manager, handoff);
  const sessionFile = manager.getSessionFile(); if (!sessionFile) throw new Error('Imported Pi session was not persisted');
  return { sessionFile, sessionId: manager.getSessionId() };
}

export async function setupPiHandoff(workspace: Workspace, manager: SessionManager, handoff: HandoffInspection): Promise<void> {
  manager.appendMessage({ role: 'user', content: [{ type: 'text', text: handoff.prompt }], timestamp: Date.now() });
  manager.appendCustomEntry('enigma.handoff', { id: handoff.manifest.id, mode: handoff.manifest.mode, source: handoff.manifest.source,
    sourceWorkspace: handoff.manifest.sourceWorkspace, checkpoint: handoff.manifest.checkpoint, inheritedRequests: handoff.manifest.source.requests ?? 0,
    presentation: {version: 1, inputEntry: manager.getLeafId(), contentHash: hash(handoff.prompt), goal: handoff.manifest.goal,
      notes: handoff.manifest.notes.map(note=>({role:note.role,kind:note.kind,text:note.text,reference:note.reference})),
      repositories: handoff.manifest.repos.map(repo=>repo.id)} });
  const currentId = manager.getBranch().find(entry => entry.type === 'message' && entry.message.role === 'user')!.id;
  const planFile = `active-plan-${safeId(manager.getSessionId())}.json`;
  if (handoff.manifest.mode !== 'background' && handoff.manifest.plan) {
    await ensureDir(join(workspace.data, 'plans'));
    const plan = handoff.manifest.plan;
    const { PlanStore } = await import('./planning.js');
    // Recreate executable plan definitions under a new id. Historical completion evidence is advisory.
    await new PlanStore(workspace, planFile).create({ goal: plan.goal, steps: plan.steps.map(step => ({ id: step.id, repo: step.repo, goal: step.goal, requires: step.requires, checks: step.checks })) });
  }
  await writeJson(join(workspace.data, `session-${safeId(manager.getSessionId())}.json`), { schema: 1, requirements: [], requirementEntries: [currentId], reviewEntries: [], evidence: [],
    requests: 0, corrections: 0, lastVerification: 'unverified', inheritedRequests: handoff.manifest.source.requests ?? 0, planFile,
    handoff: { id: handoff.manifest.id, mode: handoff.manifest.mode, sourceSession: handoff.manifest.source.session } });
}

/** Clone the selected native branch into a code fork, preserving original user history and separate accounting. */
export async function seedPiCodeFork(source: Workspace, target: Workspace, checkpoint: Checkpoint): Promise<{ sessionFile: string; sessionId: string }> {
  if (!checkpoint.session || !checkpoint.entry) throw new Error('Native code fork requires a checkpoint associated with a Pi conversation entry');
  const handoff = await loadPiForkHandoff(source, checkpoint); if (!handoff) throw new Error('Source handoff is unavailable');
  const state = await readJson<{ sessionFile?: string }>(join(source.data, `session-${safeId(checkpoint.session)}.json`));
  if (!state.sessionFile) throw new Error('Source Pi session file is unavailable');
  const dir = await ensureDir(join(target.data, 'sessions'));
  const copied = SessionManager.forkFrom(state.sessionFile, target.root, dir);
  if (!copied.getEntry(checkpoint.entry)) throw new Error('Source checkpoint entry is unavailable in native history');
  const path = copied.createBranchedSession(checkpoint.entry); if (!path) throw new Error('Unable to persist native branch');
  const manager = SessionManager.open(path);
  manager.appendMessage({ role: 'user', content: [{ type: 'text', text: `Continuing code solution from checkpoint ${checkpoint.id}. New workspace: ${target.root}. Source requirements are preserved; read actual files and revalidate all checks before claiming completion. This conversation copy does not execute source tools again.` }], timestamp: Date.now() });
  await writeJson(join(target.data, `session-${safeId(manager.getSessionId())}.json`), { schema: 1, requirements: handoff.requirements,
    requirementEntries: [], reviewEntries: [], evidence: [], requests: 0, corrections: 0, lastVerification: 'unverified', inheritedRequests: handoff.requests,
    handoff: { mode: 'alternative', sourceSession: checkpoint.session, checkpoint: checkpoint.id } });
  await writeJson(join(target.data, 'session-start.json'), { schema: 1, sessionFile: path, sessionId: manager.getSessionId(), sourceSession: checkpoint.session });
  return { sessionFile: path, sessionId: manager.getSessionId() };
}
