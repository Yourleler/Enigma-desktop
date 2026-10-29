import type { ReactNode } from 'react';
import { useStore } from '../stores';
import { showAction, showRecordAction, useEngineering } from './state';
import { useSideQuery } from './useSideQuery';
import { displayTime } from './interaction-copy';

const states: Record<string, string> = {
  ready: '可以开始', pending: '待开始', blocked: '等待前置任务', running: '正在执行',
  failed: '执行失败', verified: '已验收', stale: '需要重新验证',
};
export function PlanPanel({ initial, evidence }: { initial: any; evidence: (value: any) => ReactNode }) {
  const sessionPath = useEngineering(s => s.sessionPath), snapshot = useEngineering(s => s.snapshot);
  const readOnly = useStore(s => s.sessionPermissionMode === 'read_only');
  const query = useSideQuery<any>('/data/plan', sessionPath);
  const value = query.receivedAt ? query.data : initial;
  const busy = snapshot?.state?.idle === false || snapshot?.state?.operation?.state === 'running';
  const disabled = readOnly || busy || !!query.error;
  const reason = readOnly ? '当前对话只读，不能修改计划' : busy ? '等待当前操作完成后再更新计划' : query.error ? '先重新读取当前计划，再更新步骤' : '带入当前计划和步骤；标记已验收仍需有效检查证据';
  const create = snapshot?.actions?.find((action: any) => action.id === 'plan-create');
  const canUpdate = snapshot?.actions?.some((action: any) => action.id === 'plan-step');
  const steps = value?.steps || [];
  const stepName = (id: string) => steps.find((step: any) => step.id === id)?.goal || id;
  return <section className="enigma-plan">
    <p className="enigma-source-note">进度按当前代码的验收结果计算，每 5 秒更新。{query.receivedAt > 0 && ` 最近读取：${displayTime(query.receivedAt)}`}</p>
    {query.error && <p className="enigma-error" role="status">计划更新失败，以下为最近记录。<button onClick={() => void query.refresh()}>重新读取计划</button></p>}
    {!value?.plan ? <div className="enigma-empty-feature">
      <h3>把目标整理成可验证的步骤</h3><p>描述要完成的事，让助手建立计划；每一步通过指定检查后才计入完成。也可以手动定义目标与步骤。</p>
      {create && <button disabled={disabled} data-tooltip={reason} onClick={() => void showAction(create)}>建立任务计划</button>}
    </div> : <>
      <div className="enigma-task-heading"><span>当前目标</span><h3>{value.plan.goal}</h3>
        <div className="enigma-plan-meter" role="progressbar" aria-label="已验收任务进度" aria-valuenow={value.completed} aria-valuemin={0} aria-valuemax={value.total} aria-valuetext={`${value.completed} / ${value.total} 步骤已验收`}>
          <div style={{ width: `${value.total ? value.completed / value.total * 100 : 0}%` }} />
        </div><small>{value.completed} / {value.total} 步骤已验收 · 修订 {value.plan.revision}</small>
      </div>
      {steps.map((step: any) => {
        const state = step.state || step.phase;
        return <article className="enigma-step" key={step.id}>
          <span data-phase={state} aria-hidden="true">{state === 'verified' ? '✓' : state === 'running' ? '◌' : state === 'stale' || state === 'failed' ? '!' : '○'}</span>
          <div><strong>{step.goal}</strong><div className="enigma-chips"><span>{step.repo}</span><span>{states[state] || state}</span>{(step.checks || []).map((check: string) => <span key={check}>检查 {check}</span>)}</div>
            {state === 'stale' && <p>代码、环境或验收条件已变化，原通过记录不再计入完成。请重新运行检查。</p>}
            {!!step.blockedBy?.length && <p>等待：{step.blockedBy.map(stepName).join('、')}</p>}
            {!step.checks?.length && <p>尚未指定验收检查，因此不能标记为已验收。</p>}
            {step.note && <p>最近说明：{step.note}</p>}
            {canUpdate && <button disabled={disabled} data-tooltip={reason} onClick={() => void showRecordAction('plan-step', { plan: value.plan.id, revision: value.plan.revision, step: step.id, phase: step.phase })}>更新此步骤</button>}
          </div>
        </article>;
      })}
      {!!value.gaps?.length && <p className="enigma-source-note">有 {value.gaps.length} 项验收或依赖缺口，请展开下方记录核对。</p>}
      <details className="enigma-result"><summary>计划依赖与完整证据</summary>{evidence(value)}</details>
    </>}
  </section>;
}
