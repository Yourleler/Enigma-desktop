import { useState } from 'react';
import { switchSession } from '../stores/session-actions';
import { MarkdownContent } from '../components/chat/MarkdownContent';
import { renderMarkdown } from '../utils/markdown';
import { engineeringRequest,useEngineering,openEngineering } from './state';

const statuses:Record<string,string>={queued:'等待前置任务',creating:'正在准备工作区',running:'执行中',completed:'执行已结束',failed:'执行失败',cancelled:'已取消',blocked:'需要处理阻塞'};
export function ConductorTasks({value}:{value:any}){
  const sessionPath=useEngineering(state=>state.sessionPath),[error,setError]=useState(''),[reporting,setReporting]=useState(false);
  const report=async()=>{setReporting(true);setError('');try{const artifact=await engineeringRequest('/conductor/report',sessionPath,{});openEngineering({id:`artifact:${artifact.id}`,group:'artifacts',artifact:artifact.id,title:artifact.title});}catch(error){setError(String(error));}finally{setReporting(false);}};
  return <>
    <div className="enigma-reading-intro"><h3>任务编排管家</h3><p>向管家交代目标和允许范围，它会组织项目、工作对话和模型，跟踪结果并协调问题。</p></div>
    <div className="enigma-stat-grid">{[['工作对话',value.tasks.length],['同时运行',value.active],['待协调冲突',value.conflicts.length]].map(([label,count])=><div key={String(label)}><strong>{count}</strong><span>{label}</span></div>)}</div>
    <p className="enigma-source-note">{value.acceptance?.valid&&value.acceptance.status==='verified'?'当前版本的原联合检查已通过；其他目标要求仍须核对。':value.acceptance?'原联合检查尚未通过或证据已过期。':'原联合检查尚未执行。'}工作对话执行结束后，可让管家预览并选择成果，再做整体验收。</p>
    {value.projects.length>0&&<div className="enigma-chips">{value.projects.map((project:any)=><span key={project.id}>项目 · {project.name}</span>)}</div>}
    {value.tasks.map((task:any)=><article className="enigma-step" key={task.id}>
      <span>{task.status==='running'?'◌':task.status==='completed'?'✓':'○'}</span>
      <div><strong>{task.title}</strong><p>{task.goal}</p>
        <div className="enigma-chips"><span>{statuses[task.status]||'状态待核对'}</span><span>{task.writeRepos.length?`可写 ${task.writeRepos.join('、')}`:'只读任务'}</span><span>{task.progress?.verification==='verified'?'原检查已通过':'验收仍需核对'}</span></div>
        {task.observation?.available&&<p className="enigma-source-note">{task.observation.lastProgress?`最近证据：${task.observation.lastProgress.reference||task.observation.lastProgress.stage}`:'尚未取得新的源码或检查证据'}</p>}
        {task.result&&<details className="enigma-result"><summary>查看结果与依据</summary><MarkdownContent html={renderMarkdown(task.result)}/></details>}
        {task.error&&<p className="enigma-error">{task.error}</p>}
        {task.sessionPath&&<button onClick={()=>void switchSession(task.sessionPath)}>打开工作对话</button>}
      </div>
    </article>)}
    {!value.tasks.length&&<div className="enigma-welcome-card"><h3>把一项目标交给管家</h3><p>可以安排独立验证、比较方案、代码与文档协作，或交代其他目标。管家会在你允许的范围内组织任务。</p></div>}
    {value.tasks.length>0&&<button className="enigma-primary" onClick={()=>void report()} disabled={reporting}>{reporting?'正在保存工作报告…':'汇总为工作报告'}</button>}
    {error&&<p className="enigma-error">{error}</p>}
    <details className="enigma-result"><summary>协调记录与待处理冲突</summary>{value.conflicts.map((conflict:any,index:number)=><p key={index}>{conflict.repo} / {conflict.file} 在两个工作对话中产生了不同结果，需要核对后选择。</p>)}{value.events.map((event:any,index:number)=><p key={index}><small>{event.at}</small> · {event.text}</p>)}</details>
  </>;
}
