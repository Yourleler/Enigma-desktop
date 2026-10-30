import {createContext,useCallback,useContext,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {createPortal} from 'react-dom';
import type {Editor} from '@tiptap/core';
import './ComposerAttachmentPreview.css';

export interface ComposerPreviewImage {id:string;name:string;src:string|null;failed?:boolean}
interface PreviewState {image:ComposerPreviewImage;anchor:HTMLElement;pinned:boolean}
interface PreviewActions {
 show:(image:ComposerPreviewImage,anchor:HTMLElement,pinned?:boolean)=>void;
 leave:(id:string)=>void;
 dismiss:(id:string)=>void;
 update:(image:ComposerPreviewImage)=>void;
}
const Context=createContext<PreviewActions>({show:()=>{},leave:()=>{},dismiss:()=>{},update:()=>{}});
export const useComposerAttachmentPreview=()=>useContext(Context);

export function ComposerAttachmentPreview({editor,scope,expanded,children}:{editor:Editor|null;scope:string;expanded:boolean;children:ReactNode}) {
 const [preview,setPreview]=useState<PreviewState|null>(null);
 const [position,setPosition]=useState({top:0,left:0,maxHeight:340,visibility:'hidden' as 'visible'|'hidden'});
 const panel=useRef<HTMLDivElement>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const cancel=useCallback(()=>{if(timer.current)clearTimeout(timer.current);timer.current=null;},[]);
 const dismiss=useCallback((id:string)=>{cancel();setPreview(current=>current?.image.id===id?null:current);},[cancel]);
 const show=useCallback((image:ComposerPreviewImage,anchor:HTMLElement,pinned=false)=>{
  cancel();setPreview(current=>current?.pinned&&!pinned ? current : {image,anchor,pinned});
 },[cancel]);
 const leave=useCallback((id:string)=>{cancel();timer.current=setTimeout(()=>setPreview(current=>current?.image.id===id&&!current.pinned?null:current),140);},[cancel]);
 const update=useCallback((image:ComposerPreviewImage)=>setPreview(current=>current?.image.id===image.id?{...current,image}:current),[]);
 const actions=useMemo(()=>({show,leave,dismiss,update}),[show,leave,dismiss,update]);
 useEffect(()=>{setPreview(null);cancel();},[scope,cancel]);
 useEffect(()=>cancel,[cancel]);
 useEffect(()=>{
  if(!preview)return;
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setPreview(null);}};
  document.addEventListener('keydown',key,true);return()=>document.removeEventListener('keydown',key,true);
 },[!!preview]);
 useLayoutEffect(()=>{
  if(!preview?.pinned||!expanded)return;
  const frame=document.querySelector('.enigma-compose-dialog');
  frame?.setAttribute('data-attachment-preview-open','');
  return()=>frame?.removeAttribute('data-attachment-preview-open');
 },[preview?.pinned,expanded]);
 useLayoutEffect(()=>{
  if(!preview||!panel.current)return;
  const place=()=>{
   const box=panel.current;if(!box)return;
   const composer=preview.anchor.closest<HTMLElement>('.enigma-compose-dialog,[data-liquid="composer"]');
   const rect=composer?.getBoundingClientRect()||preview.anchor.getBoundingClientRect();
   const panelRect=box.getBoundingClientRect();
   const maxHeight=Math.max(120,Math.min(360,window.innerHeight-24,expanded?(rect.width<620?170:window.innerHeight*.5):rect.top-24));
   const height=Math.min(panelRect.height,maxHeight);
   const left=Math.max(12,Math.min((expanded?rect.right-panelRect.width-16:rect.left),window.innerWidth-panelRect.width-12));
   const headerBottom=composer?.querySelector('header')?.getBoundingClientRect().bottom??rect.top+64;
   const top=expanded?Math.max(12,headerBottom+8):Math.max(12,rect.top-height-10);
   setPosition({left,top:Math.min(top,Math.max(12,window.innerHeight-height-12)),maxHeight,visibility:'visible'});
  };
  place();const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(place);
  observer?.observe(panel.current);const composer=preview.anchor.closest('.enigma-compose-dialog,[data-liquid="composer"]');if(composer)observer?.observe(composer);
  window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
  return()=>{observer?.disconnect();window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
 },[preview,expanded]);
 return <Context.Provider value={actions}>{children}{preview&&createPortal(
  <div ref={panel} style={{...position,position:'fixed'}} className="enigma-composer-attachment-preview" data-composer-attachment-preview="" data-expanded={expanded} data-pinned={preview.pinned} data-native-browser-occluder="" data-liquid="menu"
   role={preview.pinned?'dialog':'tooltip'} aria-label={`图片预览 ${preview.image.name}`} onMouseEnter={cancel} onMouseLeave={()=>leave(preview.image.id)}>
   <header><button type="button" aria-label="关闭图片预览" onMouseDown={event=>event.preventDefault()} onClick={()=>{setPreview(null);if(!editor?.isDestroyed)editor?.commands.focus();}}><svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg></button><span>{preview.image.name}</span><small>{preview.pinned?'已固定':'点击缩略图固定'}</small></header>
   <div className="enigma-composer-attachment-image">{preview.image.src?<img src={preview.image.src} alt={preview.image.name}/>:<p>{preview.image.failed?'图片暂不可用，附件仍保留':'正在读取图片…'}</p>}</div>
  </div>,document.body)}</Context.Provider>;
}
