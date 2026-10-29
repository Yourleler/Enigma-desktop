import type { ReactNode } from 'react';
import { useEngineering } from './state';
import { useSideQuery } from './useSideQuery';
import { displayTime, operationLabel } from './interaction-copy';

export function RuntimeStatus({ evidence }: { evidence: (value: any) => ReactNode }) {
  const sessionPath=useEngineering(s=>s.sessionPath);
  const query=useSideQuery<any>('/data/observer',sessionPath),value=query.data;
  return <section className="enigma-runtime-facts">
    <div className="enigma-section-heading"><h3>当前运行状态</h3><button disabled={query.loading} onClick={()=>void query.refresh()}>更新状态</button></div>
    <p className="enigma-source-note">每 5 秒读取最近一次运行记录，不调用模型。此前已完成的操作见下方回执历史。{query.receivedAt>0&&`最近读取：${displayTime(query.receivedAt)}`}</p>
    {query.error&&<p className="enigma-error" role="status">状态更新失败，以下记录可能已经过期：{query.error}</p>}
    {!value?<p role="status">{query.loading?'正在读取当前任务的运行记录…':'暂时无法读取运行状态。'}</p>:<>
      <p>{value.available?value.answer:'尚无可用的运行记录。任务开始后会显示实际执行阶段；已有任务也可通过下方独立诊断核对采集情况。'}</p>
      {value.status&&<><div className="enigma-chips"><span>{operationLabel(value.status.state)}</span><span>{operationLabel(value.status.sourceProcess?.liveness)}</span><span>{operationLabel(value.status.observation)}</span></div>
        <details className="enigma-result"><summary>可回查的事实与时间记录</summary>{evidence(value.status)}</details></>}
      {value.operationHistory?.length>0&&<details className="enigma-result"><summary>工作台操作记录 · {value.operationHistory.length} 项</summary><p className="enigma-source-note">当前对话的已保存回执，重启后仍可查看。历史通过不代表当前源码仍通过。</p>{value.operationHistory.map((item:any)=><article className="enigma-step" key={item.id}><div><strong>{item.title}</strong><p>{operationLabel(item.state)}{item.outcome&&` · ${item.outcome==='passed'?'检查通过':item.outcome==='verified'?'已验收':operationLabel(item.outcome)}`} · {displayTime(item.at)}</p>{item.error&&<p className="enigma-error">{item.error}</p>}{item.output&&<pre>{item.output}</pre>}{item.payloadIncomplete&&<small>详细结果未完整保存，请从对应功能页核对原记录。</small>}</div></article>)}</details>}
    </>}
  </section>;
}
