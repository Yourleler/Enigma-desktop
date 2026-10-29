import {useEffect,useMemo,useRef,useState} from 'react';
import type {PreviewItem} from '../../types';
import {useStore} from '../../stores';
import {loadOfficePreviewBinary,officePreviewErrorMessage} from '../../utils/office-preview-binary';
import {version} from '../../../../../package.json';
import './SpreadsheetPreview.css';
interface Selection {sheetId:string;sheet:string;address:string;value:string|number|boolean;formula:string;zoom:number}
const positions=new Map<string,Selection>();
export default function SpreadsheetPreview({previewItem}:{previewItem:PreviewItem}){
  const scope=useStore(state=>JSON.stringify([state.activeServerConnectionId,state.activeServerConnection?.serverId,state.serverPort]));
  const key=JSON.stringify([scope,previewItem.id,previewItem.fileVersion]);
  const [attempt,setAttempt]=useState(0),[status,setStatus]=useState<'loading'|'ready'|'error'>('loading'),[message,setMessage]=useState(''),[warnings,setWarnings]=useState<string[]>([]),[sheets,setSheets]=useState<Array<{id:string;name:string}>>([]),[selection,setSelection]=useState<Selection|null>(null),[address,setAddress]=useState('A1');
  const addressInput=useRef<HTMLInputElement>(null);
  const [sheetTotal,setSheetTotal]=useState(0),[hiddenCount,setHiddenCount]=useState(0);
  const [copying,setCopying]=useState(false),[cellCount,setCellCount]=useState(0);
  const channel=useMemo(()=>crypto.randomUUID(),[key,attempt,previewItem.content]);
  const url=useMemo(()=>new URL(`assets/spreadsheet-viewer-${version}/index.html#${channel}`,document.baseURI).href,[channel]);
  const frame=useRef<HTMLIFrameElement>(null),raw=useRef<Uint8Array|null>(null),noticeTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const post=(type:string,data:Record<string,unknown>={})=>frame.current?.contentWindow?.postMessage({channel,type,...data},'*');
  useEffect(()=>{
    const saved=positions.get(key);
    const controller=new AbortController();let alive=true,ready=false,sent=false;raw.current=null;setStatus('loading');setMessage('');setWarnings([]);setSheets([]);setSelection(null);setCopying(false);
    const timer=setTimeout(()=>{if(alive){controller.abort();setStatus('error');setMessage('表格加载超时，可重新加载或使用系统应用打开。');}},40000);
    const dark=()=>document.documentElement.dataset.theme?.startsWith('midnight')||false;
    const send=()=>{if(!ready||sent||!raw.current||!alive)return;sent=true;post('load',{bytes:previewItem.type==='csv'?undefined:raw.current,csv:previewItem.type==='csv'?previewItem.content:undefined,name:previewItem.title,id:channel,dark:dark()});};
    const receive=(event:MessageEvent)=>{
      if(event.source!==frame.current?.contentWindow||event.data?.channel!==channel)return;const data=event.data;
      if(data.type==='ready'){ready=true;send();}
      if(data.type==='loaded'){
        clearTimeout(timer);setStatus('ready');setSheets(data.sheets);setCellCount(data.cellCount);setWarnings(data.warnings);setSheetTotal(data.sheetTotal||data.sheets.length);setHiddenCount(data.hiddenCount||0);
        if(saved&&data.sheets.some((sheet:{id:string})=>sheet.id===saved.sheetId)){post('restore',{selection:saved});}
      }
      if(data.type==='selection'){const value=data as Selection;setSelection(value);if(document.activeElement!==addressInput.current)setAddress(value.address||'A1');positions.set(key,value);if(positions.size>64)positions.delete(positions.keys().next().value!);}
      if(data.type==='error'){clearTimeout(timer);setStatus('error');setMessage(officePreviewErrorMessage(new Error(data.message)).replaceAll('DOCX','XLSX'));}
      if(data.type==='notice'){setMessage(data.message);setCopying(false);}
      if(data.type==='copy'&&typeof data.text==='string'){void navigator.clipboard.writeText(data.text).then(()=>setMessage('已复制选中区域')).catch(()=>setMessage('复制失败，请在表格内使用 Cmd/Ctrl+C'));setCopying(false);}
    };
    addEventListener('message',receive);const observer=new MutationObserver(()=>post('theme',{dark:dark()}));observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    if(previewItem.type==='csv'){raw.current=new TextEncoder().encode(previewItem.content);send();}
    else if(previewItem.ext==='xls'){clearTimeout(timer);setStatus('error');setMessage('旧版 XLS 请另存为 XLSX，或使用系统应用打开。');}
    else void loadOfficePreviewBinary(previewItem,controller.signal).then(bytes=>{if(alive){raw.current=bytes;send();}}).catch(error=>{if(alive&&!controller.signal.aborted){clearTimeout(timer);setStatus('error');setMessage(officePreviewErrorMessage(error).replaceAll('DOCX','XLSX'));}});
    return()=>{alive=false;if(noticeTimer.current)clearTimeout(noticeTimer.current);controller.abort();clearTimeout(timer);observer.disconnect();removeEventListener('message',receive);};
  },[key,channel,previewItem.content]);
  const download=()=>{if(!raw.current)return;const href=URL.createObjectURL(new Blob([new Uint8Array(raw.current)],{type:'application/octet-stream'}));const link=document.createElement('a');link.href=href;link.download=previewItem.title;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(href),30000);};
  return <section className="enigma-sheet-preview" aria-label={`${previewItem.title}表格预览`}>
    <div className="enigma-sheet-toolbar"><div><b title={previewItem.title}>{previewItem.title}</b><small>只读预览{status==='ready'?` · ${sheetTotal} 张工作表${hiddenCount?`（${hiddenCount} 张隐藏）`:''} · ${cellCount.toLocaleString()} 个单元格`:''}</small></div><button disabled={status!=='ready'} title="查找整个工作簿，可在高级查找中调整范围" onClick={()=>post('find')}>查找</button><button disabled={!raw.current} onClick={download}>下载原文件</button>{previewItem.filePath&&window.platform?.openFile&&<button onClick={()=>window.platform.openFile(previewItem.filePath!)}>系统打开</button>}</div>
    <div className="enigma-sheet-location"><select aria-label="工作表" value={selection?.sheetId||sheets[0]?.id||''} disabled={status!=='ready'} onChange={event=>post('sheet',{id:event.target.value})}>{sheets.map(sheet=><option key={sheet.id} value={sheet.id}>{sheet.name}</option>)}</select><form onSubmit={event=>{event.preventDefault();post('goto',{address:addressInput.current?.value||address});}}><input ref={addressInput} aria-label="定位单元格或区域" value={address} onChange={event=>setAddress(event.target.value)} disabled={status!=='ready'}/><button disabled={status!=='ready'}>定位</button></form><button disabled={status!=='ready'||!selection||copying} onClick={()=>{setCopying(true);post('copy');if(noticeTimer.current)clearTimeout(noticeTimer.current);noticeTimer.current=setTimeout(()=>setCopying(false),3000);}}>复制选区</button></div>
    <div className="enigma-sheet-selection" role="status" title={selection?.formula||String(selection?.value??'')}>{selection?`${selection.address} · ${selection.formula||String(selection.value??'空单元格')}`:'选择单元格可查看内容与公式'}</div>
    {status!=='error'&&(warnings.length>0||message)&&<details className="enigma-sheet-notice"><summary>{message||'预览说明'}</summary>{warnings.map(value=><p key={value}>{value}</p>)}<p>图表、透视表和宏请在系统应用中查看。</p></details>}
    <div className="enigma-sheet-body">{status!=='error'&&<iframe ref={frame} key={channel} src={url} title={`${previewItem.title} · 交互表格`} allow="clipboard-read; clipboard-write"/>}{status==='loading'&&<div className="enigma-sheet-loading" role="status">正在载入交互表格…</div>}{status==='error'&&<div className="enigma-sheet-loading" role="alert"><p>{message}</p><button onClick={()=>setAttempt(value=>value+1)}>重新加载</button></div>}</div>
  </section>;
}
