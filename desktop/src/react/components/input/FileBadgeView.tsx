import { NodeViewWrapper } from '@tiptap/react';
import {useEffect,useId,useRef,useState} from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { kindOfFileName } from '../../utils/file-kind';
import styles from './FileBadgeView.module.css';
import {useComposerAttachmentPreview} from './ComposerAttachmentPreview';

export function FileBadgeView({ node, deleteNode }: NodeViewProps) {
  const name = (node.attrs.name || node.attrs.path || '') as string;
  const path = (node.attrs.path || '') as string;
  const mimeType = typeof node.attrs.mimeType === 'string' ? node.attrs.mimeType : undefined;
  const kind = node.attrs.isDirectory === true ? 'directory' : kindOfFileName(name || path, mimeType);
  const thumbnailUrl = (kind === 'image' || kind === 'svg') && path && typeof window !== 'undefined'
    ? window.platform?.getFileUrl?.(path)
    : null;
  const isAudio = kind === 'audio';
  const image = kind === 'image' || kind === 'svg';
  const imageId=useId(),preview=useComposerAttachmentPreview();
  const trigger=useRef<HTMLButtonElement>(null);
  const [urlFailed,setUrlFailed]=useState(false),[readFailed,setReadFailed]=useState(false);
  const [fallback,setFallback]=useState('');
  useEffect(()=>{setUrlFailed(false);setReadFailed(false);},[path,thumbnailUrl]);
  useEffect(()=>{let active=true;setFallback('');if((!thumbnailUrl||urlFailed)&&image&&path&&window.platform?.readFileBase64){void window.platform.readFileBase64(path).then(data=>{if(!active)return;if(data)setFallback(`data:${mimeType||'image/png'};base64,${data}`);else setReadFailed(true);}).catch(()=>{if(active)setReadFailed(true);});}return()=>{active=false;};},[path,thumbnailUrl,image,mimeType,urlFailed]);
  useEffect(()=>()=>preview.dismiss(imageId),[preview.dismiss,imageId]);
  const src=(!urlFailed&&thumbnailUrl)||fallback||null;
  useEffect(()=>preview.update({id:imageId,name,src,failed:readFailed}),[imageId,name,src,readFailed,preview.update]);
  useEffect(()=>{if(image&&node.attrs.inlineAttachment&&trigger.current)return preview.register({id:imageId,name,src,failed:readFailed},trigger.current);},[image,imageId,node.attrs.inlineAttachment,preview.register]);
  const open=(pinned=false)=>{if(trigger.current)preview.show({id:imageId,name,src,failed:readFailed},trigger.current,pinned);};

  if(image&&node.attrs.inlineAttachment)return <NodeViewWrapper as="span" className={styles.imageAttachment} contentEditable={false} data-input-image="">
    <button ref={trigger} type="button" className={styles.imageButton} aria-label={`预览图片 ${name}`} data-tooltip-managed="" onMouseDown={event=>event.preventDefault()} onMouseEnter={()=>open()} onMouseLeave={()=>preview.leave(imageId)} onFocus={()=>open()} onBlur={()=>preview.leave(imageId)} onClick={event=>{event.preventDefault();event.stopPropagation();open(true);}}>
      {src?<img src={src} alt={name} draggable={false} onError={()=>{if(fallback){setFallback('');setReadFailed(true);}else setUrlFailed(true);}}/>:<span className={styles.imageFallback}>{readFailed?'图片不可用':'图片'}</span>}
    </button>
    <button type="button" className={styles.imageRemove} aria-label={`移除附件 ${name}`} onMouseDown={event=>{event.preventDefault();event.stopPropagation();}} onClick={event=>{event.preventDefault();event.stopPropagation();preview.dismiss(imageId);deleteNode();}}>×</button>
  </NodeViewWrapper>;

  return (
    <NodeViewWrapper as="span" className={`${styles.badge}${node.attrs.inlineAttachment?` ${styles.attachment}`:''}`} contentEditable={false} title={name}>
      {!node.attrs.inlineAttachment&&<span className={styles.at} aria-hidden="true">@</span>}
      {src && (
        <img className={styles.thumbnail} src={src} alt="" aria-hidden="true" onError={()=>setUrlFailed(true)}/>
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
