import { NodeViewWrapper } from '@tiptap/react';
import {useEffect,useState} from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { kindOfFileName } from '../../utils/file-kind';
import styles from './FileBadgeView.module.css';

export function FileBadgeView({ node, deleteNode }: NodeViewProps) {
  const name = (node.attrs.name || node.attrs.path || '') as string;
  const path = (node.attrs.path || '') as string;
  const mimeType = typeof node.attrs.mimeType === 'string' ? node.attrs.mimeType : undefined;
  const kind = node.attrs.isDirectory === true ? 'directory' : kindOfFileName(name || path, mimeType);
  const thumbnailUrl = (kind === 'image' || kind === 'svg') && path && typeof window !== 'undefined'
    ? window.platform?.getFileUrl?.(path)
    : null;
  const isAudio = kind === 'audio';
  const [fallback,setFallback]=useState('');
  useEffect(()=>{let active=true;setFallback('');if(!thumbnailUrl&&(kind==='image'||kind==='svg')&&path&&window.platform?.readFileBase64){void window.platform.readFileBase64(path).then(data=>{if(active&&data)setFallback(`data:${mimeType||'image/png'};base64,${data}`);}).catch(()=>{});}return()=>{active=false;};},[path,thumbnailUrl,kind,mimeType]);

  return (
    <NodeViewWrapper as="span" className={`${styles.badge}${node.attrs.inlineAttachment?` ${styles.attachment}`:''}`} contentEditable={false} title={name}>
      {!node.attrs.inlineAttachment&&<span className={styles.at} aria-hidden="true">@</span>}
      {(thumbnailUrl||fallback) && (
        <img className={styles.thumbnail} src={thumbnailUrl||fallback} alt="" aria-hidden="true" />
      )}
      {isAudio && (
        <span className={styles.audioIcon} aria-hidden="true" data-testid="file-badge-audio-wave">
          <span />
          <span />
          <span />
          <span />
        </span>
      )}
      <span className={styles.name}>{name}</span>
      {node.attrs.inlineAttachment&&<button type="button" className={styles.remove} aria-label={`移除附件 ${name}`} onMouseDown={event=>{event.preventDefault();event.stopPropagation();}} onClick={event=>{event.preventDefault();event.stopPropagation();deleteNode();}}>×</button>}
    </NodeViewWrapper>
  );
}
