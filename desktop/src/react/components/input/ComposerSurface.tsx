import {useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import './ComposerAttachmentPreview.css';

/** Move one persistent React host: editor node views, selection, uploads and
 * draft ownership survive entering and leaving the image focus stage. */
export function ComposerSurface({focused,modalActive=focused,onDismiss,children}:{focused:boolean;modalActive?:boolean;onDismiss:()=>void;children:ReactNode}) {
 const [host]=useState(()=>{const el=document.createElement('div');el.className='enigma-composer-surface-host';return el;});
 const inline=useRef<HTMLDivElement>(null),stage=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  const target=focused?stage.current:inline.current;
  if(focused&&inline.current&&host.parentElement===inline.current)inline.current.style.height=`${host.getBoundingClientRect().height}px`;
  if(target&&host.parentElement!==target){const active=document.activeElement;const retain=active instanceof HTMLElement&&host.contains(active);target.append(host);if(retain)active.focus({preventScroll:true});}
  if(!focused&&inline.current)inline.current.style.height='';
 },[focused,host]);
 useLayoutEffect(()=>{
  if(!modalActive)return;
  const background=[...document.querySelectorAll<HTMLElement>('.app,.titlebar')],prior=background.map(el=>el.inert);
  background.forEach(el=>{el.inert=true;});
  return()=>background.forEach((el,index)=>{el.inert=prior[index];});
 },[modalActive]);
 useLayoutEffect(()=>()=>{host.remove();},[host]);
 return <><div ref={inline} className="enigma-composer-surface-mount"/>{createPortal(children,host)}{focused&&createPortal(
  <div className="enigma-composer-focus-stage" data-native-browser-occluder="" data-composer-focus-stage="" role="region" aria-label="图片与消息编辑">
   <div className="enigma-composer-focus-scrim" aria-hidden="true" onMouseDown={onDismiss}/>
   <div ref={stage} className="enigma-composer-focus-slot" data-input-ctx-zone=""/>
  </div>,document.body)}</>;
}
