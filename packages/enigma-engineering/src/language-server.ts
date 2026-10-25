import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { emitActivity, type ActivitySink } from './telemetry.js';

interface Response { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: { message: string } }

/** A bounded, read-only LSP connection. Server edit requests are never applied. */
export class LanguageServer {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 0;
  private buffer = Buffer.alloc(0);
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private failure?: Error;
  private output = '';
  private activityId = randomUUID();
  readonly diagnostics: string[] = [];
  constructor(argv: string[], cwd: string, private settings: Record<string, unknown>, options: { signal?: AbortSignal; env?: NodeJS.ProcessEnv; activity?: ActivitySink } = {}) {
    this.child = spawn(argv[0]!, argv.slice(1), { cwd, stdio: 'pipe', detached: process.platform !== 'win32',
      env: { ...process.env, GOPROXY: 'off', GOSUMDB: 'off', GOTOOLCHAIN: 'local', GOWORK: 'off', CGO_ENABLED: '0', GOENV: 'off', GOFLAGS: '-mod=readonly', ...options.env } });
    this.child.once('spawn', () => emitActivity({ kind: 'start', stage: 'reading.go', id: this.activityId, pid: this.child.pid, detail: 'Go language server started' }, options.activity));
    this.child.stderr.on('data', (chunk: Buffer) => { this.output = (this.output + chunk.toString()).slice(-4000); });
    this.child.stdin.on('error', error => this.fail(error));
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', () => { emitActivity({ kind: 'end', stage: 'reading.go', id: this.activityId, pid: this.child.pid, status: 'exited' }, options.activity); this.fail(new Error(`Language server exited: ${this.output}`)); });
    this.child.stdout.on('data', (chunk: Buffer) => {
      try {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        if (this.buffer.length > 8_000_000) throw new Error('Language server output exceeds budget');
        this.consume();
      } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); this.stop(); }
    });
    const abort = () => { this.fail(new Error('Language server cancelled')); this.stop(); };
    options.signal?.addEventListener('abort', abort, { once: true });
    this.child.once('close', () => options.signal?.removeEventListener('abort', abort));
    if (options.signal?.aborted) abort();
  }
  private fail(error: Error) {
    this.failure ??= error;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(this.failure); }
    this.pending.clear();
  }
  private consume() {
    while (true) {
      const boundary = this.buffer.indexOf('\r\n\r\n'); if (boundary < 0) return;
      const match = /^Content-Length:\s*(\d+)$/im.exec(this.buffer.subarray(0, boundary).toString());
      if (!match) throw new Error('Language server frame has no content length');
      const length = Number(match[1]); if (length > 8_000_000) throw new Error('Language server frame exceeds budget');
      if (this.buffer.length < boundary + 4 + length) return;
      const message = JSON.parse(this.buffer.subarray(boundary + 4, boundary + 4 + length).toString()) as Response;
      this.buffer = this.buffer.subarray(boundary + 4 + length);
      if (message.method && message.id !== undefined) {
        if (message.method === 'workspace/configuration') {
          const items = (message.params as { items?: unknown[] } | undefined)?.items ?? [];
          this.send({ jsonrpc: '2.0', id: message.id, result: items.map(() => this.settings) });
        } else if (['client/registerCapability', 'window/workDoneProgress/create'].includes(message.method)) this.send({ jsonrpc: '2.0', id: message.id, result: null });
        else if (message.method === 'workspace/applyEdit') this.send({ jsonrpc: '2.0', id: message.id, result: { applied: false, failureReason: 'Source reading is read-only' } });
        else this.send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Client method unavailable' } });
      } else if (typeof message.id === 'number') {
        const pending = this.pending.get(message.id); if (!pending) continue;
        this.pending.delete(message.id); clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
      } else if (message.method === 'textDocument/publishDiagnostics') {
        const report = message.params as { diagnostics?: { message: string; severity?: number }[] };
        for (const item of report.diagnostics ?? []) if (item.severity === 1 && this.diagnostics.length < 30) this.diagnostics.push(item.message);
      }
    }
  }
  private send(value: unknown) {
    if (this.failure) throw this.failure;
    const body = Buffer.from(JSON.stringify(value));
    this.child.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]));
  }
  notify(method: string, params: unknown) { this.send({ jsonrpc: '2.0', method, params }); }
  async request<T>(method: string, params: unknown, timeoutMs = 30_000): Promise<T> {
    if (this.failure) throw this.failure;
    const id = ++this.nextId;
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        try { this.notify('$/cancelRequest', { id }); } catch { /* Original timeout remains authoritative. */ }
        reject(new Error(`Language server timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      try { this.send({ jsonrpc: '2.0', id, method, params }); } catch (error) { this.pending.delete(id); clearTimeout(timer); reject(error); }
    });
  }
  private stop() {
    if (this.child.exitCode !== null || this.child.signalCode !== null || !this.child.pid) return;
    try {
      if (process.platform === 'win32') {
        const terminator = spawn('taskkill', ['/pid', String(this.child.pid), '/T', '/F'], { stdio: 'ignore' });
        terminator.on('error', () => this.child.kill()); terminator.on('exit', code => { if (code) this.child.kill(); });
      } else process.kill(-this.child.pid, 'SIGKILL');
    } catch { /* Exit may have raced the signal. */ }
  }
  async close() {
    try { await this.request('shutdown', null, 1000); this.notify('exit', null); } catch { /* Failed server still needs cleanup. */ }
    this.stop();
    if (this.child.exitCode === null && this.child.signalCode === null) await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 1000); this.child.once('close', () => { clearTimeout(timer); resolve(); });
    });
    this.fail(new Error('Language server connection closed'));
  }
}
