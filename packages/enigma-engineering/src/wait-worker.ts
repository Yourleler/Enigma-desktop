import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Workspace } from './workspace.js';
import { ensureDir, hash, readJson, writeJson, redact } from './storage.js';
import { processIdentity } from './observer.js';
import { evaluateWait, type WaitSpec, type WaitState, type TaskEvent } from './task-events.js';

async function main(path: string) {
  const spec = await readJson<WaitSpec>(path), { fingerprint, ...base } = spec;
  if (spec.schema !== 1 || hash(JSON.stringify(base)) !== fingerprint) throw new Error('Invalid wait worker input');
  const workspace = await Workspace.open(spec.root), directory = join(workspace.data, 'waits', spec.id);
  const controller=new AbortController();process.on('SIGTERM',()=>controller.abort());process.on('SIGINT',()=>controller.abort());
  const state: WaitState = { schema: 1, id: spec.id, status: 'waiting', workerPid: process.pid, workerIdentity: (await processIdentity(process.pid)).identity, updatedAt: new Date().toISOString(), polls: 0 };
  const deadline = Date.parse(spec.createdAt) + spec.timeoutMs;
  while (state.status === 'waiting') {
    if(controller.signal.aborted){state.status='cancelled';break;}
    try { const control = await readJson<{ id: string; action: string; fingerprint: string }>(join(directory, 'control.json')); if (control.id === spec.id && control.fingerprint === fingerprint && control.action === 'cancel') state.status = 'cancelled'; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (state.status !== 'waiting') break;
    if (Date.now() > deadline) { state.status = 'timeout'; break; }
    try {
      const deadlineSignal=AbortSignal.timeout(Math.max(1,deadline-Date.now()));
      const evaluation = await evaluateWait(workspace, spec.condition,AbortSignal.any([controller.signal,deadlineSignal])); state.polls++; state.result = evaluation.result; state.lastError = undefined;
      if(controller.signal.aborted){state.status='cancelled';break;}
      if(Date.now()>=deadline){state.status='timeout';break;}
      if (evaluation.done) state.status = evaluation.failed ? 'failed' : 'completed';
    } catch (error) { state.polls++; state.lastError = redact(String(error), workspace.secrets); }
    state.updatedAt = new Date().toISOString(); await writeJson(join(directory, 'state.json'), JSON.parse(redact(JSON.stringify(state), workspace.secrets)));
    if (state.status === 'waiting')await delay(Math.min(spec.pollMs,Math.max(1,deadline-Date.now())),undefined,{signal:controller.signal}).catch(()=>{state.status='cancelled';});
  }
  state.updatedAt = new Date().toISOString(); await writeJson(join(directory, 'state.json'), state);
  const event: TaskEvent = { schema: 1, id: `event-${spec.id}`, watch: spec.id, task: spec.task, entry: spec.entry, label: spec.label, outcome: state.status,
    result: state.result ?? { error: state.lastError ?? state.status }, createdAt: new Date().toISOString(), observation: spec.observation, resume: state.status==='cancelled'?false:spec.resume ?? false };
  await writeJson(join(await ensureDir(join(workspace.data, 'events')), `${event.id}.json`), JSON.parse(redact(JSON.stringify(event), workspace.secrets)));
}
if (!process.argv[2]) process.exitCode = 1;
else void main(process.argv[2]).catch(error => { process.stderr.write(String(error)); process.exitCode = 1; });
