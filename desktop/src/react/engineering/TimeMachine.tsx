import {SearchField} from '../ui/SearchField';
import { GlassSelection } from '../ui/GlassSelection';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../stores';
import { showAction,showRecordAction,openEngineering, previewCheckpoint, useEngineering, type Action } from './state';
import { checkpointChoice, checkpointLabel, displayTime, explainConflict } from './interaction-copy';
import { assistedOperations, composeTaskRequest } from './compose-task';

export function timeAction(action: Action, values: Record<string, unknown>) {
  return { ...action, fields: action.fields.map(field => field.name in values ? { ...field, value: values[field.name] } : field) };
}
export function TimeMachine({ value, details }: { value: any; details: ReactNode }) {
  const snapshot = useEngineering(s => s.snapshot);
  const nativeSessionId = useStore(s => s.currentSessionId);
  const sessionId = snapshot?.state?.chat?.session || nativeSessionId;
  const sessionPath = useEngineering(s => s.sessionPath);
  const connectionId = useEngineering(s => s.connectionId);
  const readOnly = useStore(s=>s.sessionPermissionMode==='read_only');
  const [filter, setFilter] = useState('');
  const [view, setView] = useState<'code'|'reasoning'>('code');
  const [previewing, setPreviewing] = useState(''), [previewError, setPreviewError] = useState('');
  useEffect(() => { setPreviewing(''); setPreviewError(''); setFilter(''); }, [sessionPath, connectionId]);
  const tabId = useId();
  const points: any[] = [...(value.checkpoints || [])].sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const current = points[0];
  const actions: Action[] = snapshot?.actions || [];
  const busy = snapshot?.state?.idle === false || snapshot?.state?.operation?.state === 'running' || !!previewing;
  const preview = async (target: string) => {
    if (busy || !current) return;
    setPreviewing(target); setPreviewError('');
    const stillCurrent = () => useEngineering.getState().sessionPath === sessionPath && useEngineering.getState().connectionId === connectionId;
    try { await previewCheckpoint(target, current.id); }
    catch (error) { if (stillCurrent()) setPreviewError(String(error)); }
    finally { if (stillCurrent()) setPreviewing(''); }
  };
  const open = (id: string, defaults: Record<string, unknown> = {}) => {
    const action = actions.find(action => action.id === id);
    if (action && !busy) void showAction(timeAction(action, defaults));
  };
  const pending = (value.operations || []).filter((op: any) => ['pending', 'unknown'].includes(op.status));
  const interrupted=<InterruptedOperations operations={value.operations||[]} details={details}/>;
  const visible = points.filter(point => `${checkpointLabel(point.label)} ${displayTime(point.createdAt)} ${point.repos?.map((r:any) => r.repo.id).join(' ')}`.toLowerCase().includes(filter.trim().toLowerCase()));
  return <div className="enigma-time-machine">
    <p className="enigma-feature-intro">走偏时，从这里选择继续方式。<strong>改变助手思路</strong>和<strong>恢复项目文件</strong>是两种不同操作。</p>
    {busy && <p className="enigma-source-note" role="status">{previewing ? '正在核对快照差异与当前文件…' : '任务正在运行，快照和恢复操作需等待本轮结束；可以先查看记录。'}</p>}
    {previewError && <p className="enigma-error" role="alert">预览未完成：{previewError}。可以重试，文件未恢复。</p>}
    {pending.length > 0 && <p className="enigma-error" role="status">这个工作区有 {pending.length} 项操作仍在执行，或中断后结果待核对。恢复前请先查看运行记录。</p>}
    {pending.length>0&&interrupted}
    <div className="enigma-view-tabs" role="tablist" aria-label="时光机用途" data-glass-segmented=""><GlassSelection selection={view}/>
      {(['code','reasoning'] as const).map(tab => <button key={tab} id={`${tabId}-${tab}`} role="tab" aria-selected={view===tab} aria-controls={`${tabId}-panel-${tab}`} tabIndex={view===tab?0:-1} data-tooltip={tab==='code'?'查看代码快照并预览文件恢复；数字是快照数量':'让助手带着失败经验调整路线，当前文件保留；数字是已发生的纠偏次数'} onClick={()=>setView(tab)} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?'code':event.key==='End'?'reasoning':view==='code'?'reasoning':'code';setView(next);document.getElementById(`${tabId}-${next}`)?.focus();}}}>{tab==='code'?'恢复代码':'助手纠偏'} {tab==='code'?points.length:value.modelRewinds?.length||0}</button>)}
    </div>
    <details className="enigma-time-help">
      <summary>该用哪一种？</summary>
      <dl>
        <dt>助手反复走错路线 → 纠正思路</dt><dd>在对话里指出问题，例如“这条路线不对，请回到之前的思路，带上失败经验重试”。助手可主动调用时光机，保留最新要求和当前文件，下一轮从更早的上下文继续。</dd>
        <dt>想撤回代码改动 → 恢复代码快照</dt><dd>在“恢复代码”中选一个有明确时间的快照，先查看会改哪些文件，再决定是否恢复。外部修改或 Git 分支变化会阻止覆盖。</dd>
        <dt>想试另一种实现 → 另开代码方案</dt><dd>从快照创建新的独立目录，在保留当前工作的同时继续尝试。</dd>
      </dl>
    </details>
    <section hidden={view!=='code'} role="tabpanel" id={`${tabId}-panel-code`} aria-labelledby={`${tabId}-code`}>
      <div className="enigma-section-heading"><div><h3>代码快照</h3><small>当前工程工作区 · {points.length} 个记录 · 按时间倒序</small></div>
        <button disabled={readOnly || busy || !actions.some(a => a.id === 'checkpoint')} data-tooltip={readOnly?'当前对话只读，不能保存快照':busy ? '等待当前操作完成后再保存' : '保存各仓库当前文件，不提交到 Git'} onClick={() => open('checkpoint')}>保存快照</button>
      </div>
      <p className="enigma-source-note">快照只包含已登记仓库中的可管理文件；依赖目录、密钥文件等不在恢复范围内。</p>
      {!!points.length && <p className="enigma-time-steps" aria-label="恢复步骤"><span>1 选择快照</span><span aria-hidden="true">→</span><span>2 查看差异</span><span aria-hidden="true">→</span><span>3 确认恢复</span></p>}
      {points.length > 4 && <SearchField className="enigma-timeline-search" aria-label="筛选代码快照" placeholder="按名称、时间或仓库筛选" value={filter} onChange={e => setFilter(e.target.value)}/>}
      {!points.length && <div className="enigma-empty-feature"><h3>先保存一个可以回来的位置</h3><p>保存当前代码快照，或在助手完成工作后查看自动记录。历史对话本身不等于代码备份。</p></div>}
      {!!points.length && !visible.length && <p>没有匹配的快照，试试其他名称或清空筛选。</p>}
      {visible.map(point => <article className="enigma-checkpoint" key={point.id}>
        <div><strong>{checkpointLabel(point.label)}</strong><time dateTime={point.createdAt}>{displayTime(point.createdAt)}</time>
          <div className="enigma-chips"><span>{point.session ? point.session === sessionId ? '当前对话' : '其他对话' : '工作区记录'}</span>{point.repos?.map((r:any) => <span key={r.repo.id}>{r.repo.id}</span>)}</div>
          <div className="enigma-inline-actions">
            <button disabled={busy || !current || !actions.some(a => a.id === 'restore-preview')} data-tooltip="直接查看这份快照会改变哪些文件，不会恢复代码" onClick={() => void preview(point.id)}>{previewing === point.id ? '正在核对…' : '查看恢复预览'}</button>
            <button disabled={readOnly || busy || !actions.some(a => a.id === 'code-fork')} data-tooltip={readOnly ? '当前对话只读，不能创建代码方案' : '复制到新的代码工作区，保留当前目录'} onClick={() => open('code-fork', { checkpoint: point.id })}>另开方案</button>
          </div>
        </div>
      </article>)}
    </section>
    <section hidden={view!=='reasoning'} role="tabpanel" id={`${tabId}-panel-reasoning`} aria-labelledby={`${tabId}-reasoning`} className="enigma-time-rewinds">
      <div className="enigma-time-guide"><h3>反复尝试仍没进展？</h3><p>让助手检查路线；需要时回到较早的对话位置，带着失败经验继续。最新要求和当前文件会保留。</p>
        {!value.contextCheckpoints?.length && <p className="enigma-source-note">当前对话暂无可回到的思路位置。仍可让助手分析路线，但现在不能直接回溯。</p>}
        <button disabled={!sessionPath} data-tooltip="把纠偏请求加入输入框，你可以补充哪里走偏，再自行发送" onClick={() => composeTaskRequest(assistedOperations.find(item => item.id === 'context-rewind')!.prompt)}>让助手检查当前路线</button>
        <small>先加入草稿；发出后由助手判断可用的回溯位置。</small>
      </div>
      <h3>助手纠偏记录</h3><p className="enigma-source-note">这里记录助手主动调整思路的原因和经验。<strong>这些记录不会自动撤回文件。</strong></p>
      {value.modelRewinds?.length ? [...value.modelRewinds].reverse().map((item:any) => <article className="enigma-step" key={item.id}><div><strong>{item.reason}</strong><p>保留的经验：{item.lesson}</p><p>接下来：{item.nextStep}</p><small>{displayTime(item.createdAt)} · 当前文件保留</small></div></article>) : <p>还没有发生主动纠偏。这不代表代码快照不可用。</p>}
      <details><summary>助手目前能回到哪里？（{value.contextCheckpoints?.length || 0} 个位置）</summary><p className="enigma-source-note">仅保留当前对话、最近一次上下文压缩之后仍有效的位置。过早或已放弃的位置不会用于主动纠偏。</p>{value.contextCheckpoints?.map((point:any) => <p key={point.id}>{checkpointLabel(point.label)} · {displayTime(point.createdAt)}</p>)}</details>
    </section>
    {!pending.length&&interrupted}
  </div>;
}

