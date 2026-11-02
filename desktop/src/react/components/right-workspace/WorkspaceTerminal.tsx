import {useEffect,useRef,useState} from 'react';
import {Terminal} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {useStore} from '../../stores';
import {hanaFetch} from '../../hooks/use-hana-fetch';
import {subscribeStreamKey} from '../../services/stream-key-dispatcher';
import {useRepositoryContext} from '../chat/RepositoryContext';
import './WorkspaceTerminal.css';
const palette=()=>document.documentElement.dataset.theme?.startsWith('midnight')?{background:'#151a21',foreground:'#e5e7ec',cursor:'#b6a1e9',selectionBackground:'#51476e'}:{background:'#f7f5fb',foreground:'#252333',cursor:'#7152ad',selectionBackground:'#ddd3f2'};
export function WorkspaceTerminal({root,active}:{root?:string;active:boolean}){
 const sessionPath=useStore(s=>s.currentSessionPath),connection=useStore(s=>s.activeServerConnectionId),{repositories}=useRepositoryContext();
 const [chosen,setChosen]=useState(root||''),[status,setStatus]=useState('loading'),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 const cwd=chosen||repositories[0]?.path,container=useRef<HTMLDivElement>(null),terminalId=useRef(''),fit=useRef<FitAddon|null>(null),term=useRef<Terminal|null>(null);
 const request=async(action:string,data:any={})=>{const r=await hanaFetch('/api/enigma/terminal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionPath,action,...data}),throwOnHttpError:false});const value=await r.json();if(!r.ok)throw Error(value.error||'终端操作失败');return value;};
 useEffect(()=>{
  if(!container.current||!sessionPath||!cwd)return;
  let alive=true,ready=false,seen=0;const queued:any[]=[];let writes=Promise.resolve();setStatus('loading');setError('');
  const terminal=new Terminal({fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace',fontSize:13,lineHeight:1.25,cursorBlink:true,scrollback:3000,theme:palette()});
  const addon=new FitAddon();terminal.loadAddon(addon);terminal.open(container.current);term.current=terminal;fit.current=addon;terminal.textarea?.setAttribute('aria-label','终端输入');
  const receive=(event:any)=>{if(event.terminalId!==terminalId.current)return;if(event.type==='terminal_output'&&event.seq>seen){terminal.write(event.data);seen=event.seq;}if(event.status)setStatus(event.status);};
  const unsubscribe=subscribeStreamKey(sessionPath,(event:any)=>{if(ready)receive(event);else queued.push(event);});
  const resize=()=>{if(!container.current?.clientWidth||!container.current.clientHeight)return;addon.fit();if(terminalId.current)void request('resize',{terminalId:terminalId.current,cols:terminal.cols,rows:terminal.rows}).catch(()=>{});};
  const observer=new ResizeObserver(resize);observer.observe(container.current);resize();
  const input=terminal.onData(chars=>{if(!terminalId.current)return;writes=writes.then(()=>request('write',{terminalId:terminalId.current,chars})).catch(e=>{if(alive)setError(e.message);});});
  void (async()=>{try{
   const list=await request('list');const existing=list.terminals?.findLast((item:any)=>item.cwd===cwd&&item.status==='running');
   const opened=existing||await request('start',{cwd,cols:terminal.cols,rows:terminal.rows});if(!alive)return;terminalId.current=opened.terminalId;
   const data=await request('read',{terminalId:opened.terminalId});if(!alive)return;
   for(const chunk of data.chunks||[]){terminal.write(chunk.data);seen=chunk.seq;}
   ready=true;for(const event of queued.sort((a,b)=>(a.seq||0)-(b.seq||0)))receive(event);setStatus(data.status);resize();terminal.focus();
  }catch(e){if(alive){setError(e instanceof Error?e.message:'终端无法启动');setStatus('error');}}})();
  return()=>{alive=false;unsubscribe();observer.disconnect();input.dispose();terminal.dispose();terminalId.current='';term.current=null;fit.current=null;};
 },[sessionPath,connection,cwd,revision]);
 useEffect(()=>{const observer=new MutationObserver(()=>{if(term.current)term.current.options.theme=palette();});observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});return()=>observer.disconnect();},[]);
 useEffect(()=>{if(active&&container.current?.clientWidth)fit.current?.fit();},[active]);
 return <section className="enigma-workspace-terminal" aria-label="工作区终端"><header><label>目录<select aria-label="终端工作目录" value={cwd||''} onChange={e=>setChosen(e.target.value)}>{repositories.map(repo=><option value={repo.path} key={repo.path}>{repo.name}</option>)}</select></label><span role="status">{status==='loading'?'正在连接…':status==='running'?'已连接':'已停止'}</span><button onClick={()=>term.current?.clear()} aria-label="清空终端显示">清屏</button>{status==='running'?<button onClick={()=>void request('close',{terminalId:terminalId.current}).then(()=>setStatus('killed')).catch(e=>setError(e.message))}>停止终端</button>:<button onClick={()=>setRevision(v=>v+1)}>重新打开</button>}</header><p className="enigma-terminal-path" title={cwd}>{cwd}</p>{error&&<p className="enigma-terminal-error" role="alert">{error}</p>}<div ref={container} className="enigma-terminal-emulator"/><footer>命令在所选目录运行。隐藏面板保留进程，停止终端会结束进程。</footer></section>;
}
