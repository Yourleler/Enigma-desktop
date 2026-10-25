import { useEffect,useState } from 'react';
import { engineeringRequest,useEngineering } from './state';
import { MarkdownContent } from '../components/chat/MarkdownContent';
import { renderMarkdown } from '../utils/markdown';

const phases:Record<string,string>={watching:'持续观察',diagnosing:'独立诊断中',intervening:'正在处理', 'waiting-user':'等待接管','host-unavailable':'宿主未响应',stopped:'已停止'};
export function GuardianPanel(){
  const sessionPath=useEngineering(state=>state.sessionPath),[status,setStatus]=useState<any>(null),[question,setQuestion]=useState(''),[answer,setAnswer]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const refresh=async()=>{try{setStatus(await engineeringRequest('/guardian/status',sessionPath));}catch(error){setError(String(error));}};
  useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),5000);return ()=>clearInterval(timer);},[sessionPath]);
  const perform=async(action:string)=>{setBusy(true);setError('');try{
    if(action==='ask'){const result=await engineeringRequest('/guardian/diagnose',sessionPath,{question});setAnswer(result.answer);}
    else if(action==='start')await engineeringRequest('/guardian/start',sessionPath,{config:{mode:'assist',stageDeadlineMs:60000,maxInterventions:0,allowedActions:['notify']}});
    else await engineeringRequest('/guardian/stop',sessionPath,{});
    await refresh();
  }catch(error){setError(String(error));}finally{setBusy(false);}};
  const running=status&&status.phase!=='stopped';
  return <section className="enigma-welcome-card enigma-guardian"><h3>独立管家</h3><p>单独的进程持续观察运行状况。你也可以随时问它任务有没有有效进展、在等什么，或应该怎样排障。</p>
    <div className="enigma-chips"><span>{running?phases[status.phase]||'状态待核对':'尚未启动'}</span>{status?.pid&&<span>独立进程 {status.pid}</span>}</div>
    <button disabled={busy} onClick={()=>void perform(running?'stop':'start')}>{running?'停止独立观察':'启动独立观察'}</button>
    <label className="enigma-field"><span>向旁路提问</span><textarea value={question} maxLength={1500} onChange={event=>setQuestion(event.target.value)} placeholder="例如：这轮验证是否有有效进展，下一步该核对哪里？"/></label>
    <button disabled={busy||!question.trim()} onClick={()=>void perform('ask')}>{busy?'正在处理…':'独立诊断'}</button>
    {answer&&<div className="enigma-result"><MarkdownContent html={renderMarkdown(answer)}/></div>}
    {status?.diagnosis&&!answer&&<p>{status.diagnosis.answer}</p>}
    {status?.events?.length>0&&<details className="enigma-result"><summary>观察与接管记录</summary>{status.events.slice(-10).map((event:any,index:number)=><p key={index}>{event.text}</p>)}</details>}
    {error&&<p className="enigma-error">{error}</p>}
  </section>;
}
