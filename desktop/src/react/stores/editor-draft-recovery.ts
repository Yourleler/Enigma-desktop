import type {FileVersion, RemoteWorkbenchContentRef} from '../types';
import type {ServerConnection} from '../services/server-connection';

export interface EditorDraftCopy {
  id: string;
  scope: string;
  key: string;
  text: string;
  baseVersion: FileVersion | null;
  updatedAt: number;
}
const PREFIX = 'enigma-editor-recovery-v1:';

/** Stable file and principal identity; never store credentials or signed URLs. */
export function editorRecoveryScope(connection: ServerConnection | null | undefined): string {
  if (!connection?.serverId) return '';
  let endpoint = 'local';
  if (connection.kind !== 'local') {
    try { const url = new URL(connection.baseUrl); endpoint = url.origin + url.pathname; }
    catch { return ''; }
  }
  return JSON.stringify([connection.serverId, connection.studioId || '', connection.userId || '', endpoint]);
}
export function editorRecoveryKey(filePath?: string, remote?: RemoteWorkbenchContentRef | null): string {
  if (remote) return JSON.stringify(['workbench', remote.mountId || remote.rootId || 'default', remote.subdir, remote.name]);
  return filePath ? JSON.stringify(['file', filePath]) : '';
}

/** Immutable per-edit records prevent a late save from deleting a newer copy. */
export class EditorDraftRecovery {
  constructor(private storage: Storage) {}
  write(copy: EditorDraftCopy, previous?: EditorDraftCopy | null) {
    // Write first: quota errors must not remove the last good recovery copy.
    this.storage.setItem(PREFIX + copy.id, JSON.stringify(copy));
    if (previous && previous.id !== copy.id) this.remove(previous);
  }
  remove(copy: EditorDraftCopy) { this.storage.removeItem(PREFIX + copy.id); }
  list(scope: string, key: string): EditorDraftCopy[] {
    const result: EditorDraftCopy[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const id = this.storage.key(i);
      if (!id?.startsWith(PREFIX)) continue;
      try {
        const copy = JSON.parse(this.storage.getItem(id) || 'null');
        if (copy?.scope === scope && copy.key === key && typeof copy.id === 'string' && id === PREFIX + copy.id
          && typeof copy.text === 'string' && Number.isFinite(copy.updatedAt)) result.push(copy);
      } catch { /* Leave malformed backups intact for manual recovery. */ }
    }
    return result.sort((a, b) => b.updatedAt - a.updatedAt);
  }
}
