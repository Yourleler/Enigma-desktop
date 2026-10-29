import type {ReactNode} from 'react';
import {useEngineering,openGroup} from './state';
import {useSideQuery} from './useSideQuery';
import {composeTaskRequest,assistedOperations} from './compose-task';
import {displayTime,explainEvidenceProblem,operationLabel} from './interaction-copy';

function OperationRequest({item}:{item:any}){
  const errorText=item.error?.includes('Project resource was removed or is unavailable')?'资料已移除或暂不可用，请核对原始来源。':item.error?.includes('Insufficient access')?'当前对话没有权限执行这项操作。':'操作未完成，请查看诊断或让助手核对原因。';
  return <article className="enigma-step"><div>
    <strong>{item.title}</strong><p>{item.current?item.assessment==='operation-receipt'?'已有执行回执':'已有核对说明':`${operationLabel(item.state)}，需要核对`}{item.outcome?` · ${operationLabel(item.outcome)}`:''}</p>
    {item.error&&<><p className="enigma-error">{errorText}</p><details><summary>诊断详情</summary><pre>{item.error}</pre></details></>}{item.resolution&&<p>处理说明：{item.resolution.reason}</p>}
    {!item.current&&<button data-tooltip="把这项操作的核对请求加入草稿，不会直接重做" onClick={()=>composeTaskRequest(`请核对工作台操作「${item.title}」（原消息 ${item.id}，操作 ${item.operation}）的实际结果和遗留影响。它当前为 ${item.state}${item.outcome?' / '+item.outcome:''}。先查证，再用 task_acceptance 记录处理说明；不要直接重放，也不要遗漏仍需完成的目标。`)}>让助手核对这项操作</button>}
    <details><summary>原操作请求</summary><p>{item.text}</p></details>
  </div></article>;
}

export function AcceptancePanel({initial,evidence}:{initial:any;evidence:(value:any)=>ReactNode}){
  const sessionPath=useEngineering(s=>s.sessionPath),query=useSideQuery<any>('/data/acceptance',sessionPath);
  const value=query.data||initial,requirements=value.requirements||[],operations=value.operationRequests||[],assumptions=value.assumptions||[],gaps:string[]=value.gaps||[];
  const count=(prefix:string)=>gaps.filter(gap=>gap.startsWith(prefix)).length;
  return <section>
    <h3>逐项核对原要求</h3><p className="enigma-feature-intro">这里对照你的原消息、助手的处理说明与实际证据。写了“完成”不代表检查通过；过期或缺失的证据会重新列为待核对。</p>
    <p className="enigma-source-note">每 5 秒更新。{query.receivedAt>0&&` 最近读取：${displayTime(query.receivedAt)}`}</p>
    {query.error?<p role="status" className="enigma-error">验收状态更新失败，以下为最近记录，不能据此确认完成。<button onClick={()=>void query.refresh()}>重新读取验收</button></p>:<p>{value.readyForReview?'原要求已有当前处理说明和有效证据，可以进行最终复核。':'还有要求、假设或检查需要处理。'}</p>}
    <button data-tooltip="将核对请求放入输入框，可补充遗漏要求后自行发送" onClick={()=>composeTaskRequest(assistedOperations[0].prompt)}>让助手逐项核对</button>
    <div className="enigma-stat-grid"><div><strong>{requirements.filter((item:any)=>item.current).length} / {requirements.length}</strong><span>原要求已对应证据</span></div><div><strong>{assumptions.filter((item:any)=>item.status==='open'||!item.current).length}</strong><span>假设待核对</span></div><div><strong>{value.plan?`${value.plan.completed} / ${value.plan.total}`:'未建立'}</strong><span>计划步骤已验收</span></div></div>
    {value.sourceStable===false&&<p className="enigma-error">核对期间源码发生变化，这次结果不能确认完成，请在修改结束后重新读取。</p>}
    {value.verificationIssue&&<p className="enigma-error">{value.verificationIssue}</p>}
    <div className="enigma-acceptance-blockers">
      {!query.error&&value.verification?.status==='verified'&&<p>当前项目原检查已通过；原要求与计划仍需分别核对。</p>}
      {gaps.includes('original-checks:not-currently-verified')&&<p>项目原检查尚未通过，或通过记录已失效。<button onClick={()=>openGroup('project')}>查看项目检查</button></p>}
      {gaps.includes('plan:unfinished')&&<p>任务计划还有未验收的步骤。<button onClick={()=>openGroup('plan')}>查看任务计划</button></p>}
      {(count('command:')+count('wait:')+count('background:'))>0&&<p>还有 {count('command:')} 条后台命令、{count('wait:')} 项接续等待、{count('background:')} 项执行效果需要核对。<button onClick={()=>openGroup('environment')}>查看环境与等待</button></p>}
      {count('operation:')>0&&<p>{count('operation:')} 项操作仍在执行或结果待确认。<button onClick={()=>openGroup('timeline')}>核对运行记录</button></p>}
    </div>
    {!requirements.length&&<p className="enigma-empty-feature">{operations.length?'当前只有工作台操作记录。它们有各自的回执，但不能代替完整任务目标。':'当前对话还没有可核对的原要求。'}先在对话里描述目标和限制，再让助手逐项核对。</p>}
    {requirements.map((item:any)=><article className="enigma-welcome-card" key={item.id}>
      <strong>{!item.current?'待核对原要求':item.resolution?.assessment==='not-applicable'?'助手判断不适用，需核对理由':'已有当前处理说明'}</strong><p>{item.text}</p>
      {item.resolution&&<p>处理说明：{item.resolution.reason}</p>}
      {(item.problems||[]).map((problem:string)=><p className="enigma-error" key={problem}>{explainEvidenceProblem(problem)}</p>)}
    </article>)}
    {!!operations.length&&<details className="enigma-result" open={operations.some((item:any)=>!item.current)||undefined}>
      <summary>工作台操作 · {operations.filter((item:any)=>item.current).length} / {operations.length} 项已有回执或处理说明</summary>
      <p className="enigma-source-note">常规查看、检查和配置操作按实际回执核对，不会反复要求助手解释成功的点击。原消息仍保留；输入了新目标的操作仍列在上方任务要求中。</p>
      {operations.filter((item:any)=>!item.current).map((item:any)=><OperationRequest key={item.id} item={item}/>)}
      {operations.some((item:any)=>item.current)&&<details><summary>{operations.filter((item:any)=>item.current).length} 项已记录的操作</summary>{operations.filter((item:any)=>item.current).map((item:any)=><OperationRequest key={item.id} item={item}/>)}</details>}
    </details>}
    {!!assumptions.length&&<><h3>方案依赖的假设</h3><p className="enigma-source-note">先确认这些前提是否成立，避免在错误方向上继续投入。</p>{assumptions.map((item:any)=><article className="enigma-welcome-card" key={item.id}><strong>{item.text}</strong><p>什么情况会推翻它：{item.failureCondition}</p><p>{item.status==='open'?'尚未验证':!item.current?'依据已失效，需要重新核对':item.status==='supported'?'当前证据支持':'当前证据已否定'}</p>{item.reason&&<p>{item.reason}</p>}</article>)}</>}
    <details className="enigma-result"><summary>原要求、运行状态与完整证据</summary>{evidence(value)}</details>
  </section>;
}