function interruptedChanges(operation:any){
  const before=operation.beforeWorkspace||[operation.before].filter(Boolean),after=operation.afterWorkspace||[operation.after].filter(Boolean);
  if(!after.length)return null;
  return after.map((snapshot:any)=>{
    const original=before.find((item:any)=>item.repo.id===snapshot.repo.id),previous=original?.files||{},current=snapshot.files||{};
    return {repo:snapshot.repo.id,gitChanged:original&&(original.head!==snapshot.head||original.branch!==snapshot.branch),files:[...new Set([...Object.keys(previous),...Object.keys(current)])].filter(file=>JSON.stringify(previous[file])!==JSON.stringify(current[file])).map(file=>({file,change:!previous[file]?'新增':!current[file]?'删除':'修改',exists:!!current[file]}))};
  });
}
export function InterruptedOperations({operations,details}:{operations:any[];details:ReactNode}){
  const snapshot=useEngineering(s=>s.snapshot),readOnly=useStore(s=>s.sessionPermissionMode==='read_only'),pending=operations.filter(op=>['pending','unknown'].includes(op.status));
  const busy=readOnly||snapshot?.state?.idle===false||snapshot?.state?.operation?.state==='running',recover=snapshot?.actions?.find((action:Action)=>action.id==='recover'),canAcknowledge=snapshot?.actions?.some((action:Action)=>action.id==='acknowledge');
  return <details className="enigma-result" open={pending.length>0||undefined}><summary>中断与未知操作{pending.length?`（${pending.length} 项待核对）`:''}</summary>
    <p className="enigma-source-note">先确认原进程已停止并读取文件变化，再逐项记录观察到的实际效果。这里不会重放命令，也不会恢复代码。</p>
    <button disabled={busy||!recover} data-tooltip="核对已停止的运行，读取中断后的文件状态；仍在运行时会拒绝处理" onClick={()=>void showAction(recover)}>核对中断运行</button>
    {!pending.length&&<p>当前没有等待确认的工程操作。历史记录保留在下方。</p>}
    {pending.map(operation=>{
      const changes=interruptedChanges(operation),label=`${operation.repo||'工作区'} · ${operation.operation==='command'?'命令执行':operation.operation||'工程操作'} · ${displayTime(operation.createdAt)}`;
      return <article className="enigma-recipe-card" key={operation.id}><strong>{label}</strong><p>{changes?'已读取中断后的文件状态，实际效果尚未确认。':'尚未读取中断后的文件状态，请先点击“核对中断运行”。'}</p>
        {changes&&<details><summary>已记录的文件变化 · {changes.reduce((sum:number,item:any)=>sum+item.files.length,0)} 个文件</summary><p className="enigma-source-note">这里只列可管理文件在操作前后的差异。外部服务等影响仍需自行核对；打开文件会读取当前内容。</p>{changes.map((repo:any)=><div key={repo.repo}>{repo.gitChanged&&<p>仓库 {repo.repo} 的 Git 分支或提交发生变化，需要核对。</p>}{repo.files.map((file:any)=><p key={file.file}>{file.change} · {repo.repo} / {file.file} {file.exists&&<button onClick={()=>openEngineering({id:`file:${repo.repo}:${file.file}`,title:file.file,group:'reading',repo:repo.repo,file:file.file})}>查看当前文件</button>}</p>)}</div>)}</details>}
        <button disabled={busy||!canAcknowledge||!changes} data-tooltip={!changes?'先核对中断运行，读取实际文件状态':'只确认这条操作的实际效果，原操作与文件继续保留；仍需重跑原检查'} onClick={()=>void showRecordAction('acknowledge',{id:operation.id},{id:label})}>记录这一项的核对结果</button>
      </article>;
    })}
    <details className="enigma-result"><summary>完整运行记录与会话树</summary>{details}</details>
  </details>;
}

