import {useEffect,useRef,useState} from 'react';
import {Terminal,type ITheme} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {useStore} from '../../stores';
import {hanaFetch} from '../../hooks/use-hana-fetch';
import {subscribeStreamKey} from '../../services/stream-key-dispatcher';
import {openWorkspaceTerminal,useRepositoryContext} from '../chat/RepositoryContext';
import './WorkspaceTerminal.css';

// 终端配色：按界面明暗取值，ANSI 色针对各自底色调到足够对比度，避免黄/青等颜色在浅底上看不清。
const LIGHT:ITheme={background:'#fbfaf7',foreground:'#1d1b26',cursor:'#5b3fa0',cursorAccent:'#fbfaf7',selectionBackground:'#d9cdf3',
 black:'#1d1b26',red:'#b42318',green:'#1f7a3a',yellow:'#8a5a00',blue:'#1d4fbf',magenta:'#8e3fae',cyan:'#0f6f7c',white:'#5c5a66',
 brightBlack:'#55525f',brightRed:'#d12c1f',brightGreen:'#23893f',brightYellow:'#9c6700',brightBlue:'#2a5fd6',brightMagenta:'#a04cc2',brightCyan:'#12808f',brightWhite:'#2b2935'};
const DARK:ITheme={background:'#14171d',foreground:'#eef0f4',cursor:'#c3b0f2',cursorAccent:'#14171d',selectionBackground:'#4a4166',
 black:'#3b4048',red:'#ff7b72',green:'#7ee08a',yellow:'#f2cc60',blue:'#79b8ff',magenta:'#d2a8ff',cyan:'#76e3ea',white:'#d8dbe2',
 brightBlack:'#8b929e',brightRed:'#ffa198',brightGreen:'#a5f0ad',brightYellow:'#f8de8a',brightBlue:'#a5d0ff',brightMagenta:'#e2c5ff',brightCyan:'#a3f0f4',brightWhite:'#ffffff'};
const dark=()=>document.body.dataset.enigmaTone==='dark';
const palette=()=>dark()?DARK:LIGHT;
// 启动整条链路（list → start → read）的上限；超时后给出明确错误和重试入口，而不是一直“正在连接”。
const START_TIMEOUT_MS=15000;
type Status='idle'|'loading'|'running'|'exited'|'killed'|'stale'|'error';
const STATUS_TEXT:Record<Status,string>={idle:'未启动',loading:'正在连接…',running:'已连接',exited:'已退出',killed:'已停止',stale:'已断开',error:'连接失败'};

