import { useState } from 'react';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import type { FileVersion } from '../../types';
import styles from './PreviewSaveNotice.module.css';

type ExternalContent = { content: string; fileVersion: FileVersion | null; noticeShown: boolean };

/** 源码只读提示：与保存提示同处编辑器上方、同一套样式，说明为何不能修改。 */
export function PreviewSourceReadOnlyNotice({message}: {message: string}) {
  return <section className={styles.notice} data-preview-save-notice="" data-preview-source-readonly="" aria-label="源码只读">
    <p role="status">{message}</p>
  </section>;
}

/** Save state reported by the editor; it survives the editor unmounting. */
export type PreviewPendingSaveKind = 'failed' | 'conflict' | 'recovered' | 'draft';
const pendingSaveFallback: Record<PreviewPendingSaveKind | 'label' | 'action', string> = {
  label: '文件保存状态',
  failed: '修改尚未保存到文件。预览显示的是草稿，可回到源码重试保存。',
  conflict: '文件有外部更新，自动保存已暂停。预览显示的是你的草稿，请回到源码比较后再决定。',
  recovered: '已恢复一份未保存的草稿，自动保存已暂停。预览显示的是该草稿；回到源码与磁盘版本比较后再决定如何保存。',
  draft: '有一份尚未写入文件的草稿。预览显示的是磁盘上的版本，回到源码可恢复并比较。',
  action: '回到源码处理',
};
function pendingSaveText(key: keyof typeof pendingSaveFallback) {
  const path = `preview.pendingSave.${key}`, value = window.t?.(path);
  return typeof value === 'string' && value && value !== path ? value : pendingSaveFallback[key];
}

/** Rendered preview: the editor (and its full notice) is unmounted, so keep the
 *  unresolved save visible here and offer the way back to the source editor. */
export function PreviewPendingSaveNotice({kind, onReturnToSource}: {kind: PreviewPendingSaveKind; onReturnToSource: () => void}) {
  return <section className={`${styles.notice} ${styles.pending}`} data-preview-save-notice="" data-preview-pending-save={kind} aria-label={pendingSaveText('label')}>
    <p role="status">{pendingSaveText(kind)}</p>
    <div className={styles.actions}>
      <button type="button" onClick={onReturnToSource}>{pendingSaveText('action')}</button>
    </div>
  </section>;
}

/** Saving failures stay beside the affected document until resolved. */
export function PreviewSaveNotice({issue, external, refreshing, onCopy, onRefresh, onRetry, onResolve, recovered=false, copies=[], onSelectCopy}: {
  recovered?: boolean;
  copies?: {id:string;updatedAt:number;text:string}[];
  onSelectCopy?: (id:string)=>void;
  issue: {conflict: boolean; message: string};
  external: ExternalContent | null;
  refreshing: boolean;
  onCopy: () => Promise<void>;
  onRefresh: () => void;
  onRetry: () => void;
  onResolve: (keepDraft: boolean, expected: ExternalContent) => void;
}) {
  const [copied, setCopied] = useState(false), [copyError, setCopyError] = useState('');
  const [choice, setChoice] = useState<{keepDraft: boolean; external: ExternalContent} | null>(null);
  return <section className={styles.notice} data-preview-save-notice="" aria-label="文件保存状态">
    <p role="status">{recovered ? '已恢复未保存的草稿。自动保存已暂停，请比较磁盘版本后选择如何保存。' : issue.conflict ? '文件有外部更新，自动保存已暂停。当前草稿仍保留在编辑器中。' : '文件尚未保存。当前草稿仍保留在编辑器中，可重试保存。'}</p>
    {copies.length>1 && <details><summary>其他恢复副本（{copies.length}）</summary>{copies.map(copy=><details key={copy.id}><summary>{new Date(copy.updatedAt).toLocaleString()}</summary><pre>{copy.text}</pre><div className={styles.actions}><button type="button" onClick={()=>onSelectCopy?.(copy.id)}>查看此副本</button></div></details>)}</details>}
    {issue.message && <details><summary>错误详情</summary><p>{issue.message}</p></details>}
    {external && <details><summary>查看外部版本</summary><pre>{external.content}</pre></details>}
    <div className={styles.actions}>
      <button type="button" onClick={()=>void Promise.resolve().then(onCopy).then(()=>{setCopied(true);setCopyError('');},()=>setCopyError('未能复制，请在编辑器中选中草稿后复制。'))}>{copied?'已复制草稿':'复制草稿'}</button>
      {issue.conflict ? <>
        <button type="button" disabled={refreshing} onClick={onRefresh}>{refreshing?'正在读取…':'重新读取外部版本'}</button>
        {external?.fileVersion && <>
          <button type="button" onClick={()=>setChoice({keepDraft: false, external})}>采用外部版本…</button>
          <button type="button" onClick={()=>setChoice({keepDraft: true, external})}>保存当前草稿…</button>
        </>}
      </> : <button type="button" onClick={onRetry}>重试保存</button>}
    </div>
    {copyError && <p role="alert">{copyError}</p>}
    <ConfirmDialog open={!!choice} scope="window" title={choice?.keepDraft?'用当前草稿替换外部版本？':'采用外部版本？'}
      confirmLabel={choice?.keepDraft?'保存当前草稿':'采用外部版本'} cancelLabel="继续比较" onCancel={()=>setChoice(null)}
      onConfirm={()=>{if(choice)onResolve(choice.keepDraft, choice.external);setChoice(null);}}>
      {choice?.keepDraft?'将把编辑器内的内容写入文件。若文件再次变化，会保留草稿并重新提示冲突。':'编辑器将载入上面展示的外部内容，当前未保存的草稿将被替换；如需保留，请先复制草稿。'}
      {choice && choice.external !== external && <p>文件又有新版本，请返回后重新比较。</p>}
    </ConfirmDialog>
  </section>;
}
