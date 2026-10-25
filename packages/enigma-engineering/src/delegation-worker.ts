import { join, dirname } from 'node:path';
import { realpath } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Workspace } from './workspace.js';
import { hash, readJson, redact, writeJson } from './storage.js';
import { processIdentity } from './observer.js';
import type { DelegationSpec, DelegationState } from './delegation.js';
import { runCodexHandoff } from './codex-handoff.js';
import { BackgroundRuns } from './background.js';

async function main(path: string) {
  const phase = (name: string) => process.stderr.write(`${new Date().toISOString()} delegation phase: ${name}\n`);
  phase('specification');
  const spec = await readJson<DelegationSpec>(path), { fingerprint, ...base } = spec;
  if (spec.schema !== 1 || hash(JSON.stringify(base)) !== fingerprint || await realpath(spec.workspace) !== spec.workspace) throw new Error('Invalid child task specification');
  const workspace = await Workspace.open(spec.workspace), directory = dirname(path), controller = new AbortController();
  if (process.env.ENIGMA_WORKER_DIAGNOSTIC === '1') {
    let logged = 0;
    workspace.activity = event => { if (event.kind === 'end' && logged++ < 200) process.stderr.write(`${new Date().toISOString()} probe: ${event.stage} ${event.status} ${Math.round(event.durationMs ?? 0)}ms\n`); };
  }
  phase('workspace');
  const state: DelegationState = { schema: 1, id: spec.id, fingerprint: spec.fingerprint, status: 'running', workerPid: process.pid, workerIdentity: (await processIdentity(process.pid)).identity, updatedAt: new Date().toISOString(), requests: 0, tools: 0 };
  let chain = Promise.resolve(), publicationFailed = false, stopped: 'cancelled' | 'timeout' | undefined, polling = false, finished = false, outcome: DelegationState['status'] = 'failed';
  const save = () => { state.updatedAt = new Date().toISOString(); const snapshot = JSON.parse(redact(JSON.stringify(state), workspace.secrets)); chain = chain.catch(() => {}).then(() => writeJson(join(directory, 'state.json'), snapshot)).catch(error => { publicationFailed = true; throw error; }); return chain; };
  const stop = (reason: 'cancelled' | 'timeout') => { stopped ??= reason; controller.abort(); };
  await save();
  const timer = setTimeout(() => stop('timeout'), spec.timeoutMs), interval = setInterval(() => {
    if (polling || finished) return; polling = true;
    void (async () => {
      try { const control = await readJson<{ id: string; action: string; fingerprint: string }>(join(directory, 'control.json')); if (control.id === spec.id && control.fingerprint === fingerprint && control.action === 'cancel') stop('cancelled'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') state.error = redact(String(error), workspace.secrets); }
      await save();
    })().catch(error => { state.error = redact(String(error), workspace.secrets); stop('cancelled'); }).finally(() => { polling = false; });
  }, 500);
  process.once('SIGTERM', () => stop('cancelled')); process.once('SIGINT', () => stop('cancelled'));
  try {
    if (spec.target === 'pi') {
      phase('sdk-import');
      const runner = await import('./pi-delegation-run.js');
      const result = await runner.runPiDelegation(workspace, spec, { signal: controller.signal, update: values => { if (values.phase) phase(values.phase); Object.assign(state, values); } });
      const { status, ...details } = result; Object.assign(state, details); outcome = status as DelegationState['status'];
    } else {
      const result = await runCodexHandoff(workspace, spec.handoff, { writable: spec.writeRepos.length > 0, signal: controller.signal, timeoutMs: spec.timeoutMs, model: spec.model });
      outcome = result.report.cleanup === 'unknown' || result.report.status === 'unknown' ? 'unknown' : result.report.status === 'passed' && result.report.answer ? 'completed' : result.report.status === 'cancelled' ? 'cancelled' : result.report.status === 'timeout' ? 'timeout' : 'failed';
      state.answer = result.report.answer?.slice(0, 24000); state.thread = result.report.threadId; state.targetUsage = { modelRequests: 'not exposed by the public CLI adapter', timeBudgetMs: spec.timeoutMs };
      state.verification = { status: 'unverified', note: 'Codex completion is not fresh parent acceptance' }; state.observation = await workspace.observe();
    }
  } catch (error) { outcome = stopped ?? 'failed'; state.error = redact(String(error), workspace.secrets); }
  finally {
    state.phase = 'teardown';
    phase('teardown');
    try {
      const runs = new BackgroundRuns(workspace);
      for (const run of await runs.list()) if (!run.terminal) { const ended = await runs.cancel(run.spec.id); if (!ended.terminal || ended.state.status === 'unknown') outcome = 'unknown'; }
      if ((await runs.unresolved()).length || (await workspace.operations()).some(op => ['pending', 'unknown'].includes(op.status))) outcome = 'unknown';
      state.observation = await workspace.observe();
    } catch (error) { outcome = 'unknown'; state.error = redact(String(error), workspace.secrets); }
    finished = true; clearTimeout(timer); clearInterval(interval); while (polling) await delay(25);
    state.status = publicationFailed || outcome === 'unknown' ? 'unknown' : stopped ?? outcome; await save(); await chain;
    phase(`settled:${state.status}`);
  }
}
if (!process.argv[2]) process.exitCode = 1;
else void main(process.argv[2]).catch(error => { process.stderr.write(String(error)); process.exitCode = 1; });
