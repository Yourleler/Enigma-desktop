import {SearchField} from '../../ui/SearchField';
import {isDarkTheme} from '../../../shared/theme-registry';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {PreviewItem} from '../../types';
import {loadOfficePreviewBinary,loadOfficePreviewText,officePreviewErrorMessage} from '../../utils/office-preview-binary';
import {openInternalLink} from '../../utils/link-open';
import {sanitizeMarkdownPreviewHtml} from '../../utils/markdown-html-sanitizer';
import {version as appVersion} from '../../../../../package.json';
import './DocxPreview.css';
import {useStore} from '../../stores';
import {applyFindMarks,clearFindMarks} from '../../utils/find-marks';
const positions=new Map<string,{top:number;zoom:string}>();

export default function DocxPreview({previewItem}:{previewItem:PreviewItem}) {
  const connectionScope=useStore(state=>JSON.stringify([state.activeServerConnectionId,state.activeServerConnection?.serverId,state.activeServerConnection?.baseUrl,state.serverPort]));
  const key=JSON.stringify([connectionScope,previewItem.id,previewItem.fileVersion,previewItem.filePath,previewItem.remoteContentRef,previewItem.contentResourceId]);

  const [textContent,setTextContent]=useState(previewItem.content),[textLoading,setTextLoading]=useState(false),[textError,setTextError]=useState('');
  const textKey=useRef(key);
  const textMarkup=useMemo(()=>({__html:sanitizeMarkdownPreviewHtml(textContent)}),[textContent]);
  const [mode,setMode]=useState<'layout'|'text'>('layout'),[attempt,setAttempt]=useState(0);
  const [status,setStatus]=useState('loading'),[message,setMessage]=useState(''),[pageCount,setPageCount]=useState(0);
  const [finding,setFinding]=useState(false);
  const [query,setQuery]=useState(''),[matches,setMatches]=useState({count:0,index:0,truncated:false}),[zoom,setZoom]=useState(()=>positions.get(key)?.zoom||'fit');
  const frame=useRef<HTMLIFrameElement>(null),input=useRef<HTMLInputElement>(null),bytes=useRef<Uint8Array|null>(null),textRoot=useRef<HTMLDivElement>(null),textMarks=useRef<HTMLElement[]>([]);
  const channel=useMemo(()=>crypto.randomUUID(),[key,attempt,mode]);
  const source=useMemo(()=>new URL(`assets/docx-viewer-${appVersion}/index.html#${channel}`,document.baseURI).href,[channel]);
  const post=(type:string,extra:Record<string,unknown>={})=>frame.current?.contentWindow?.postMessage({channel,type,...extra},'*');
  useEffect(()=>{
    if(textKey.current!==key){textKey.current=key;setTextContent(previewItem.content);setTextError('');}
    if(mode!=='text'||previewItem.content)return;
    const controller=new AbortController();let current=true;setTextLoading(true);setTextError('');
    void loadOfficePreviewText(previewItem,controller.signal).then(html=>{if(current)setTextContent(html);}).catch(error=>{if(current)setTextError(officePreviewErrorMessage(error));}).finally(()=>{if(current)setTextLoading(false);});
    return()=>{current=false;controller.abort();};
  },[key,mode,attempt]);
  useEffect(()=>{
    if(mode==='text')return;
    const saved=positions.get(key)||{top:0,zoom:'fit'};
    const abort=new AbortController();let alive=true,frameReady=false,sent=false;setStatus('loading');setMessage('');setPageCount(0);setQuery('');setMatches({count:0,index:0,truncated:false});bytes.current=null;
    const dark=()=>isDarkTheme(document.documentElement.dataset.theme);
    const send=()=>{if(!alive||!frameReady||!bytes.current||sent)return;sent=true;post('theme',{dark:dark()});post('render',{bytes:bytes.current});};
    const receive=(event:MessageEvent)=>{
      if(event.source!==frame.current?.contentWindow||event.data?.channel!==channel)return;
      const data=event.data;
      if(data.type==='ready'){frameReady=true;send();}
      if(data.type==='rendered'){clearTimeout(timer);setStatus('ready');setPageCount(data.pages);setMessage(data.warnings||'');setZoom(saved.zoom);post('zoom',{value:saved.zoom});post('restore',{top:saved.top});}
      if(data.type==='error'){clearTimeout(timer);setStatus('error');setMessage(data.message);}
      if(data.type==='position'&&Number.isFinite(data.top)){positions.set(key,{top:data.top,zoom:positions.get(key)?.zoom||saved.zoom});if(positions.size>64)positions.delete(positions.keys().next().value!);}
      if(data.type==='matches'){setFinding(false);setMatches({count:data.count,index:data.index,truncated:data.truncated===true});}
      if(data.type==='focus-find')input.current?.focus();
      if(data.type==='link'&&typeof data.href==='string'&&/^https?:\/\//i.test(data.href))void openInternalLink(data.href,{origin:'desk'});
    };
    addEventListener('message',receive);
    const theme=new MutationObserver(()=>post('theme',{dark:dark()}));theme.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    const timer=setTimeout(()=>{if(alive){abort.abort();setStatus('error');setMessage('文档渲染超时，可切换文本阅读或重试。');}},20000);
    void loadOfficePreviewBinary(previewItem,abort.signal).then(data=>{if(alive){bytes.current=data;send();}}).catch(error=>{if(alive&&!abort.signal.aborted){clearTimeout(timer);setStatus('error');setMessage(officePreviewErrorMessage(error));}});
    return()=>{alive=false;abort.abort();clearTimeout(timer);removeEventListener('message',receive);theme.disconnect();};
  },[key,channel,mode]);
  useEffect(()=>{
    if(mode==='layout'&&status==='ready'){const timer=setTimeout(()=>post('find',{query}),150);return()=>clearTimeout(timer);}
    if(mode==='text'){setFinding(false);textMarks.current=applyFindMarks(textRoot.current,[query],'enigma-docx-find',{maxMatches:2001});const truncated=textMarks.current.length>2000;textMarks.current.splice(2000).forEach(mark=>mark.replaceWith(...mark.childNodes));setMatches({count:textMarks.current.length,index:textMarks.current.length?1:0,truncated});textMarks.current[0]?.scrollIntoView({block:'center'});return()=>clearFindMarks(textRoot.current,'enigma-docx-find');}
  },[query,status,channel,mode,textContent]);
  const nextMatch=(direction:number)=>{if(mode==='layout'){post('next',{direction});return;}const count=textMarks.current.length;if(!count)return;const index=(matches.index-1+direction+count)%count;textMarks.current.forEach((mark,i)=>mark.classList.toggle('is-active',i===index));textMarks.current[index]?.scrollIntoView({block:'center'});setMatches(current=>({count,index:index+1,truncated:current.truncated}));};
  const download=()=>{if(!bytes.current)return;const url=URL.createObjectURL(new Blob([new Uint8Array(bytes.current)],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}));const link=document.createElement('a');link.href=url;link.download=previewItem.title;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);};
  return <section className="enigma-docx-preview" aria-label={`${previewItem.title}文档预览`} onKeyDown={event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='f'){event.preventDefault();input.current?.focus();}}}>
    <div className="enigma-docx-toolbar"><div className="enigma-docx-title"><b title={previewItem.title}>{previewItem.title}</b><small>{mode==='layout'?'原始版式':'文本阅读'}{pageCount?` · ${pageCount} 页`:''}</small></div>
      <div role="group" aria-label="文档显示方式"><button aria-pressed={mode==='layout'} onClick={()=>setMode('layout')}>版式</button><button aria-pressed={mode==='text'} onClick={()=>setMode('text')}>文本</button></div>
      {mode==='layout'&&<select aria-label="文档缩放" disabled={status!=='ready'} value={zoom} onChange={event=>{setZoom(event.target.value);positions.set(key,{top:positions.get(key)?.top||0,zoom:event.target.value});post('zoom',{value:event.target.value});}}><option value="fit">适应宽度</option>{[.5,.75,1,1.25,1.5,2].map(value=><option key={value} value={value}>{value*100}%</option>)}</select>}
      <button onClick={download} disabled={!bytes.current} title="下载未经修改的原始 DOCX">下载原文件</button>
      {previewItem.filePath&&window.platform?.openFile&&<button onClick={()=>window.platform.openFile(previewItem.filePath!)}>系统打开</button>}
    </div>
    <div className="enigma-docx-search"><SearchField ref={input} aria-label="搜索文档内容" placeholder="搜索文档内容" disabled={mode==='layout'?status!=='ready':textLoading||!!textError} value={query} onChange={event=>{setFinding(!!event.target.value);setQuery(event.target.value);}} onKeyDown={event=>{if(event.key==='Enter')nextMatch(event.shiftKey?-1:1);}}/><span role="status">{query?finding?'查找中':`${matches.index} / ${matches.count}${matches.truncated?'+':''}`:''}</span><button aria-label="上一个结果" disabled={!matches.count} onClick={()=>nextMatch(-1)}>↑</button><button aria-label="下一个结果" disabled={!matches.count} onClick={()=>nextMatch(1)}>↓</button>{mode==='layout'&&pageCount>1&&<select aria-label="跳转文档页面" defaultValue="" onChange={event=>{post('page',{page:Number(event.target.value)});}}><option value="" disabled>跳转页码</option>{Array.from({length:pageCount},(_,index)=><option key={index} value={index+1}>第 {index+1} 页</option>)}</select>}</div>
    {query&&matches.truncated&&<small className="enigma-docx-search-limit" role="status">已显示前 2000 项，请缩小查询范围。</small>}
    <div className="enigma-docx-body">{mode==='text'?textLoading?<div className="enigma-docx-notice" role="status">正在读取文档文本…</div>:textError?<div className="enigma-docx-notice" role="alert"><p>{textError}</p><button onClick={()=>setAttempt(value=>value+1)}>重新加载</button></div>:<div ref={textRoot} className="preview-docx md-content enigma-docx-text" onClick={event=>{const link=(event.target as Element).closest('a[href]');if(link){event.preventDefault();void openInternalLink(link.getAttribute('href')||'',{origin:'desk',baseFilePath:previewItem.filePath});}}} dangerouslySetInnerHTML={textMarkup}/>:<>
      {status!=='error'&&<iframe key={channel} ref={frame} title={`${previewItem.title} · Word 版式`} sandbox="allow-scripts" src={source} onLoad={()=>post('hello')}/>}
      {status==='loading'&&<div className="enigma-docx-notice" role="status">正在渲染 Word 版式…</div>}
      {status==='error'&&<div className="enigma-docx-notice" role="alert"><p>{message}</p><button onClick={()=>setAttempt(value=>value+1)}>重新加载</button><button onClick={()=>setMode('text')}>文本阅读</button></div>}
    </>}</div>
    {mode==='layout'&&<small className="enigma-docx-hint">{status==='ready'&&message?message:'保留原文档版式；复杂分页和域可能与 Word 不同。'}</small>}
  </section>;
}
