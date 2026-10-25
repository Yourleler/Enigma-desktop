import type { Workspace } from './workspace.js';
import type { FileVersion, OperationRecord } from './types.js';

export interface ChangeObservation {
  repo: string;
  file: string;
  before?: FileVersion;
  after?: FileVersion;
  source: 'observed-managed' | 'external-or-untracked' | 'unknown';
  operations: string[];
  reason: string;
}
export interface ChangeReport {
  baseline: string;
  changes: ChangeObservation[];
  unknownOperations: string[];
  limitation: string;
}

const same = (a?: FileVersion, b?: FileVersion): boolean => a?.hash === b?.hash && a?.mode === b?.mode;

/** Classify observations, never assert authorship from a before/after time window. */
export async function observeChanges(workspace: Workspace, baselineId: string): Promise<ChangeReport> {
  const baseline = await workspace.loadCheckpoint(baselineId);
  const records = await workspace.operations();
  const changes: ChangeObservation[] = [];
  for (const repo of workspace.config.repos) {
    const original = baseline.repos.find(snapshot => snapshot.repo.id === repo.id);
    const current = await workspace.snapshotRepo(repo.id);
    const unresolved = records.filter(record => ['pending', 'unknown'].includes(record.status)
      && (record.scope === 'workspace' || record.repo === repo.id || record.changes?.some(change => change.repo === repo.id) || (!record.repo && !record.changes?.length)));
    for (const file of new Set([...Object.keys(original?.files ?? {}), ...Object.keys(current.files)])) {
      const before = original?.files[file], after = current.files[file]; if (same(before, after)) continue;
      const matches = records.filter(record => record.status === 'settled' && record.createdAt && record.createdAt >= baseline.createdAt && transition(record, repo.id, file)
        && same(transition(record, repo.id, file)!.after, after));
      const source = unresolved.length ? 'unknown' : matches.length ? 'observed-managed' : 'external-or-untracked';
      changes.push({ repo: repo.id, file, before, after, source, operations: [...new Set([...matches, ...unresolved].map(record => record.id))],
        reason: unresolved.length ? 'Unresolved operation may affect this repository; inspect actual effects.'
          : matches.length ? 'A settled managed operation observed this content transition. Concurrent external edits inside its observation window cannot be attributed.'
            : 'No settled managed observation explains the current content; it may be external or outside recorded coverage.' });
    }
  }
  return { baseline: baselineId, changes, unknownOperations: records.filter(record => ['pending', 'unknown'].includes(record.status)).map(record => record.id),
    limitation: 'Source classifications describe observed windows, not exact authorship. Ignored files, credentials and effects outside registered repositories are not covered.' };
}

function transition(record: OperationRecord, repoId: string, file: string): { before?: FileVersion; after?: FileVersion } | undefined {
  const before = record.beforeWorkspace?.find(snapshot => snapshot.repo.id === repoId) ?? (record.repo === repoId ? record.before : undefined);
  const after = record.afterWorkspace?.find(snapshot => snapshot.repo.id === repoId) ?? (record.repo === repoId ? record.after : undefined);
  if (!before || !after || same(before.files[file], after.files[file])) return undefined;
  return { before: before.files[file], after: after.files[file] };
}
