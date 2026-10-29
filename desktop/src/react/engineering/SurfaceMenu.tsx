import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Menus live above glass/scroll containers so they cannot be clipped by a
 * panel or trapped in its backdrop-filter stacking context. */
export function SurfaceMenu({label,children,icon,stayOpen=false,triggerClassName='',panelClassName='',hint:customHint}:{label:string;children:ReactNode;icon?:ReactNode;stayOpen?:boolean;triggerClassName?:string;panelClassName?:string;hint?:string}) {
  const [open,setOpen]=useState(false),[position,setPosition]=useState({top:0,left:0,maxHeight:400});
  const trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null),id=useId();
  useLayoutEffect(()=>{
    if(!open)return;
    const place=()=>{
      if(!trigger.current||!panel.current)return;
      const rect=trigger.current.getBoundingClientRect(),width=Math.min(300,window.innerWidth-24);
      const below=window.innerHeight-rect.bottom-16,above=rect.top-16;
      const height=Math.min((panel.current.querySelector<HTMLElement>('[data-surface-menu-scroll]')?.scrollHeight || panel.current.scrollHeight)+16,Math.max(below,above),window.innerHeight-32);
      setPosition({left:Math.max(12,Math.min(rect.right-width,window.innerWidth-width-12)),top:below>=height?rect.bottom+8:Math.max(12,rect.top-height-8),maxHeight:Math.max(100,Math.max(below,above))});
    };
    place();panel.current?.querySelector<HTMLElement>('button,input,select')?.focus();
    const observer=new ResizeObserver(place);if(panel.current)observer.observe(panel.current);
    const outside=(event:PointerEvent)=>{if(!panel.current?.contains(event.target as Node)&&!trigger.current?.contains(event.target as Node))setOpen(false);};
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.stopPropagation();event.preventDefault();setOpen(false);trigger.current?.focus();}
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)&&panel.current?.contains(document.activeElement)){
        if (document.activeElement?.matches('input:not([type="checkbox"]),textarea,select,[contenteditable="true"]')) return;
        const controls=[...panel.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)')];
        if(!controls.length)return;event.preventDefault();const at=controls.indexOf(document.activeElement as HTMLElement);
        controls[event.key==='Home'?0:event.key==='End'?controls.length-1:(at+(event.key==='ArrowDown'?1:-1)+controls.length)%controls.length]?.focus();
      }
    };
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key,true);window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
    return()=>{observer.disconnect();document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key,true);window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[open]);
  const hint = customHint || (label==='更多功能' ? '打开代码阅读、记忆、验收、文档和任务接续等功能' : label==='工作台外观' ? '切换深浅主题与界面动效' : label==='可用操作' ? '查看当前功能可执行的操作与说明' : label);
  return <><button ref={trigger} className={`enigma-menu-trigger ${triggerClassName}`} aria-label={label} data-tooltip={open ? '' : hint} aria-expanded={open} aria-controls={open?id:undefined} data-glass-interactive="" onClick={()=>setOpen(value=>!value)}>{icon||label}</button>{open&&createPortal(<div id={id} ref={panel} className={`enigma-surface-menu enigma-surface-card ${panelClassName}`} data-liquid="menu" data-menu-surface="" data-menu-position="fixed" role="group" aria-label={label} style={position} onBlur={event=>{if(event.relatedTarget&&!event.currentTarget.contains(event.relatedTarget as Node)&&!trigger.current?.contains(event.relatedTarget as Node))setOpen(false);}} onClick={event=>{if(!stayOpen&&(event.target as HTMLElement).closest('button')){setOpen(false);trigger.current?.focus();}}}><div className="enigma-surface-menu-scroll" data-surface-menu-scroll="">{children}</div></div>,document.body)}</>;
}

/** Existing modal content stays intact, but fixed positioning is viewport
 * relative rather than relative to a blurred sidebar or toolbar. */
export function SurfaceModal({children,onClose,initialFocus}:{children:ReactNode;onClose?:()=>void;initialFocus?:string}) {
  const root=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    if(!onClose)return;
    const previous=document.activeElement as HTMLElement|null;
    (initialFocus?root.current?.querySelector<HTMLElement>(initialFocus):root.current?.querySelector<HTMLElement>('button,input,select,textarea'))?.focus();
    const key=(event:KeyboardEvent)=>{
      if(root.current?.querySelector('[data-select-widget-trigger][aria-expanded="true"]')) return;
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}
      if(event.key==='Tab'){
        const items=[...root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')||[]].filter(item=>item.getClientRects().length);
        if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1)?.focus();}
        else if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0]?.focus();}
      }
    };
    document.addEventListener('keydown',key,true);
    return()=>{document.removeEventListener('keydown',key,true);if(previous?.isConnected&&previous!==document.body&&!previous.closest('[inert]'))previous.focus();else document.querySelector<HTMLElement>('.enigma-drawer .enigma-close-pane')?.focus();};
  },[]);
  return createPortal(<div ref={root} className="enigma-modal-portal" style={{position:'relative',zIndex:10000}} onPointerDown={event=>{if((event.target as HTMLElement).classList.contains('enigma-modal-backdrop'))onClose?.();}}>{children}</div>,document.body);
}
