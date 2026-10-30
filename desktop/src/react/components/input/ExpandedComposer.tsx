import {useEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
import {EditorContent} from '@tiptap/react';
import type {Editor} from '@tiptap/core';
import './ExpandedComposer.css';
export function ExpandedComposer({editor,onClose}:{editor:Editor;onClose:()=>void}){
 const root=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  editor.commands.focus('end');
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}if(event.key==='Tab'){const items=[...root.current?.querySelectorAll<HTMLElement>('button,[contenteditable=true]')||[]];if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1)?.focus();}else if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0]?.focus();}}};
  window.addEventListener('keydown',key,true);return()=>{window.removeEventListener('keydown',key,true);};
 },[editor,onClose]);
 return createPortal(<div className="enigma-compose-backdrop" data-native-browser-occluder="" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><div ref={root} role="dialog" aria-modal="true" aria-label="展开编辑消息" className="enigma-compose-dialog" data-liquid="sheet"><header><div><strong>编辑消息</strong><small>Enter 换行 · ⌘/Ctrl Z 上一条输入，Y 下一条 · 修改自动存为草稿</small></div><button type="button" aria-label="完成编辑" onClick={onClose}>完成</button></header><EditorContent editor={editor}/></div></div>,document.body);
}
