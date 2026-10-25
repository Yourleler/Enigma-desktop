import type { ExtensionContext, SessionBoundaryDraft } from '@earendil-works/pi-coding-agent';

type Manager = ExtensionContext['sessionManager'];
export const CONTEXT_CHECKPOINT = 'enigma.context-checkpoint';
export const MODEL_REWIND = 'enigma.model-rewind';
export interface ContextRewindInput { checkpoint: string; reason: string; lesson: string; nextStep: string }

/** Only checkpoints in the current compaction segment and surviving route are eligible. */
export function contextCheckpoints(manager: Manager) {
  const branch = manager.getBranch();
  const compacted = branch.findLastIndex(entry => entry.type === 'compaction');
  const abandoned = new Set<string>();
  for (const entry of branch) if (entry.type === 'custom' && entry.customType === MODEL_REWIND) {
    const data = entry.data as { abandonedCheckpoints?: string[] };
    for (const id of data?.abandonedCheckpoints ?? []) abandoned.add(id);
  }
  return branch.slice(compacted + 1).filter(entry => entry.type === 'custom' && entry.customType === CONTEXT_CHECKPOINT
    && !abandoned.has(entry.id) && (entry.data as { session?: string })?.session === manager.getSessionId()).map(entry => ({
      id: entry.id, createdAt: entry.timestamp, ...(entry.type === 'custom' ? entry.data as { label: string; request: number; codeCheckpoint?: string } : {}),
    })).slice(-100);
}

export function contextRewindHistory(manager: Manager) {
  return manager.getBranch().filter(entry => entry.type === 'custom' && entry.customType === MODEL_REWIND)
    .map(entry => ({ id: entry.id, createdAt: entry.timestamp, ...(entry.type === 'custom' ? entry.data as object : {}) })).slice(-50);
}

/** Pi commits these edits after the complete tool batch, then refreshes the next request. */
export function prepareContextRewind(manager: Manager, input: ContextRewindInput) {
  for (const key of ['checkpoint', 'reason', 'lesson', 'nextStep'] as const) {
    if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > 4000) throw new Error(`Provide a bounded ${key} for the context rewind`);
  }
  if (!contextCheckpoints(manager).some(point => point.id === input.checkpoint)) throw new Error('Choose a surviving context checkpoint from this session and current compaction segment');
  const branch = manager.getBranch(), cut = branch.findIndex(entry => entry.id === input.checkpoint);
  const suffix = branch.slice(cut + 1), visible = new Set(manager.buildSessionProjection().entries.filter(entry => entry.messages.length).map(entry => entry.sourceEntry.id));
  const omitted = suffix.filter(entry => visible.has(entry.id) && (entry.type === 'custom_message'
    || entry.type === 'message' && !['user', 'system'].includes(entry.message.role)));
  if (!omitted.length) throw new Error('This checkpoint has no later model/tool content to rewind');
  if (omitted.length > 1000) throw new Error('Context rewind exceeds the entry budget; choose a more recent checkpoint');
  const entries: SessionBoundaryDraft[] = omitted.map(entry => ({ type: 'context_edit', targetId: entry.id, replacement: null }));
  return { entries, omittedEntries: omitted.map(entry => entry.id),
    preservedUserEntries: suffix.filter(entry => entry.type === 'message' && entry.message.role === 'user').map(entry => entry.id),
    abandonedCheckpoints: suffix.filter(entry => entry.type === 'custom' && entry.customType === CONTEXT_CHECKPOINT).map(entry => entry.id) };
}
