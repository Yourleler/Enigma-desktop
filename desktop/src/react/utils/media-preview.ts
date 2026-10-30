import type { FileRef } from '../types/file-ref';
import { openPreview } from '../stores/preview-actions';
import type { RemoteContentRef } from '../types';

export function openMediaPreview(file: FileRef, remoteContentRef?: RemoteContentRef, placement?:'files'|'tab') {
  openPreview({id: `media:${file.id}`, type: 'media', title: file.name, content: '',
    filePath: file.path || undefined, ext: file.ext, mediaRef: file, status: file.status,
    fileVersion: file.version, remoteContentRef},{placement});
}
