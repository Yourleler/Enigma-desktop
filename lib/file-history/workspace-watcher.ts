import fsp from 'node:fs/promises';
import path from 'node:path';
import { createIsolatedFileWatcher, type IsolatedFileWatcher } from '../isolated-file-watcher.ts';
import { isIgnoredRelPath } from './text-file-policy.ts';

export type WorkspaceWatcher = IsolatedFileWatcher;
type WatchOptions = {
  root: string;
  onChanged: (relPath: string) => void;
  onDeleted: (relPath: string) => void;
  onError: (err: Error) => void;
};

/** Native registration is isolated so a protected workspace cannot freeze settings. */
export function createIsolatedWorkspaceWatcher(options: WatchOptions, source?: string, startupMs?: number): WorkspaceWatcher {
  let closed = false;
  let resolvedRoot = options.root;
  const watcher = createIsolatedFileWatcher({
    root: options.root,
    recursive: true,
    onReady: root => { resolvedRoot = root; },
    onError: options.onError,
    onEvent: filename => {
      if (filename == null) { options.onError(new Error('workspace watch event without filename')); return; }
      const rel = filename.split(path.sep).join('/');
      if (!rel || path.isAbsolute(rel) || rel.split('/').includes('..') || isIgnoredRelPath(rel)) return;
      void fsp.stat(path.join(resolvedRoot, ...rel.split('/'))).then(stat => {
        if (!closed && stat.isFile()) options.onChanged(rel);
      }, (error: NodeJS.ErrnoException) => {
        if (closed) return;
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') options.onDeleted(rel);
        else options.onError(error);
      });
    },
  }, source, startupMs);
  return { ready: watcher.ready, close: async () => { closed = true; await watcher.close(); } };
}

export function createWorkspaceWatcher(options: WatchOptions): WorkspaceWatcher {
  return createIsolatedWorkspaceWatcher(options);
}
