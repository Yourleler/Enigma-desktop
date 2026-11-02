import type { PreviewItem } from '../types';
import { useStore } from '../stores';
import { upsertPreviewItem } from '../stores/preview-actions';
import { capturePreviewContext, previewConnectionKey } from './preview-context';
import { isRemoteWorkbenchContentRef, readRemotePreviewItem, saveRemoteWorkbenchContent } from './remote-file-preview';
import { parseMarkdownCover, removeMarkdownCover, updateMarkdownCoverLayout, type MarkdownCoverLayoutPatch } from './markdown-cover';

export type CoverMutation = { kind: 'layout'; layout: MarkdownCoverLayoutPatch } | { kind: 'remove' };
const pending = new Map<string, Promise<unknown>>();
export function markdownCoverFileIdentity(item: PreviewItem): string {
  const ref = item.remoteContentRef;
  return JSON.stringify([item.filePath, ref?.kind, ref?.mountId, ref?.rootId, ref?.subdir, ref?.name]);
}
export function mutateMarkdownCover(item: PreviewItem, mutation: CoverMutation): Promise<PreviewItem | null> {
  const owns = capturePreviewContext(), platform = window.platform;
  const key = JSON.stringify([previewConnectionKey(), item.filePath, item.remoteContentRef?.kind, item.remoteContentRef?.mountId, item.remoteContentRef?.rootId, item.remoteContentRef?.subdir, item.remoteContentRef?.name]);
  const image = parseMarkdownCover(item.content)?.image;
  const work = (pending.get(key) || Promise.resolve()).catch(() => { }).then(async () => {
    if (!owns()) return null;
    for (let attempt = 0;attempt < 2;attempt++) {
      let current = item;
      if (isRemoteWorkbenchContentRef(item.remoteContentRef)) current = await readRemotePreviewItem(item);
      else if (item.filePath && platform?.readFileSnapshot) { const read = await platform.readFileSnapshot(item.filePath); if (!read) throw Error('文件暂不可读取，封面没有保存。'); current = { ...item, content: read.content, fileVersion: read.version }; }
      if (!owns()) return null;
      const currentImage = parseMarkdownCover(current.content)?.image;
      if (currentImage !== image) throw Error('封面已被更换或移除，请核对当前文件后重新调整。');
      const content = mutation.kind === 'remove' ? removeMarkdownCover(current.content) : updateMarkdownCoverLayout(current.content, mutation.layout);
      if (content === current.content) return current;
      if (!current.fileVersion) throw Error('没有取得文件版本，封面尚未保存，请重新打开文件。');
      const result = isRemoteWorkbenchContentRef(item.remoteContentRef)
        ? await saveRemoteWorkbenchContent(item.remoteContentRef, content, current.fileVersion)
        : item.filePath && platform?.writeFileIfUnchanged ? await platform.writeFileIfUnchanged(item.filePath, content, current.fileVersion) : null;
      if (!owns()) return null;
      if (result?.ok) {
        const saved = { ...current, content, fileVersion: result.version ?? null };
        const cached = useStore.getState().previewItems.find(value => value.id === item.id);
        if (cached && cached.type === item.type && cached.filePath === item.filePath && markdownCoverFileIdentity(cached) === markdownCoverFileIdentity(item) && (cached.content === current.content || cached.content === saved.content)) upsertPreviewItem({ ...cached, content, fileVersion: saved.fileVersion });
        return saved;
      }
      if (!result?.conflict) throw Error('封面保存未确认，请重新读取后重试。');
    }
    throw Error('文件仍在被其他操作修改，封面尚未保存，请稍后重试。');
  });
  pending.set(key, work);
  void work.finally(() => { if (pending.get(key) === work) pending.delete(key); }).catch(() => { });
  return work;
}
