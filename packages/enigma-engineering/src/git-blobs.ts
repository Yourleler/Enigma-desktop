import { spawn } from 'node:child_process';
import { guardedArgv } from './execution-boundary.js';
import { runProcess } from './process.js';

/** Git's batch protocol is length-delimited, so binary bytes and embedded
 * newlines cannot be confused with headers. Only one bounded blob is held.
 * https://git-scm.com/docs/git-cat-file#_batch_output */
export async function* readGitBlobs(root: string, oids: string[], options: { signal?: AbortSignal; maxBytes?: number } = {}): AsyncGenerator<{ oid: string; size: number; bytes?: Buffer }> {
  if (!oids.length) return;
  if (oids.length > 50000 || oids.some(oid => !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(oid))) throw new Error('Invalid Git blob identities');
  const maxBytes = options.maxBytes ?? 512000;
  const metadata = await runProcess(['git', 'cat-file', '--batch-check'], root, { internalGit: true, stdin: oids.join('\n')+'\n', signal: options.signal, timeoutMs: 30000, limit: 8000000 });
  options.signal?.throwIfAborted();
  if (metadata.status !== 'passed' || metadata.truncated) throw new Error(`Git blob inspection failed: ${metadata.output.slice(0, 1000)}`);
  const lines = metadata.output.trimEnd().split('\n');
  if (lines.length !== oids.length) throw new Error('Incomplete Git blob metadata');
  const entries = lines.map((line, index) => {
    const match = /^([a-f0-9]+) blob (\d+)$/.exec(line);
    const size = Number(match?.[2]);
    if (!match || match[1] !== oids[index] || !Number.isSafeInteger(size) || size < 0) throw new Error('Invalid Git blob metadata');
    return { oid: oids[index]!, size };
  });
  const small = entries.filter(entry => entry.size <= maxBytes);
  if (!small.length) { for (const entry of entries) { options.signal?.throwIfAborted(); yield entry; } return; }
  const argv = guardedArgv(['git', 'cat-file', '--batch'], true);
  const child = spawn(argv[0]!, argv.slice(1), { cwd: root, stdio: ['pipe','pipe','pipe'], detached: process.platform !== 'win32' });
  let stderr = '', failure: Error | undefined, finished = false, timedOut = false;
  const done = new Promise<number | null>(resolve => {
    child.once('error', error => { failure = error; });
    child.once('close', code => { finished = true; resolve(code); });
  });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(0, 4000); });
  child.stdin.on('error', () => { /* Exit status is checked after reading. */ });
  const stop = () => {
    if (finished || !child.pid) return;
    try { if (process.platform === 'win32') child.kill('SIGKILL'); else process.kill(-child.pid, 'SIGKILL'); } catch { /* May already have exited. */ }
  };
  const abort = () => stop();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => { timedOut = true; stop(); }, 120000);
  child.stdin.end(small.map(entry => entry.oid).join('\n')+'\n');
  const iterator = child.stdout[Symbol.asyncIterator]();
  let pending = Buffer.alloc(0);
  const more = async () => {
    options.signal?.throwIfAborted();
    const next = await iterator.next();
    if (next.done) throw new Error(timedOut ? 'Git blob reading timed out' : `Incomplete Git blob contents${failure ? `: ${failure.message}` : stderr ? `: ${stderr}` : ''}`);
    pending = pending.length ? Buffer.concat([pending, next.value]) : next.value;
  };
  const take = async (length: number): Promise<Buffer> => {
    while (pending.length < length) await more();
    const value = pending.subarray(0, length); pending = pending.subarray(length); return value;
  };
  try {
    options.signal?.throwIfAborted();
    for (const entry of entries) {
      options.signal?.throwIfAborted();
      if (entry.size > maxBytes) { yield entry; continue; }
      while (pending.indexOf(10) < 0) { if (pending.length > 160) throw new Error('Invalid Git batch header'); await more(); }
      const end = pending.indexOf(10), header = (await take(end+1)).toString('ascii');
      if (header !== `${entry.oid} blob ${entry.size}\n`) throw new Error('Git blob changed between metadata and content reads');
      const bytes = Buffer.from(await take(entry.size));
      if ((await take(1))[0] !== 10) throw new Error('Invalid Git blob delimiter');
      yield { ...entry, bytes };
    }
    if (pending.length || !(await iterator.next()).done) throw new Error('Unexpected Git batch output');
    const code = await done; options.signal?.throwIfAborted();
    if (code !== 0 || failure || timedOut) throw new Error(`Git blob reading failed: ${failure?.message || stderr || code}`);
  } finally {
    clearTimeout(timeout); options.signal?.removeEventListener('abort', abort); stop();
    child.stdout.destroy(); child.stderr.destroy(); await done;
  }
}
