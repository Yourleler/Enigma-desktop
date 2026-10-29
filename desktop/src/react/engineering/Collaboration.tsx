import { useEffect, useRef, type ReactNode } from 'react';
import { useStore } from '../stores';
import { showRecordAction, useEngineering } from './state';
import { useSideQuery } from './useSideQuery';
import { operationLabel, displayTime } from './interaction-copy';

const nextSteps: Record<string, string> = {
  starting: '正在准备独立工作区，当前项目文件保留。', running: '任务在独立目录执行，结果会自动更新到这里。',
  completed: '子任务已结束。先查看结果与合并预览，再决定是否应用到当前项目。',
  failed: '任务未成功结束。先查看错误和已产出的内容，再创建后续任务。',
  cancelled: '任务已取消，部分结果可能保留在独立目录中；未合并到当前项目。',
  timeout: '已达到运行时间上限。先核对部分结果，再缩小后续任务或调整时间限制。',
  budget: '已达到模型调用上限。先核对部分结果，再决定后续任务和预算。',
  unknown: '执行结果尚未确认。先查看回执与工作目录，不能据此合并或声称任务完成。',
};
export function CollaborationPanel({ initial, evidence }: { initial: any; evidence: (value: any) => ReactNode }) {
  const sessionPath = useEngineering(s => s.sessionPath), snapshot = useEngineering(s => s.snapshot);
  const readOnly = useStore(s => s.sessionPermissionMode === 'read_only');
  const query = useSideQuery<any>('/data/collaboration', sessionPath), value = query.data || initial;
  const busy = snapshot?.state?.idle === false || snapshot?.state?.operation?.state === 'running';
  const disabled = readOnly || busy || !!query.error;
  const action = (id: string, args: Record<string, unknown>, label: string, help: string, blocked = false) => snapshot?.actions?.some((item: any) => item.id === id) && <button disabled={disabled || blocked} data-tooltip={readOnly ? '当前对话只读，不能执行协作操作' : busy ? '等待当前操作结束' : query.error ? '先刷新当前任务状态' : help} onClick={() => void showRecordAction(id, args)}>{label}</button>;
  return <section>
    <h3>把一部分工作交给独立任务</h3>
    <p className="enigma-feature-intro">子任务在独立目录执行。完成后先预览合并，再运行当前项目的验收。多个方案可以用相同检查比较。</p>
    <p className="enigma-source-note">每 5 秒更新子任务状态。{query.receivedAt > 0 && ` 最近读取：${displayTime(query.receivedAt)}`}</p>
    {query.error && <p className="enigma-error" role="status">协作状态更新失败，以下为最近记录。<button onClick={() => void query.refresh()}>重新读取状态</button></p>}
    <div className="enigma-inline-actions">{action('delegate-start', {}, '创建独立子任务', '选择目标、仓库、模型与运行限制')}{action('experiment-create', {}, '比较多个方案', '选择从相同代码起点创建的子任务，使用相同验收条件比较')}</div>
    {(value.delegations || []).map((item: any) => <article className="enigma-step" key={item.spec.id}><div>
      <strong>{item.spec.goal || item.spec.id}</strong>
      <div className="enigma-chips"><span>{operationLabel(item.status)}</span><span>{item.spec.target === 'pi' ? 'Pi' : 'Codex'}</span>{item.spec.model && <span>{item.spec.model}</span>}</div>
      <p>{nextSteps[item.status] || '请核对这项任务的运行记录。'}</p>
      {item.state?.error && <p className="enigma-error">{item.state.error}</p>}
      {item.state?.answer && <details className="enigma-result"><summary>阅读子任务结果</summary><pre>{item.state.answer}</pre></details>}
      {item.terminal && item.status === 'completed' ? action('delegate-preview', { id: item.spec.id }, '预览合并结果', '核对当前项目与子任务的差异；预览不应用代码') : !item.terminal ? action('delegate-cancel', { id: item.spec.id }, '取消此任务', '请求子任务停止，保留已有回执') : null}
      <details className="enigma-result"><summary>工作目录、回执与诊断</summary><p>独立目录：{item.spec.workspace}</p>{evidence(item)}</details>
    </div></article>)}
    {!value.delegations?.length && <p className="enigma-source-note">还没有独立子任务。可以先分出一项边界清楚的工作，例如单独核对接口兼容性。</p>}
    {!!value.experiments?.length && <><h3>方案比较</h3>{value.experiments.map((item: any) => <article className="enigma-step" key={item.experiment.id}><div>
      <strong>{item.experiment.goal}</strong>
      <p>{!item.criteriaCurrent ? '验收条件已变化，请按当前条件建立新的比较。' : !item.report ? '尚未运行共同验收。创建比较不会自动执行检查或合并代码。' : '结果对应下方记录的代码版本；选择方案后仍需预览合并。'}</p>
      <p>共同检查：{item.experiment.criteria?.map((check:any)=>`${check.id}（${check.repo}）`).join('、')||'查看下方比较记录'}</p>
      {action('experiment-evaluate', { id: item.experiment.id }, item.report ? '重新运行共同验收' : '运行共同验收', '在各候选方案的独立目录执行相同的原检查', !item.criteriaCurrent)}
      {(item.report?item.candidates||[]:item.experiment.candidates||[]).map((candidate: any) => <div className="enigma-record" key={candidate.id}><strong>方案 {candidate.id}</strong><p>{value.delegations?.find((child:any)=>child.spec.id===candidate.delegation)?.spec.goal}</p><p>{!item.report?'尚未验收':candidate.selectable ? '当前验收通过' : candidate.status === 'passed' ? '原验收通过，当前已失效' : candidate.status === 'failed' ? '验收未通过' : '暂不能验收'}</p>{candidate.reason && <p>{candidate.reason.replace(/^Child execution is (\w+); no acceptance is inferred$/,(_:string,status:string)=>`子任务${operationLabel(status)}，不能计为验收通过。`)}</p>}
        {Number.isFinite(candidate.durationMs)&&<small>子任务用时 {(candidate.durationMs/1000).toFixed(1)} 秒 · 工具调用 {candidate.tools} 次{candidate.sdkCalls!==undefined?` · 模型请求 ${candidate.sdkCalls} 次`:''}</small>}
        {!!candidate.actual?.results?.length&&<details className="enigma-result"><summary>查看检查输出 · {candidate.actual.results.length} 项</summary>{candidate.actual.results.map((check:any)=><div key={check.check}><strong>{check.check} · {check.status==='passed'?'通过':'未通过'}</strong>{check.output&&<pre className="enigma-runtime-log">{check.output}</pre>}</div>)}</details>}
        {candidate.selectable && action('experiment-select', { id: item.experiment.id, candidate: candidate.id }, `预览采用 ${candidate.id}`, '生成这项方案的合并预览；下一步仍需确认')}</div>)}
      <details className="enigma-result"><summary>共同检查与比较记录</summary>{evidence(item)}</details>
    </div></article>)}</>}
  </section>;
}

