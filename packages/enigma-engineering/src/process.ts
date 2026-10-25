import { spawn } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ProcessResult } from './types.js';
import { emitActivity, measured, type ActivitySink } from './telemetry.js';
import { guardedArgv } from './execution-boundary.js';

const cancellation = new AsyncLocalStorage<AbortSignal>();
/** Apply a run's cancellation to nested domain probes as well as its tools. */
export async function withProcessCancellation<T>(signal: AbortSignal | undefined, action: () => Promise<T>): Promise<T> {
  return signal ? await cancellation.run(signal, action) : await action();
}

export async function runProcess(argv: string[], cwd: string, options: {
  signal?: AbortSignal; timeoutMs?: number; limit?: number; env?: NodeJS.ProcessEnv; activity?: ActivitySink; stdin?: string; internalGit?: boolean;
} = {}): Promise<ProcessResult> {
  const inherited = cancellation.getStore(), signal = inherited && options.signal ? AbortSignal.any([inherited, options.signal]) : inherited ?? options.signal;
  return await measured('process', { detail: argv[0] }, () => executeProcess(argv, cwd, { ...options, signal }), options.activity);
}

async function executeProcess(argv: string[], cwd: string, options: {
  signal?: AbortSignal; timeoutMs?: number; limit?: number; env?: NodeJS.ProcessEnv; activity?: ActivitySink; stdin?: string; internalGit?: boolean;
} = {}): Promise<ProcessResult> {
  if (!argv[0] || argv.some(x => x.includes('\0'))) throw new Error('Invalid command arguments');
  if (options.stdin !== undefined && Buffer.byteLength(options.stdin) > 32000000) throw new Error('Process input exceeds the 32 MB budget');
  const start = Date.now();
  const limit = options.limit ?? 64_000;
  if (!Number.isInteger(limit) || limit < 1 || limit > 8_000_000) throw new Error('Invalid output limit');
  const timeout = options.timeoutMs ?? 120_000;
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 3_600_000) throw new Error('Invalid command timeout');
  if (options.signal?.aborted) return {
    argv, exitCode: null, signal: null, status: 'cancelled', output: '', durationMs: 0, truncated: false,
  };
  return await new Promise(resolve => {
    const invocation = guardedArgv(argv, options.internalGit === true && argv[0] === 'git');
    const child = spawn(invocation[0]!, invocation.slice(1), {
      cwd, env: options.env ?? process.env, stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32',
    });
    if (options.stdin !== undefined) {
      child.stdin?.on('error', () => { /* Child failure is reported through its exit/result. */ });
      child.stdin?.end(options.stdin);
    }
    child.once('spawn', () => emitActivity({ kind: 'update', stage: 'process', pid: child.pid, detail: 'Process dispatched', count: 0 }, options.activity));
    let output = ''; let truncated = false; let stopped: 'cancelled' | 'timeout' | undefined;
    let error: Error | undefined; let killer: NodeJS.Timeout | undefined; let forced: NodeJS.Timeout | undefined;
    let closed = false; let exited = false; let exitCode: number | null = null; let exitSignal: string | null = null; let cleanup: 'complete' | 'unknown' = 'complete';
    const collect = (chunk: string) => {
      emitActivity({ kind: 'update', stage: 'process', pid: child.pid, count: Buffer.byteLength(chunk) }, options.activity);
      if (output.length + chunk.length > limit) truncated = true;
      output = (output + chunk).slice(0, limit);
    };
    child.stdout!.setEncoding('utf8'); child.stderr!.setEncoding('utf8');
    child.stdout!.on('data', collect); child.stderr!.on('data', collect);
    const kill = () => {
      if (!child.pid) return;
      if (exited) { cleanup = 'unknown'; return; }
      try {
        if (process.platform === 'win32') {
          const terminator = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
          terminator.on('error', () => child.kill('SIGKILL'));
          terminator.on('exit', code => { if (code) { cleanup = 'unknown'; child.kill('SIGKILL'); } });
        } else process.kill(-child.pid, 'SIGKILL');
      } catch { cleanup = 'unknown'; }
    };
    const stop = (reason: 'cancelled' | 'timeout') => {
      if (stopped) return;
      stopped = reason;
      // Kill the whole process group, including commands that outlive their parent.
      kill();
      killer = setTimeout(kill, 100);
      forced = setTimeout(() => {
        if (closed) return;
        cleanup = 'unknown'; child.stdout!.destroy(); child.stderr!.destroy();
        finish(exitCode, exitSignal);
      }, 500);
    };
    const onAbort = () => stop('cancelled');
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => stop('timeout'), timeout);
    child.once('error', err => { error = err; collect(err.message); });
    child.once('exit', (code, signal) => { exited = true; exitCode = code; exitSignal = signal; });
    const finish = (code: number | null, signal: string | null) => {
      if (closed) return; closed = true;
      clearTimeout(timer); if (killer) clearTimeout(killer); if (forced) clearTimeout(forced);
      options.signal?.removeEventListener('abort', onAbort);
      resolve({ argv, exitCode: code, signal, status: stopped ?? (error ? 'unknown' : code === 0 ? 'passed' : 'failed'),
        output, durationMs: Date.now() - start, truncated, cleanup });
    };
    child.once('close', finish);
  });
}

export async function git(root: string, args: string[]): Promise<string> {
  const result = await runProcess(['git', ...args], root, { timeoutMs: 30_000, limit: 8_000_000, internalGit: true });
  if (result.status !== 'passed' || result.truncated) throw new Error(`Git ${args[0]} failed: ${result.output}`);
  return result.output;
}
