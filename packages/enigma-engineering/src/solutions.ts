import { PlanStore } from './planning.js';
import type { Workspace } from './workspace.js';
import { repoGraph } from './reading.js';

export async function compareSolutions(workspace: Workspace, leftId: string, rightId: string) {
  const left = await workspace.loadCheckpoint(leftId), right = await workspace.loadCheckpoint(rightId);
  const changes = await workspace.compare(leftId, rightId);
  const graph = await repoGraph(workspace);
  const plans = new PlanStore(workspace);
  const inspect = async (checkpoint: typeof left) => ({
    checkpoint: checkpoint.id, label: checkpoint.label, source: { session: checkpoint.session, entry: checkpoint.entry },
    plan: checkpoint.plan ? await plans.view(await plans.load(checkpoint.plan.id, checkpoint.plan.revision)) : null,
    evidence: await Promise.all(checkpoint.references.map(async reference => {
      try {
        const observed = await workspace.evidenceStatus(reference);
        return { id: reference, kind: observed.entry.kind, validNow: observed.valid, createdAt: observed.entry.createdAt };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        return { id: reference, validNow: false, unavailable: true };
      }
    })),
  });
  const affected = new Set(changes.map(change => change.repo));
  for (const repo of [...affected]) for (const downstream of graph.affectedBy[repo] ?? []) affected.add(downstream);
  return { left: await inspect(left), right: await inspect(right), changes, affected: [...affected].sort(),
    limitation: 'Evidence freshness is checked against the current workspace. Historical passing checks do not verify a different solution. Impact uses declared dependencies; unresolved runtime relationships need inspection.' };
}

export async function previewRestore(workspace: Workspace, targetId: string, expectedId: string) {
  const target = await workspace.loadCheckpoint(targetId), expected = await workspace.loadCheckpoint(expectedId);
  const conflicts: string[] = [];
  for (const repo of workspace.config.repos) {
    const anticipated = expected.repos.find(snapshot => snapshot.repo.id === repo.id);
    const desired = target.repos.find(snapshot => snapshot.repo.id === repo.id);
    const current = await workspace.snapshotRepo(repo.id);
    if (!anticipated) { conflicts.push(`${repo.id}: missing expected state`); continue; }
    if (current.head !== anticipated.head || current.branch !== anticipated.branch || (desired && (desired.head !== current.head || desired.branch !== current.branch))) conflicts.push(`${repo.id}: Git history differs; use an independent code fork`);
    if (JSON.stringify(current.files) !== JSON.stringify(anticipated.files)) conflicts.push(`${repo.id}: external edits differ from expected state`);
    if (desired && repo.access === 'read' && JSON.stringify(desired.files) !== JSON.stringify(current.files)) conflicts.push(`${repo.id}: repository is read-only`);
  }
  return { target: target.id, expected: expected.id, changes: await workspace.compare(expectedId, targetId), conflicts,
    plan: target.plan ?? null, applyAllowed: !conflicts.length, limitation: 'Preview does not reserve files; restore rechecks actual state before applying.' };
}
