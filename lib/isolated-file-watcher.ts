// Native recursive registration can block in macOS protected-folder access.
// Keep it off the server event loop so configuration/health remain responsive.
import { Worker } from 'node:worker_threads';

export type IsolatedFileWatcher = { ready: Promise<void>; close: () => Promise<void> };
type WatchOptions = {
  recursive?: boolean;
  onReady?: (root: string) => void;
  root: string;
  onEvent: (filename: string | null) => void;
  onError: (err: Error) => void;
};

// Inline source keeps the watcher available in both source and bundled servers.
const watcherSource = `
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
let watcher;
try {
  const root = fs.realpathSync(workerData.root);
  watcher = fs.watch(root, { recursive: workerData.recursive, persistent: true }, (event, filename) => {
    parentPort.postMessage({ type: 'event', filename: filename == null ? null : String(filename) });
  });
  watcher.on('error', error => parentPort.postMessage({ type: 'error', message: error.message, code: error.code }));
  parentPort.postMessage({ type: 'ready', root });
} catch (error) {
  parentPort.postMessage({ type: 'error', message: error.message, code: error.code });
  parentPort.close();
}
parentPort.on('message', message => {
  if (message === 'close') { watcher?.close(); parentPort.close(); }
});
`;

/** Exported to verify that slow native registration never blocks its host. */
export function createIsolatedFileWatcher(
  options: WatchOptions,
  source = watcherSource,
  startupMs = 5000,
): IsolatedFileWatcher {
  let closed = false;
  let settled = false;
  let resolveReady!: () => void;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ready = new Promise<void>(resolve => { resolveReady = resolve; });
  const settle = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolveReady();
  };

  let worker: Worker;
  try {
    worker = new Worker(source, { eval: true, workerData: { root: options.root, recursive: options.recursive ?? false } });
  } catch (error) {
    // Degrade to the service's baseline sweep if worker creation itself fails.
    queueMicrotask(() => { if (!closed) options.onError(error instanceof Error ? error : new Error(String(error))); });
    settle();
    return { ready, close: async () => { closed = true; } };
  }
  timer = setTimeout(() => {
    if (closed || settled) return;
    settle();
    const message = '文件监听仍在等待系统响应；设置和对话可以继续使用，文件变化可能延迟显示。';
    options.onError(Object.assign(new Error(message), { code: 'file_watch_startup_timeout', safeMessage: message }));
  }, startupMs);
  timer.unref();
  worker.on('error', error => { settle(); if (!closed) options.onError(error); });
  worker.on('exit', code => {
    settle();
    if (!closed && code !== 0) options.onError(new Error(`Workspace watcher exited (${code})`));
  });
  worker.on('message', message => {
    if (closed) return;
    if (message.type === 'ready') { options.onReady?.(message.root); settle(); return; }
    if (message.type === 'error') { settle(); options.onError(Object.assign(new Error(String(message.message)), { code: message.code })); return; }
    if (message.type === 'event') options.onEvent(message.filename == null ? null : String(message.filename));
  });
  // Registering the message handler refs the port; unref after attaching it.
  worker.unref();

  return {
    ready,
    close: async () => {
      if (closed) return;
      closed = true;
      settle();
      worker.postMessage('close');
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        // Native calls may not accept V8 termination immediately. Do not hold
        // app shutdown hostage; the unref'ed worker can finish with the process.
        await Promise.race([
          worker.terminate(),
          new Promise<void>(resolve => { deadline = setTimeout(resolve, 1000); deadline.unref(); }),
        ]);
      } finally {
        clearTimeout(deadline);
        worker.removeAllListeners('message');
      }
    },
  };
}
