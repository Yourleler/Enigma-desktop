import {useEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
import type {RefObject} from 'react';
import './ExpandedComposer.css';
export function ExpandedComposer({editorMountRef,onClose,onAttach,locked}:{editorMountRef:RefObject<HTMLDivElement|null>;onClose:()=>void;onAttach:()=>void;locked?:boolean}){
 const root=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const key=(event:KeyboardEvent)=>{if(event.defaultPrevented)return;if(document.querySelector('[data-composer-attachment-preview]'))return;if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}if(event.key==='Tab'){const items=[...root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),[contenteditable=true]')||[]];if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1)?.focus();}else if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0]?.focus();}}};
  window.addEventListener('keydown',key,true);return()=>{window.removeEventListener('keydown',key,true);};
 },[onClose]);
 return createPortal(<div className="enigma-compose-backdrop" data-native-browser-occluder="" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><div ref={root} role="dialog" aria-modal="true" aria-label="展开编辑消息" className="enigma-compose-dialog" data-liquid="sheet" data-input-ctx-zone=""><header><div><strong>编辑消息</strong><small>Enter 换行 · ⌘/Ctrl Z 上一条输入，Y 下一条 · 修改自动存为草稿</small></div><div className="enigma-compose-actions"><button type="button" aria-label="添加图片或文件" onMouseDown={event=>event.preventDefault()} onClick={onAttach} disabled={locked}>＋ 添加文件</button><button type="button" aria-label="完成编辑" onClick={onClose}>完成</button></div></header><div ref={editorMountRef} className="enigma-compose-editor-slot"/></div></div>,document.body);
}
