import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { PlanStore } from '../src/planning.js';
import { fixture } from './fixtures.js';

test('shared plan prerequisites and evidence are read once per view, then revalidated on the next view', async () => {
  const { root, workspace } = await fixture();
  try {
    await workspace.exclusive(() => workspace.addCheck({ id: 'syntax', repo: 'library', argv: [process.execPath, '--check', 'index.js'] }));
    const proof = await workspace.exclusive(() => workspace.verify()), plans = new PlanStore(workspace);
    const plan = await plans.create({ goal: 'Shared dependencies', steps: [
      { id: 'base', repo: 'library', goal: 'Base', checks: ['syntax'] },
      { id: 'a', repo: 'library', goal: 'A', requires: ['base'], checks: ['syntax'] },
      { id: 'b', repo: 'library', goal: 'B', requires: ['base'], checks: ['syntax'] },
      { id: 'end', repo: 'library', goal: 'End', requires: ['a', 'b'], checks: ['syntax'] },
    ] });
    for (const step of plan.steps) { step.phase = 'verified'; step.evidence = proof.evidence; }
    let reads = 0; const original = workspace.evidenceStatus.bind(workspace);
    workspace.evidenceStatus = async id => { reads++; return original(id); };
    assert.equal((await plans.view(plan))?.completed, 4); assert.equal(reads, 1);
    await writeFile(join(root, 'library', 'index.js'), 'export const changed = true;');
    const after = await plans.view(plan); assert.equal(reads, 2); assert.equal(after?.completed, 0);
    assert.equal(after?.steps[0]?.state, 'stale'); assert.deepEqual(after?.steps[3]?.blockedBy, ['a', 'b']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('three-repo task plan uses real acceptance evidence and blocks downstream after an upstream change', async () => {
  const { root, workspace } = await fixture(); const plans = new PlanStore(workspace);
  try {
    await workspace.exclusive(async () => {
      for (const repo of workspace.config.repos) await workspace.addCheck({ id: `${repo.id}-syntax`, repo: repo.id, argv: [process.execPath, '--check', 'index.js'] });
      await workspace.addCheck({ id: 'joint', repo: 'app', joint: true, argv: [process.execPath, '--input-type=module', '-e', 'const {main}=await import("./index.js");if(main()!=="v1")process.exit(1)'] });
    });
    const initial = await plans.create({ goal: 'Preserve the three-repo API contract', steps: [
      { id: 'library', repo: 'library', goal: 'Check upstream implementation', checks: ['library-syntax'] },
      { id: 'sdk', repo: 'sdk', goal: 'Check consumer', requires: ['library'], checks: ['sdk-syntax'] },
      { id: 'app', repo: 'app', goal: 'Check joint behavior', requires: ['sdk'], checks: ['app-syntax', 'joint'] },
    ] });
    assert.deepEqual((await plans.view())?.ready, ['library']);
    await assert.rejects(plans.advance('sdk', initial.revision, { phase: 'running' }), /blocked/);
    await assert.rejects(plans.advance('library', initial.revision, { phase: 'verified' }), /requires registered checks/);
    const verification = await workspace.exclusive(() => workspace.verify()); assert.equal(verification.status, 'verified');
    let updated = await plans.advance('library', 1, { phase: 'verified', evidence: verification.evidence });
    updated = await plans.advance('sdk', updated.revision, { phase: 'verified', evidence: verification.evidence });
    updated = await plans.advance('app', updated.revision, { phase: 'verified', evidence: verification.evidence });
    assert.equal((await plans.view())?.completed, 3);
    await writeFile(join(root, 'library', 'index.js'), 'export function greet() { return "changed"; }\n');
    const after = await plans.view();
    assert.equal(after?.steps[0]?.state, 'stale');
    assert.deepEqual(after?.steps[1]?.blockedBy, ['library']);
    assert.deepEqual(after?.steps[2]?.blockedBy, ['sdk']);
    assert.deepEqual(after?.impact.library, ['app', 'sdk']);
    await assert.rejects(plans.advance('library', updated.revision, { phase: 'verified', evidence: verification.evidence }), /stale/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('plans reject stale updates and preserve immutable revisions after reactivating an older plan', async () => {
  const { root, workspace } = await fixture(); const plans = new PlanStore(workspace);
  try {
    const plan = await plans.create({ goal: 'Read source', steps: [{ id: 'read', repo: 'library', goal: 'Inspect code', checks: [] }] });
    const first = await readFile(join(workspace.data, 'plans', `${plan.id}-1.json`), 'utf8');
    const advanced = await plans.advance('read', 1, { phase: 'running' }); assert.equal(advanced.revision, 2);
    await assert.rejects(plans.advance('read', 1, { phase: 'failed' }), /changed/);
    const second = await readFile(join(workspace.data, 'plans', `${plan.id}-2.json`), 'utf8');
    await plans.activate(plan.id, 1);
    const branch = await plans.advance('read', 1, { phase: 'failed', note: 'alternative attempt' }); assert.equal(branch.revision, 3);
    assert.equal(await readFile(join(workspace.data, 'plans', `${plan.id}-1.json`), 'utf8'), first);
    assert.equal(await readFile(join(workspace.data, 'plans', `${plan.id}-2.json`), 'utf8'), second);
    assert((await plans.view())?.gaps.some(gap => gap.includes('no acceptance checks')));
    const other = await plans.create({ goal: 'Another task', steps: [{ id: 'read', repo: 'library', goal: 'Different task', checks: [] }] });
    await assert.rejects(plans.advance('read', other.revision, { phase: 'running' }, plan.id), /identity/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('invalid dependency cycles and forged acceptance evidence cannot create completed plans', async () => {
  const { root, workspace } = await fixture(); const plans = new PlanStore(workspace);
  try {
    await assert.rejects(plans.create({ goal: 'Cycle', steps: [
      { id: 'a', repo: 'library', goal: 'a', requires: ['b'], checks: [] }, { id: 'b', repo: 'sdk', goal: 'b', requires: ['a'], checks: [] },
    ] }), /cycle/);
    await workspace.exclusive(() => workspace.addCheck({ id: 'check', repo: 'library', argv: [process.execPath, '--check', 'index.js'] }));
    await plans.create({ goal: 'Checked', steps: [{ id: 'a', repo: 'library', goal: 'a', checks: ['check'] }] });
    const reading = await workspace.exclusive(() => workspace.evidence('reading', { status: 'verified', results: [{ check: 'check', status: 'passed' }] }));
    await assert.rejects(plans.advance('a', 1, { phase: 'verified', evidence: reading.id }), /does not cover/);
    await assert.rejects(plans.create({ goal: 'Bad check', steps: [{ id: 'a', repo: 'library', goal: 'a', checks: ['missing'] }] }), /Unknown acceptance/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