export function WorkspaceTerminal({root,active}:{root?:string;active:boolean}){
 const sessionPath=useStore(s=>s.pendingNewSession?null:s.currentSessionPath),connection=useStore(s=>s.activeServerConnectionId),server=useStore(s=>s.activeServerConnection);
 const {repositories,loading:reposLoading}=useRepositoryContext();
 const [chosen,setChosen]=useState(root||''),[status,setStatus]=useState<Status>('idle'),[error,setError]=useState(''),[revision,setRevision]=useState(0),[creating,setCreating]=useState(false);
 const known=repositories.some(repo=>repo.path===chosen),cwd=(known||!repositories.length?chosen:'')||repositories[0]?.path||'';
 const container=useRef<HTMLDivElement>(null),terminalId=useRef(''),fit=useRef<FitAddon|null>(null),term=useRef<Terminal|null>(null);
 const remote=!!server&&server.kind!=='local';
 const request=async(action:string,data:any={})=>{const r=await hanaFetch('/api/enigma/terminal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionPath,action,...data}),throwOnHttpError:false});const value=await r.json().catch(()=>null);if(!r.ok)throw Error(value?.error||`终端操作失败（HTTP ${r.status}）`);return value;};
 // 前置条件不满足时不创建终端，界面直接说明原因，避免卡在“正在连接”。
 const blocker=remote?'remote':!sessionPath?'session':!cwd?(reposLoading?'repos-loading':'no-cwd'):null;

 useEffect(()=>{
  if(blocker||!container.current||!sessionPath||!cwd){setStatus('idle');return;}
  let alive=true,ready=false,seen=0;const queued:any[]=[];let writes=Promise.resolve();setStatus('loading');setError('');
  const terminal=new Terminal({fontFamily:'"SF Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',fontSize:13,lineHeight:1.35,fontWeight:'500',fontWeightBold:'700',minimumContrastRatio:4.5,cursorBlink:true,cursorStyle:'bar',scrollback:5000,theme:palette()});
  const addon=new FitAddon();terminal.loadAddon(addon);terminal.open(container.current);term.current=terminal;fit.current=addon;terminal.textarea?.setAttribute('aria-label','终端输入');
  const receive=(event:any)=>{if(event.terminalId!==terminalId.current)return;if(event.type==='terminal_output'&&event.seq>seen){terminal.write(event.data);seen=event.seq;}if(event.status)setStatus(event.status);};
  const unsubscribe=subscribeStreamKey(sessionPath,(event:any)=>{if(ready)receive(event);else queued.push(event);});
  const resize=()=>{if(!container.current?.clientWidth||!container.current.clientHeight)return;addon.fit();if(terminalId.current)void request('resize',{terminalId:terminalId.current,cols:terminal.cols,rows:terminal.rows}).catch(()=>{});};
  const observer=new ResizeObserver(resize);observer.observe(container.current);resize();
  const input=terminal.onData(chars=>{if(!terminalId.current)return;writes=writes.then(()=>request('write',{terminalId:terminalId.current,chars})).catch(e=>{if(alive)setError(e.message);});});
  let timedOut=false;const timer=window.setTimeout(()=>{if(alive&&!ready){timedOut=true;setError('终端连接超时：服务没有在 15 秒内响应，请检查本机服务是否在运行后重试');setStatus('error');}},START_TIMEOUT_MS);
  void (async()=>{try{
   const list=await request('list');const existing=list?.terminals?.findLast?.((item:any)=>item.cwd===cwd&&item.status==='running');
   const opened=existing||await request('start',{cwd,cols:terminal.cols,rows:terminal.rows});
   if(!alive||timedOut){if(!existing&&opened?.terminalId)void request('close',{terminalId:opened.terminalId}).catch(()=>{});return;}
   terminalId.current=opened.terminalId;
   const data=await request('read',{terminalId:opened.terminalId});if(!alive||timedOut)return;
   for(const chunk of data?.chunks||[]){terminal.write(chunk.data);seen=chunk.seq;}
   ready=true;window.clearTimeout(timer);for(const event of queued.sort((a,b)=>(a.seq||0)-(b.seq||0)))receive(event);setStatus((data?.status as Status)||'running');resize();if(active)terminal.focus();
  }catch(e){if(alive&&!timedOut){window.clearTimeout(timer);setError(e instanceof Error?e.message:'终端无法启动');setStatus('error');}}})();
  return()=>{alive=false;window.clearTimeout(timer);unsubscribe();observer.disconnect();input.dispose();terminal.dispose();terminalId.current='';term.current=null;fit.current=null;};
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[sessionPath,connection,cwd,revision,blocker]);
 useEffect(()=>{const observer=new MutationObserver(()=>{if(term.current)term.current.options.theme=palette();});observer.observe(document.body,{attributes:true,attributeFilter:['data-enigma-tone']});return()=>observer.disconnect();},[]);
 useEffect(()=>{if(active&&container.current?.clientWidth){fit.current?.fit();term.current?.focus();}},[active]);

 // 新对话会切换右侧面板的作用域，所以创建后要在新作用域里重新选中终端标签，否则面板会“消失”。
 const startSession=async()=>{if(creating)return;setCreating(true);setError('');try{await openWorkspaceTerminal(cwd);if(!useStore.getState().currentSessionPath)setError('对话没有创建成功，请重试');}catch(e){setError(e instanceof Error?e.message:'对话没有创建成功');}finally{setCreating(false);}};
 const reopen=()=>{setError('');setRevision(v=>v+1);};
 const stop=()=>void request('close',{terminalId:terminalId.current}).then(()=>setStatus('killed')).catch(e=>setError(e.message));
 const tone=status==='running'?'ok':status==='loading'?'busy':status==='error'?'bad':'idle';

 return <section className="enigma-workspace-terminal" aria-label="工作区终端" data-tone={dark()?'dark':'light'}>
  <header>
   <label><span className="enigma-terminal-label">目录</span><select aria-label="终端工作目录" value={cwd} disabled={!repositories.length} onChange={e=>setChosen(e.target.value)}>{!repositories.length&&<option value="">未选择目录</option>}{repositories.map(repo=><option value={repo.path} key={repo.path}>{repo.name}</option>)}</select></label>
   {!blocker&&<span className="enigma-terminal-status" data-tone={tone} role="status"><i aria-hidden="true"/>{STATUS_TEXT[status]}</span>}
   {!blocker&&<div className="enigma-terminal-actions">
    <button type="button" onClick={()=>term.current?.clear()} aria-label="清空终端显示" disabled={status!=='running'}>清屏</button>
    {status==='running'?<button type="button" className="danger" onClick={stop}>停止终端</button>:<button type="button" className="primary" disabled={status==='loading'} onClick={reopen}>{status==='idle'?'启动终端':'重新连接'}</button>}
   </div>}
  </header>
  {cwd&&!blocker&&<p className="enigma-terminal-path" title={cwd}>{cwd}</p>}
  {error&&<p className="enigma-terminal-error" role="alert">{error}</p>}
  {blocker?<div className="enigma-terminal-empty" role="note">
   {blocker==='remote'&&<><strong>终端仅在本机连接时可用</strong><span>当前连接的是远程服务器。为安全起见，远程连接不开放命令行，请在服务器所在的电脑上使用。</span></>}
   {blocker==='session'&&<><strong>先开始一个对话</strong><span>终端跟随对话运行，关闭面板后进程仍会保留。新建对话后会在当前工作目录自动连接。</span><button type="button" className="primary" disabled={creating} onClick={()=>void startSession()}>{creating?'正在创建对话…':'新建对话并打开终端'}</button></>}
   {blocker==='repos-loading'&&<><strong>正在读取工作目录…</strong><span>读取完成后会自动连接终端。</span></>}
   {blocker==='no-cwd'&&<><strong>还没有选择工作目录</strong><span>在对话输入框上方的「工作目录」里选择一个文件夹或仓库，终端会在那里运行。</span></>}
  </div>:<div ref={container} className="enigma-terminal-emulator" onClick={()=>term.current?.focus()}/>}
  {!blocker&&<footer>命令在所选目录运行 · 隐藏面板会保留进程 · 「停止终端」会结束进程</footer>}
 </section>;
}
