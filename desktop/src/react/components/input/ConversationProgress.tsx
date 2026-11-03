import {useEffect,useRef,useState} from 'react';
import {useStore} from '../../stores';
import {selectIsStreamingSession} from '../../stores/session-selectors';
import {hanaFetch} from '../../hooks/use-hana-fetch';
import {SurfaceMenu} from '../../engineering/SurfaceMenu';
import {AppIcon} from '../../ui/app-icons';
import {toggleJianSidebar} from '../../stores/desk-actions';
import {dockScope,selectDockTab} from '../../stores/right-dock-store';
import {useChangesPanel} from '../../stores/changes-panel-store';
import {elapsedClock,type SessionTiming} from '../../../../../shared/session-timing';
import {formatClockTime} from '../chat/SessionClock';
import './ConversationProgress.css';

let navigationRevision=0;
export function openConversationReview(view:'diff'|'review',range?:{from?:string;to?:string},file?:{repo:string;file:string}){
 const state=useStore.getState();if(!state.currentSessionPath||state.pendingSessionSwitchPath)return;
 const session=state.currentSessionPath,connection=state.activeServerConnectionId||'local';
 useChangesPanel.setState({session,connection,open:true,navigation:{session,connection,revision:++navigationRevision,view,...range,...file}});
 selectDockTab(dockScope(state),'changes');toggleJianSidebar(true);
}
export function ConversationProgress(){
 const path=useStore(s=>s.currentSessionPath),connection=useStore(s=>s.activeServerConnectionId),connected=useStore(s=>s.connected),pending=useStore(s=>s.pendingNewSession||!!s.pendingSessionSwitchPath);
 const streaming=useStore(s=>selectIsStreamingSession(s,path));
 const scope=JSON.stringify([connection,path]),scopeRef=useRef(scope);scopeRef.current=scope;
 const [timing,setTiming]=useState<{scope:string;data:SessionTiming;at:number}>(),[summary,setSummary]=useState<{scope:string;data:any}>(),[now,setNow]=useState(Date.now()),[busy,setBusy]=useState(false),[error,setError]=useState(''),[timingError,setTimingError]=useState(false);
 const refresh=useRef<()=>void>(()=>{});
 useEffect(()=>{
  setError('');setBusy(false);setTimingError(false);if(!path||pending||!connected)return;
  const controller=new AbortController();let loading=false;
  const read=async()=>{if(loading||document.hidden)return;loading=true;try{const r=await hanaFetch('/api/sessions/timing?path='+encodeURIComponent(path),{signal:controller.signal});const data=await r.json();if(!r.ok||data.sessionPath!==path)throw Error('状态读取失败');if(!controller.signal.aborted){setTiming({scope,data,at:Date.now()});setTimingError(false);}}catch{if(!controller.signal.aborted)setTimingError(true);}finally{loading=false;}};
  refresh.current=()=>void read();void read();const timer=setInterval(()=>void read(),3000),tick=setInterval(()=>{if(!document.hidden)setNow(Date.now());},1000);document.addEventListener('visibilitychange',refresh.current);
  return()=>{controller.abort();clearInterval(timer);clearInterval(tick);document.removeEventListener('visibilitychange',refresh.current);};
 },[scope,connected,pending]);
 useEffect(()=>{
  if(!path||pending||!connected)return;const controller=new AbortController();let loading=false;
  const read=async()=>{if(loading||document.hidden)return;loading=true;try{const r=await hanaFetch('/api/enigma/change-workbench/summary?sessionPath='+encodeURIComponent(path),{signal:controller.signal});const data=await r.json();if(!r.ok||!Array.isArray(data.files))throw Error(data.error||'变更统计不可用');if(!controller.signal.aborted)setSummary({scope,data});}catch{if(!controller.signal.aborted)setSummary({scope,data:{error:true,files:[]}});}finally{loading=false;}};
  void read();const timer=streaming?setInterval(()=>void read(),12000):null;document.addEventListener('visibilitychange',read);
  return()=>{controller.abort();if(timer)clearInterval(timer);document.removeEventListener('visibilitychange',read);};
 },[scope,streaming,connected,pending]);
 if(!path||pending)return null;
 const sample=timing?.scope===scope?timing:undefined,goal=sample?.data.goal,files=summary?.scope===scope?summary.data:undefined;
 const stale=!connected||timingError||!sample||now-sample.at>10000;
 const active=goal&&['running','paused'].includes(goal.state);
 const elapsed=goal?.elapsedMs==null?null:goal.elapsedMs+(goal.state==='running'&&!stale?Math.max(0,now-sample!.at):0);
 const control=async(action:'pause'|'resume'|'stop')=>{if(!goal||busy||stale)return;setBusy(true);setError('');try{const r=await hanaFetch('/api/sessions/goal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionPath:path,action,createdAt:goal.startedAt,revision:goal.revision}),throwOnHttpError:false});const data=await r.json();if(!r.ok)throw Error(data.error||'目标操作失败');if(scopeRef.current===scope)setTiming({scope,data,at:Date.now()});}catch(e){if(scopeRef.current===scope){setError(e instanceof Error?e.message:'操作失败');refresh.current();}}finally{if(scopeRef.current===scope)setBusy(false);}};
 return <div className="enigma-conversation-progress">
  <div className="enigma-change-summary" data-liquid="control" aria-label="本对话文件变更">
   {files?.files?.length>0?<SurfaceMenu label={`${files.files.length} 个文件已更改`} panelClassName="enigma-change-summary-menu" hint="本对话已封存轮次的累计变化；点击文件查看相同范围的全量 Diff" icon={<><AppIcon name="file" size={14}/><span>{files.files.length} 个文件已更改</span><span className="enigma-lines-added">+{files.added.toLocaleString()}</span><span className="enigma-lines-removed">−{files.removed.toLocaleString()}</span></>}>
    <p className="enigma-source-note">本对话累计变更{files.pending?' · 当前轮结束后更新':''}</p>
    {files.files.map((file:any)=><button key={`${file.repo}:${file.file}`} onClick={()=>openConversationReview('diff',{from:files.from,to:files.to},file)} title={`${file.repoName||file.repo} / ${file.file}`}><span className="enigma-summary-file">{file.file}<small>{file.repoName||file.repo}</small></span><span className="enigma-summary-counts">{file.added==null?'未计行数':<><span className="enigma-lines-added">+{file.added}</span><span className="enigma-lines-removed">−{file.removed}</span></>}</span></button>)}
    {files.gaps?.length>0&&<p className="enigma-source-note">部分记录不完整，请在审查页核对范围说明。</p>}
   </SurfaceMenu>:<span className="enigma-summary-empty">{files?.error?'变更统计暂不可用':files?.pending?'本轮变更记录中':files?.recorded?'本对话暂无文件变更':'尚无对话变更记录'}</span>}
   <button type="button" className="enigma-open-review" data-tooltip="打开审查工作台；不会自动调用模型或修改文件" onClick={()=>openConversationReview('review',files?.from?{from:files.from,to:files.to}:undefined)}><AppIcon name="read" size={14}/><span>打开审查</span></button>
  </div>
  {active&&<div className="enigma-goal-strip" aria-label="当前目标" data-state={goal.state}>
   <SurfaceMenu label="目标详情" hint="查看目标全文、开始时间与轮次" triggerClassName="enigma-goal-title" icon={<><AppIcon name="loop" size={14}/><strong>{stale?'状态待同步':goal.state==='paused'?'已暂停的目标':'进行中的目标'}</strong><span className="enigma-goal-text">{goal.objective||'持续任务'}</span></>}><p className="enigma-goal-objective">{goal.objective}</p><p>开始于 {formatClockTime(goal.startedAt)}</p><p>累计运行 {elapsedClock(elapsed)} · 第 {goal.turnCount??0} 轮{goal.maxTurns?` / ${goal.maxTurns}`:''}</p><p>暂停期间不累计时间。暂停或结束目标只停止后续自动轮次；当前回复可用输入框的停止按钮中断。</p>{goal.nextRunAt&&<p>下次唤醒 {formatClockTime(goal.nextRunAt)}</p>}</SurfaceMenu>
   <span className="enigma-goal-elapsed" title={`目标开始 ${formatClockTime(goal.startedAt)}`}>{elapsedClock(elapsed)}</span>
   <button type="button" disabled={busy||stale} aria-label={goal.state==='paused'?'继续目标':'暂停目标'} data-tooltip={goal.state==='paused'?'继续目标，安排下一轮':'暂停后续自动轮次，保留已有工作'} onClick={()=>void control(goal.state==='paused'?'resume':'pause')}>{goal.state==='paused'?<AppIcon name="arrowEnter" size={14}/>:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>}</button>
   <button type="button" disabled={busy||stale} aria-label="结束目标" data-tooltip="结束后续自动轮次，保留目标记录与文件" onClick={()=>void control('stop')}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="3"/></svg></button>
   <button type="button" aria-label="查看任务概览" data-tooltip="在侧边栏查看计划、协作和运行时间" onClick={()=>{selectDockTab(dockScope(useStore.getState()),'tasks');toggleJianSidebar(true);}}><AppIcon name="panelRight" size={14}/></button>
  </div>}
  {error&&<p role="alert" className="enigma-error">{error}</p>}
 </div>;
}
