import { useState } from 'react';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import type { FileVersion } from '../../types';
import styles from './PreviewSaveNotice.module.css';

type ExternalContent = { content: string; fileVersion: FileVersion | null; noticeShown: boolean };

/** Saving failures stay beside the affected document until resolved. */
export function PreviewSaveNotice({issue, external, refreshing, onCopy, onRefresh, onRetry, onResolve}: {
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
    <p role="status">{issue.conflict ? '文件有外部更新，自动保存已暂停。当前草稿仍保留在编辑器中。' : '文件尚未保存。当前草稿仍保留在编辑器中，可重试保存。'}</p>
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
