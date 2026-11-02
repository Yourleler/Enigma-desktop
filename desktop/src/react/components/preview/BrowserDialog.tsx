import {useEffect,useRef,useState} from 'react';
import type {BrowserPageDialog} from '../../types';
import './BrowserDialog.css';

export function BrowserDialog({dialog,onRespond}:{dialog:BrowserPageDialog;onRespond:(accept:boolean,text?:string)=>Promise<unknown>}){
  const panel=useRef<HTMLDivElement>(null);
  const pending=useRef(false);
  useEffect(()=>{panel.current?.querySelector<HTMLElement>('input,button')?.focus();},[]);
  const [text,setText]=useState(dialog.defaultPrompt||'');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const respond=async(accept:boolean)=>{if(pending.current)return;pending.current=true;setBusy(true);setError('');try{await onRespond(accept,dialog.type==='prompt'?text:undefined);}catch(error){pending.current=false;setError(error instanceof Error?error.message:String(error));setBusy(false);}};
  let host='当前网页';try{host=new URL(dialog.url||'').hostname||host;}catch{}
  return <div ref={panel} className="enigma-page-dialog" role="dialog" aria-label="网页弹窗" aria-modal="true" data-native-browser-occluder="" onKeyDown={event=>{
    if(event.key==='Escape'&&!busy){event.preventDefault();event.stopPropagation();void respond(dialog.type==='alert');}
    if(event.key==='Tab'){
      const nodes=[...panel.current?.querySelectorAll<HTMLElement>('input:not(:disabled),button:not(:disabled)')||[]];
      const first=nodes[0],last=nodes.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
  }}>
    <small>来自 {host} 的网页弹窗</small><p>{dialog.message}</p>
    {dialog.type==='prompt'&&<input aria-label="网页弹窗输入" value={text} disabled={busy} onChange={event=>setText(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing){event.preventDefault();void respond(true);}}}/>}
    {error&&<p role="alert">{error}</p>}
    <div>{dialog.type!=='alert'&&<button disabled={busy} onClick={()=>void respond(false)}>取消</button>}<button disabled={busy} onClick={()=>void respond(true)}>{busy?'处理中…':'确定'}</button></div>
  </div>;
}
