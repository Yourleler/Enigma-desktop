import type {UserAttachment} from '../../stores/chat-types';
import {useEffect,useState} from 'react';
import {MarkdownContent} from './MarkdownContent';
import {renderMarkdown} from '../../utils/markdown';
import {getUserAttachmentImageSrc} from '../../utils/user-attachment-media';
import {openFilePreview} from '../../utils/file-preview';
import {AppIcon} from '../../ui/app-icons';
import './InlineUserAttachments.css';
import {kindOfFileName} from '../../utils/file-kind';

function InlineThumbnail({file}:{file:UserAttachment}){
  const kind=kindOfFileName(file.name,file.mimeType),image=kind==='image'||kind==='svg';
  const source=getUserAttachmentImageSrc(file),[fallback,setFallback]=useState('');
  useEffect(()=>{let active=true;setFallback('');if(image&&!source&&file.status!=='expired'&&window.platform?.readFileBase64)void window.platform.readFileBase64(file.path).then(data=>{if(active&&data)setFallback(`data:${file.mimeType||'image/png'};base64,${data}`);}).catch(()=>{});return()=>{active=false;};},[file.path,file.mimeType,file.status,image,source]);
  return image&&(source||fallback)?<img src={source||fallback} alt={file.name}/>:<AppIcon name="file" size={17}/>;
}

const markerPattern=/\[(?:图片|文件) (\d+)\]/g;
export function inlineAttachmentIndices(text:string,attachments:UserAttachment[]){return new Set([...text.matchAll(markerPattern)].map(match=>Number(match[1])-1).filter(index=>index>=0&&index<attachments.length));}
export function InlineUserAttachments({text,attachments,sessionPath,messageId}:{text:string;attachments:UserAttachment[];sessionPath:string;messageId:string}){
  const matches=[...text.matchAll(markerPattern)];let previous=0;
  const parts=matches.flatMap((match,index)=>{
    const before=text.slice(previous,match.index);previous=match.index!+match[0].length;
    const file=attachments[Number(match[1])-1];
    return [before&&<span className="enigma-inline-message-text" key={`text-${index}`}><MarkdownContent html={renderMarkdown(before)} linkContext={{origin:'session',sessionPath,messageId}}/></span>,file?<button className="enigma-inline-message-file" key={`file-${index}`} title={`${match[0]} ${file.name}`} disabled={file.status==='expired'} onClick={()=>void openFilePreview(file.path,file.name,file.name.split('.').pop()||'',{origin:'session',sessionPath,messageId})}>
      <InlineThumbnail file={file}/>
      <span><small>{match[0].slice(1,-1)}</small>{file.name}</span>
    </button>:<span key={`missing-${index}`}>{match[0]}</span>];
  });
  return <div className="enigma-inline-message">{parts}{previous<text.length&&<span className="enigma-inline-message-text"><MarkdownContent html={renderMarkdown(text.slice(previous))} linkContext={{origin:'session',sessionPath,messageId}}/></span>}</div>;
}