export function DelegationMergePreview({ value, details }: { value: any; details: ReactNode }) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => { root.current?.focus({ preventScroll: true }); root.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' }); }, [value.id]);
  const snapshot = useEngineering(s => s.snapshot), readOnly = useStore(s => s.sessionPermissionMode === 'read_only');
  const busy = snapshot?.state?.idle === false || snapshot?.state?.operation?.state === 'running';
  const applicable = value.changes.filter((change: any) => ['apply', 'merged'].includes(change.state));
  const canMerge = snapshot?.actions?.some((action: any) => action.id === 'delegate-merge');
  return <section ref={root} tabIndex={-1} className="enigma-restore-preview" aria-label="子任务合并预览">
    <button className="enigma-dismiss-preview" aria-label="关闭合并预览" data-tooltip="收起预览并回到子任务列表，不修改文件" onClick={() => useEngineering.setState(current => { const results = { ...current.results }; delete results[current.active]; return { results }; })}>×</button>
    <h3>{!value.applyAllowed ? '合并需要先处理冲突' : applicable.length ? '子任务合并预览已准备' : '当前项目已包含这些结果'}</h3>
    <p>把子任务的改动应用到当前项目，保留当前项目其他修改。这次预览没有修改项目文件。</p>
    <p>共 {value.changes.length} 个文件，其中 {applicable.length} 个待应用。</p>
    {value.conflicts.map((conflict: string) => <p className="enigma-error" key={conflict}>{conflict}</p>)}
    {value.changes.map((change: any) => <details className="enigma-restore-file" key={`${change.repo}:${change.file}`}><summary>{change.repo} / {change.file} · {({ apply: '待应用', merged: '已准备三方合并', 'already-present': '当前已有', conflict: '存在冲突' } as Record<string, string>)[change.state] || change.state}</summary>{change.reason && <p>{change.reason}</p>}{change.patchTruncated && <p>差异较长，这里显示前 48,000 字符；请在独立工作目录核对完整文件。</p>}{change.patch ? <pre>{change.patch}</pre> : <p>此记录未提供逐行差异，应用前请核对子任务工作目录和完整预览记录。</p>}</details>)}
    {canMerge && <button disabled={readOnly || busy || !value.applyAllowed || !applicable.length} data-tooltip={readOnly ? '当前对话只读，不能合并' : busy ? '等待当前操作结束' : '进入最终确认；应用前重查当前文件，之后执行项目原验收'} onClick={() => void showRecordAction('delegate-merge', { id: value.id })}>继续确认合并</button>}
    <details className="enigma-result"><summary>来源与完整合并记录</summary>{details}</details>
  </section>;
}
