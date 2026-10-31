import {createContext,useCallback,useContext,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {createPortal} from 'react-dom';
import type {Editor} from '@tiptap/core';
import './ComposerAttachmentPreview.css';

export interface ComposerPreviewImage {id:string;name:string;src:string|null;failed?:boolean}
interface PreviewState {image:ComposerPreviewImage;anchor:HTMLElement;pinned:boolean}
interface PreviewActions {
 show:(image:ComposerPreviewImage,anchor:HTMLElement,pinned?:boolean)=>void;
 leave:(id:string)=>void;dismiss:(id:string)=>void;update:(image:ComposerPreviewImage)=>void;
 register:(image:ComposerPreviewImage,anchor:HTMLElement)=>()=>void;
}
const Context=createContext<PreviewActions>({show:()=>{},leave:()=>{},dismiss:()=>{},update:()=>{},register:()=>()=>{}});
export const useComposerAttachmentPreview=()=>useContext(Context);
export function fitComposerImage(width:number,height:number,composerTop:number,ratio:number){
 const availableHeight=Math.max(40,composerTop-72),availableWidth=Math.max(40,Math.min(1000,width-104));
 const h=Math.min(availableHeight,Math.max(40,height-104),availableWidth/Math.max(.05,ratio));
 return {width:Math.round(h*ratio),height:Math.round(h)};
}
export function ComposerAttachmentPreview({editor,scope,expanded,children,onPinnedChange,resetPreview=0}:{editor:Editor|null;scope:string;expanded:boolean;children:ReactNode;onPinnedChange?:(value:boolean)=>void;resetPreview?:number}) {
 const [preview,setPreview]=useState<PreviewState|null>(null),[revision,setRevision]=useState(0),[ratio,setRatio]=useState(1.5);
 const [position,setPosition]=useState({top:0,left:0,width:320,height:220,visibility:'hidden' as 'visible'|'hidden'});
 const registry=useRef(new Map<string,{image:ComposerPreviewImage;anchor:HTMLElement}>());
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const cancel=useCallback(()=>{if(timer.current)clearTimeout(timer.current);timer.current=null;},[]);
 const close=useCallback((restoreFocus=false)=>{cancel();setPreview(null);if(restoreFocus)requestAnimationFrame(()=>{if(editor&&!editor.isDestroyed&&editor.isEditable)editor.commands.focus();});},[cancel,editor]);
 const dismiss=useCallback((id:string)=>{cancel();setPreview(current=>current?.image.id===id?null:current);},[cancel]);
 const register=useCallback((image:ComposerPreviewImage,anchor:HTMLElement)=>{registry.current.set(image.id,{image,anchor});setRevision(v=>v+1);return()=>{registry.current.delete(image.id);setRevision(v=>v+1);dismiss(image.id);};},[dismiss]);
 const show=useCallback((image:ComposerPreviewImage,anchor:HTMLElement,pinned=false)=>{cancel();setPreview(current=>current?.pinned&&!pinned?current:{image,anchor,pinned});},[cancel]);
 const leave=useCallback((id:string)=>{cancel();timer.current=setTimeout(()=>setPreview(current=>current?.image.id===id&&!current.pinned?null:current),140);},[cancel]);
 const update=useCallback((image:ComposerPreviewImage)=>{const row=registry.current.get(image.id);if(row)row.image=image;setPreview(current=>current?.image.id===image.id?{...current,image}:current);},[]);
 const actions=useMemo(()=>({show,leave,dismiss,update,register}),[show,leave,dismiss,update,register]);
 const images=[...registry.current.values()].filter(row=>row.anchor.isConnected).sort((a,b)=>a.anchor.compareDocumentPosition(b.anchor)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1);
 const index=images.findIndex(row=>row.image.id===preview?.image.id);
 const step=useCallback((direction:number)=>{
  const rows=[...registry.current.values()].filter(row=>row.anchor.isConnected).sort((a,b)=>a.anchor.compareDocumentPosition(b.anchor)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1);
  setPreview(current=>{const at=rows.findIndex(row=>row.image.id===current?.image.id),next=rows[at+direction];return current&&next?{...next,pinned:true}:current;});
 },[]);
 useEffect(()=>{close();},[scope,resetPreview,close]);
 useEffect(()=>cancel,[cancel]);
 useLayoutEffect(()=>{onPinnedChange?.(!!preview?.pinned);},[preview?.pinned,onPinnedChange]);
 useEffect(()=>()=>onPinnedChange?.(false),[onPinnedChange]);
 useEffect(()=>{
  if(!preview)return;
  const key=(event:KeyboardEvent)=>{
   if(event.defaultPrevented)return;
   const menu=[...document.querySelectorAll<HTMLElement>('[data-menu-surface],[role=listbox],[role=menu]')].some(el=>!el.closest('.app,[hidden],[inert]')&&el.getClientRects().length>0);
   if(menu)return;
   if(preview.pinned&&event.key==='Tab'){
    const targets=[...document.querySelectorAll<HTMLElement>('[data-composer-attachment-preview] button:not(:disabled),[data-composer-focus-stage] button:not(:disabled),[data-composer-focus-stage] [contenteditable=true],.enigma-compose-dialog button:not(:disabled),.enigma-compose-dialog [contenteditable=true]')].filter(el=>!el.closest('[inert],[hidden]')&&el.getClientRects().length>0);
    const first=targets[0],last=targets.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
   }
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);return;}
   const editable=event.target instanceof Element&&event.target.closest('input,textarea,[contenteditable=true],[role=combobox]');
   if(preview.pinned&&!editable&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();step(event.key==='ArrowLeft'?-1:1);}
  };
  window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);
 },[!!preview,preview?.pinned,close,step]);
 useLayoutEffect(()=>{
  if(!preview?.pinned||!expanded)return;
  const frame=document.querySelector('.enigma-compose-dialog');frame?.setAttribute('data-attachment-preview-open','');frame?.removeAttribute('aria-modal');
  return()=>{frame?.removeAttribute('data-attachment-preview-open');frame?.setAttribute('aria-modal','true');};
 },[preview?.pinned,expanded,editor]);
 useLayoutEffect(()=>{
  if(!preview)return;
  const composer=preview.anchor.closest<HTMLElement>('.enigma-compose-dialog,[data-composer-focus-stage],[data-liquid="composer"]');
  const place=()=>{
   const focus=document.querySelector<HTMLElement>('.enigma-composer-focus-slot');
   const rect=(expanded?editor?.view.dom.closest('.enigma-compose-dialog'):focus||preview.anchor.closest('[data-liquid="composer"]'))?.getBoundingClientRect()||preview.anchor.getBoundingClientRect();
   const dimensions=preview.pinned?fitComposerImage(window.innerWidth,window.innerHeight,rect.top,ratio):{width:Math.min(320,window.innerWidth-32),height:Math.min(210,Math.max(80,rect.top-24))};
   const left=preview.pinned?(window.innerWidth-dimensions.width)/2:Math.max(12,Math.min(rect.left,window.innerWidth-dimensions.width-12));
   const top=preview.pinned?Math.max(48,rect.top-dimensions.height-16):Math.max(12,rect.top-dimensions.height-10);
   setPosition(old=>old.left===left&&old.top===top&&old.width===dimensions.width&&old.height===dimensions.height&&old.visibility==='visible'?old:{left,top,...dimensions,visibility:'visible'});
  };
  let scheduled=0;const schedule=()=>{if(!scheduled)scheduled=requestAnimationFrame(()=>{scheduled=0;place();});};
  place();const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(schedule);
  if(composer)observer?.observe(composer);const focus=document.querySelector('.enigma-composer-focus-slot');if(focus)observer?.observe(focus);
  if(editor?.view.dom)observer?.observe(editor.view.dom);
  const raf=requestAnimationFrame(place);window.addEventListener('resize',place);window.visualViewport?.addEventListener('resize',place);window.addEventListener('scroll',place,true);
  return()=>{cancelAnimationFrame(raf);cancelAnimationFrame(scheduled);observer?.disconnect();window.removeEventListener('resize',place);window.visualViewport?.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
 },[preview,expanded,ratio,editor,revision]);
 return <Context.Provider value={actions}>{children}{preview&&createPortal(
  <div style={{...position,position:'fixed',zIndex:expanded?11020:9020}} className="enigma-composer-attachment-preview" data-composer-attachment-preview="" data-expanded={expanded} data-pinned={preview.pinned} data-native-browser-occluder=""
   role={preview.pinned?'dialog':'tooltip'} aria-label={`图片预览 ${preview.image.name}`} onMouseEnter={cancel} onMouseLeave={()=>leave(preview.image.id)}>
   <div className="enigma-composer-attachment-image">{preview.image.src?<img key={preview.image.id} src={preview.image.src} alt={preview.image.name} onLoad={event=>{const img=event.currentTarget;if(img.naturalWidth&&img.naturalHeight)setRatio(img.naturalWidth/img.naturalHeight);}}/>:<p>{preview.image.failed?'图片暂不可用，附件仍保留':'正在读取图片…'}</p>}
    <button className="enigma-image-close" type="button" aria-label="关闭图片预览" data-tooltip="关闭图片预览 · Esc" onMouseDown={event=>event.preventDefault()} onClick={()=>close(true)}><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg></button>
   </div>
   {preview.pinned&&images.length>1&&<><button className="enigma-image-previous" type="button" aria-label="上一张图片" disabled={index<=0} onMouseDown={event=>event.preventDefault()} onClick={()=>step(-1)}><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m12 4-6 6 6 6"/></svg></button><button className="enigma-image-next" type="button" aria-label="下一张图片" disabled={index<0||index>=images.length-1} onMouseDown={event=>event.preventDefault()} onClick={()=>step(1)}><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m8 4 6 6-6 6"/></svg></button></>}
   <div className="enigma-image-caption"><span>{preview.image.name}</span><small>{preview.pinned?`${index+1} / ${images.length} · 已固定`:'点击缩略图固定'}</small></div>
  </div>,document.body)}</Context.Provider>;
}