export function RestorePreview({ value, details }: { value: any; details: ReactNode }) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
    root.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
  }, [value.target, value.expected]);
  const state = useEngineering();
  const readOnly = useStore(s => s.sessionPermissionMode === 'read_only');
  const points: any[] = state.data?.checkpoints || [];
  const target = points.find(point => point.id === value.target), expected = points.find(point => point.id === value.expected);
  const restore = state.snapshot?.actions?.find((a:Action) => a.id === 'restore');
  const fork = state.snapshot?.actions?.find((a:Action) => a.id === 'code-fork');
  const busy = state.snapshot?.state?.idle === false || state.snapshot?.state?.operation?.state === 'running';
  const same = value.target === value.expected;
  return <section ref={root} tabIndex={-1} className="enigma-restore-preview" aria-label="代码恢复预览">
    <button className="enigma-dismiss-preview" aria-label="关闭恢复预览" data-tooltip="收起结果，回到快照列表；不会修改文件" onClick={() => { useEngineering.setState(current => { const results={...current.results}; delete results[current.active]; return {results}; }); }}>×</button>
    <h3>{value.applyAllowed ? value.changes.length ? '可以恢复，请先核对文件差异' : '代码内容没有差异' : '暂不能恢复：发现冲突'}</h3>
    <p>目标：{target ? checkpointChoice(target) : value.target}</p><p>核对基准：{expected ? checkpointChoice(expected) : value.expected}</p>
    <p className="enigma-source-note">这次预览没有修改代码。{same ? '目标与基准是同一份快照。' : ''}预览后文件仍可能变化，确认恢复时会再次核对。</p>
    {value.conflicts.map((conflict:string) => <p className="enigma-error" key={conflict}>{explainConflict(conflict)}</p>)}
    {value.changes.length > 0 && <><p>涉及 {new Set(value.changes.map((c:any) => c.repo)).size} 个仓库、{value.changes.length} 个文件：</p>{value.changes.map((change:any) => <details className="enigma-restore-file" key={`${change.repo}:${change.file}`}><summary>{change.repo} / {change.file} · {({added:'新增',deleted:'删除',modified:'修改'} as Record<string,string>)[change.change] || change.change}</summary>{change.patch && <pre>{change.patch}</pre>}</details>)}</>}
    <div className="enigma-inline-actions">
      <button className="enigma-primary" disabled={readOnly || busy || !value.applyAllowed || !value.changes.length || !restore} data-tooltip={readOnly ? '当前对话只读，可以查看差异；恢复需要可写权限' : !value.applyAllowed ? '先核对冲突，不能覆盖当前文件' : !value.changes.length ? '没有代码差异，无需恢复' : '进入最终确认；执行前仍会核对当前文件'} onClick={() => void showAction(timeAction(restore, { target: value.target, expected: value.expected, context: false }))}>继续确认恢复</button>
      {!value.applyAllowed && fork && <button disabled={readOnly || busy} onClick={() => void showAction(timeAction(fork,{checkpoint:value.target}))}>改为另开代码方案</button>}
    </div><details className="enigma-result"><summary>完整恢复证据</summary>{details}</details>
  </section>;
}
