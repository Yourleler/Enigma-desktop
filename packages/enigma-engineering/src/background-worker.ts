import { guardedArgv } from './execution-boundary.js';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { processIdentity } from './observer.js';
import { readJson, redact, writeJson, hash } from './storage.js';
import type { BackgroundSpec, BackgroundState } from './background.js';

async function main(path: string) {
  const spec = await readJson<BackgroundSpec>(path), { fingerprint, ...base } = spec;
  if (spec.schema !== 1 || hash(JSON.stringify(base)) !== fingerprint || await realpath(spec.cwd) !== spec.cwd) throw new Error('Invalid background worker specification');
  const directory = join(spec.root, '.enigma-next', 'background', spec.id);
  const secrets = Object.entries(process.env).filter(([name]) => /KEY|TOKEN|SECRET|PASSWORD/.test(name)).map(([, value]) => value ?? '').filter(value => value.length >= 8);
  const state: BackgroundState = { schema: 1, id: spec.id, fingerprint, status: 'starting', workerPid: process.pid, workerIdentity: (await processIdentity(process.pid)).identity,
    observedAt: new Date().toISOString(), output: '', outputBytes: 0, truncated: false };
  let chain = Promise.resolve();
  const save = () => { state.observedAt = new Date().toISOString(); const snapshot = structuredClone(state); chain = chain.then(() => writeJson(join(directory, 'state.json'), snapshot)); return chain; };
  await save();
  const env = { ...process.env, ENIGMA_BACKGROUND_RUN: spec.id };
  for (const [name, reference] of Object.entries(spec.envRefs ?? {})) { const value = process.env[reference]; if (value === undefined) throw new Error('Command environment reference became unavailable'); (env as NodeJS.ProcessEnv)[name] = value; }
  const invocation = guardedArgv(spec.argv);
  const child = spawn(invocation[0]!, invocation.slice(1), { cwd: spec.cwd, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  let stopped: 'cancelled' | 'timeout' | undefined, ended = false, exited = false, cleanup: 'complete' | 'unknown' = 'complete';
  let lineBuffer = '';
  const collect = (chunk: Buffer) => {
    state.outputBytes += chunk.length; state.truncated ||= state.outputBytes > 1_000_000;
    state.output = redact((state.output + chunk.toString()).slice(-64_000), secrets).slice(-32_000);
    if (spec.portPrefix && !state.port) {
      lineBuffer = (lineBuffer + chunk.toString()).slice(-8000);
      for (const line of lineBuffer.split('\n')) if (line.startsWith(spec.portPrefix)) {
        const port = Number(/^\s*(\d+)/.exec(line.slice(spec.portPrefix.length))?.[1]); if (port > 0 && port <= 65535) state.port = port;
      }
    }
  };
  child.stdout.on('data', collect); child.stderr.on('data', collect);
  let identityTask: Promise<void> = Promise.resolve();
  child.once('spawn', () => { identityTask = (async () => { state.childPid = child.pid; state.childIdentity = child.pid ? (await processIdentity(child.pid)).identity : undefined; if (!ended) { state.status = 'running'; await save(); } })().catch(error => { state.error = redact(String(error), secrets); }); });
  const kill = () => {
    if (!child.pid || exited) return;
    try {
      if (process.platform === 'win32') {
        const command = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        command.on('error', () => { cleanup = 'unknown'; child.kill(); }); command.on('exit', code => { if (code) { cleanup = 'unknown'; child.kill(); } });
      } else process.kill(-child.pid, 'SIGKILL');
    } catch { cleanup = 'unknown'; }
  };
  let force: NodeJS.Timeout | undefined;
  const stop = (reason: 'cancelled' | 'timeout') => {
    if (stopped || ended) return; stopped = reason; kill();
    // Windows taskkill has a separate process-tree teardown latency; still require actual close before claiming cancellation.
    force = setTimeout(() => { if (ended) return; cleanup = 'unknown'; child.stdout.destroy(); child.stderr.destroy(); finish(null, null); }, process.platform === 'win32' ? 5000 : 1000);
  };
  const timer = setTimeout(() => stop('timeout'), spec.maxRuntimeMs);
  let polling = false;
  const interval = setInterval(() => { if (polling || ended) return; polling = true;
    void (async () => {
      try { const control = await readJson<{ id: string; fingerprint: string; action: string }>(join(directory, 'control.json'));
        if (control.id === spec.id && control.fingerprint === spec.fingerprint && control.action === 'cancel') stop('cancelled');
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') state.error = redact(String(error), secrets); }
      await save();
    })().catch(() => stop('cancelled')).finally(() => { polling = false; });
  }, 300);
  process.once('SIGTERM', () => stop('cancelled')); process.once('SIGINT', () => stop('cancelled'));
  child.once('exit', () => { exited = true; });
  child.once('error', error => { state.error = redact(String(error), secrets); finish(null, null); });
  const finish = (code: number | null, signal: string | null) => {
    if (ended) return; ended = true; clearInterval(interval); clearTimeout(timer); if (force) clearTimeout(force);
    // A fast command can exit while its OS identity probe still owns a process
    // and cwd. Settle that owned handle before publishing the terminal receipt.
    void identityTask.then(async () => {
      state.status = cleanup === 'unknown' ? 'unknown' : stopped ?? (code === 0 ? 'passed' : 'failed'); state.exitCode = code; state.signal = signal; state.cleanup = cleanup;
      await save(); process.exitCode = state.status === 'passed' || state.status === 'cancelled' ? 0 : 1;
    });
  };
  child.once('close', finish);
  // Child handles and lifecycle polling keep this worker alive until its terminal receipt is written.
}
const path = process.argv[2];
if (!path) process.exitCode = 1;
else void main(path).catch(error => { process.stderr.write(String(error)); process.exitCode = 1; });
