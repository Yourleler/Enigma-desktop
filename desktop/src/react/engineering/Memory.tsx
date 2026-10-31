import { useState, useEffect } from "react";
import { engineeringRequest, useEngineering,showAction, showRecordAction, readRecordAction, type Action } from "./state";
import {useSideQuery} from './useSideQuery';
import {useSideAction} from './useSideAction';
import {useStore} from '../stores';
import {displayTime} from './interaction-copy';
const labels: Record<string, string> = {
  queued: "等待整理",
  running: "模型整理中",
  paused: "已暂停",
  cancelled: "已取消",
  ready: "候选待确认",
  publishing: "保存中",
  published: "已保存候选",
  stale: "来源已过期",
  failed: "整理失败",
};
export function MemoryPanel({ value:initial,searchText='' }: { value: any;searchText?:string }) {
  const sessionPath = useEngineering((state) => state.sessionPath),
    [selected, setSelected] = useState<string[]>([]);
  const [offset,setOffset]=useState(0),snapshot=useEngineering(s=>s.snapshot);
  const catalog=useSideQuery<any>(`/data/memory?query=${encodeURIComponent(searchText)}&offset=${offset}`,sessionPath);
  const value=catalog.data||initial;
  const connection=useEngineering(s=>s.connectionId),readOnly=useStore(s=>s.sessionPermissionMode==='read_only');
  const actionState=useSideAction(sessionPath),busy=!!actionState.busy,mainBusy=snapshot?.state?.idle===false||snapshot?.state?.operation?.state==='running';
  const save=snapshot?.actions?.find((action:Action)=>action.id==='memory-save'),draft=snapshot?.actions?.find((action:Action)=>action.id==='knowledge-draft'),organize=snapshot?.actions?.find((action:Action)=>action.id==='memory-organize');
  const [feedback,setFeedback]=useState('');
  const query=useSideQuery<any[]>('/memory-dream',sessionPath,value.enabled),runs=query.data||[],refresh=query.refresh;
  useEffect(()=>{setSelected([]);setFeedback('');},[sessionPath,connection,value.enabled]);
  useEffect(()=>{setOffset(0);setSelected([]);},[searchText]);
  useEffect(()=>{setSelected(current=>current.filter(id=>value.search?.items?.some((item:any)=>item.id===id&&item.freshness==='current')));},[value.search]);
  const perform = (action: string, id?: string) => actionState.run(action,()=>action==='start' ? engineeringRequest("/memory-dream", sessionPath, {
          sources: selected,
          maxRequests: 2,
        }) : engineeringRequest("/memory-dream/control", sessionPath, {
          id,
          action,
        }),()=>{if(action==='start')setSelected([]);return refresh();});
  return (
    <>
      <h3>工程记忆</h3>
      <p>
        {value.enabled
          ? "按关键词查找，选择有用的当前记忆做增量整理。整理在旁路运行，不占用主对话；候选确认后才进入召回。"
          : "当前对话未启用助手的工程记忆，仍可查阅和手动管理已有记录。"}
      </p>
      <p className="enigma-source-note">这里只展示当前可见范围内的记忆；项目记忆与仅此任务的记忆分别标注。全文和来源会在使用时重新核对。</p>
      <div className="enigma-inline-actions"><button disabled={readOnly||mainBusy} onClick={()=>useEngineering.setState({connectOpen:true})}>工程记忆设置</button>{save&&<button disabled={readOnly||mainBusy} onClick={()=>void showAction(save)}>记录一条记忆</button>}{draft&&<button disabled={readOnly||mainBusy} onClick={()=>void showAction(draft)}>从来源记录经验</button>}</div>
      {catalog.error&&<p className="enigma-error">记忆列表暂未更新，以下保留上次结果。<button onClick={()=>void catalog.refresh()}>重新读取记忆</button></p>}
      {!!value.search?.unavailable&&<p className="enigma-source-note">{value.search.unavailable} 份记录暂不可读取，其余结果仍可查看。</p>}
      {!value.search?.items?.length&&<p className="enigma-source-note">{value.search?.query?'没有找到匹配的可见记忆，试试其他关键词。':'当前没有可见记忆。可以保存经验，或从资料和代码中记录有依据的草稿。'}</p>}
      {(value.search?.items || []).map((item: any) => (
        <article className="enigma-repo" key={item.id}>
          <input
            type="checkbox"
            aria-label={`选择记忆 ${item.title}`}
            disabled={!value.enabled||item.freshness !== "current"||selected.length>=12&&!selected.includes(item.id)}
            data-tooltip={!value.enabled?'当前任务未启用模型记忆整理':item.freshness !== 'current' ? '来源已变化，需重新核对后才能用于整理' : selected.length>=12&&!selected.includes(item.id)?'本次最多选择12条来源，请先取消其他选择':`将「${item.title}」加入本次整理来源`}
            checked={selected.includes(item.id)}
            onChange={(event) =>
              setSelected(
                event.target.checked
                  ? [...selected, item.id].slice(0,12)
                  : selected.filter((id) => id !== item.id),
              )
            }
          />
          <div>
            <strong>{item.title}</strong>
            <p>{item.summary}</p>
            <small>{item.appliesWhen}</small>
            <div className="enigma-inline-actions"><button disabled={busy||mainBusy} onClick={()=>void actionState.run('read',()=>readRecordAction('memory-read',{id:item.id}))}>阅读全文</button><button disabled={readOnly||mainBusy} data-tooltip="停止召回这条记忆，保留原记录" onClick={()=>void showRecordAction('memory-forget',{id:item.id},{id:item.title})}>忘记这条</button></div>
            <div className="enigma-chips">
              <span>
                {item.freshness === "current" ? "来源当前有效" : item.freshness==='unavailable'?'正文暂不可读':"来源已变化"}
              </span>
              <span>{item.scope?.type==='task'?'仅此任务':item.scope?.repos?.join("、") || "项目记忆"}</span>
              <span>{item.status==='user-stated'?'用户记录':'助手候选，使用前核对'}</span>
            </div>
            <details className="enigma-memory-feedback"><summary>这条记忆是否有帮助？</summary><div className="enigma-inline-actions">{[['helpful','有帮助'],['irrelevant','不适用'],['wrong','有误']].map(([verdict,label])=><button key={verdict} disabled={readOnly||busy||item.freshness!=='current'} onClick={()=>void actionState.run(`feedback:${item.id}`,()=>engineeringRequest('/memory-feedback',sessionPath,{id:item.id,verdict}),()=>setFeedback(`已记录「${item.title}」的反馈`))}>{label}</button>)}</div></details>
          </div>
        </article>
      ))}
      {value.search?.total>0&&<div className="enigma-inline-actions" aria-label="记忆分页"><span>显示 {offset+1}–{Math.min(offset+20,value.search.total)} / {value.search.total} 条{searchText?'匹配':'可见'}记忆</span><button disabled={offset===0||catalog.loading} onClick={()=>{setSelected([]);setOffset(Math.max(0,offset-20));}}>上一页</button><button disabled={!value.search.more||catalog.loading} onClick={()=>{setSelected([]);setOffset(offset+20);}}>下一页</button></div>}
      <p className="enigma-source-note">每次最多选择12条当前来源。切换搜索或分页会清空选择。</p>
      <button
        disabled={readOnly || busy || !selected.length || !value.enabled||!!catalog.error}
        data-tooltip={!value.enabled ? '当前项目尚未启用工程记忆' : busy ? '正在处理记忆整理请求' : !selected.length ? '请先选择至少一条来源有效的记忆' : '在旁路整理所选来源；候选确认后才进入召回'}
        onClick={() => void perform("start")}
      >
        整理所选记忆（{selected.length}）
      </button>
      {!!value.drafts?.items?.length&&<details className="enigma-result"><summary>经验草稿 · {value.drafts.total} 份</summary><p>这是不调用模型的来源核对：把已经写好的草稿保存为候选记忆。上方“整理所选记忆”会另外调用模型生成摘要。</p>{value.drafts.more&&<p>显示最近50份，较早记录仍保留。</p>}{value.drafts.items.map((item:any)=><article className="enigma-recipe-card" key={item.id}><strong>{item.input.title}</strong><p>{({queued:'等待来源核对',processing:'正在保存',saved:'已保存为候选',stale:'来源或保存条件需要重新核对',unknown:'中断时结果不明，不会自动重放'} as any)[item.state]||item.state} · {item.input.scope.type==='task'?'仅此任务':item.input.scope.repos?.join('、')||'项目'}</p><p>{item.input.content}</p>{item.reason&&<p className="enigma-source-note">{memoryProblem(item.reason)}</p>}{item.state==='queued'&&organize&&<button disabled={readOnly||busy||mainBusy} onClick={()=>void showRecordAction('memory-organize',{drafts:[item.id]})}>核对并保存这份草稿</button>}{item.memory&&<button disabled={busy||mainBusy} onClick={()=>void actionState.run('read',()=>readRecordAction('memory-read',{id:item.memory}))}>阅读已保存的候选</button>}</article>)}</details>}
      {runs.map((run) => (
        <article className="enigma-welcome-card" key={run.id}>
          <strong>{run.waitingReason==='foreground'?'等待主任务空闲':run.waitingReason==='memory-queue'?'等待前一项整理':run.runtimeState==='interrupted'?'整理进程已中断':run.runtimeState==='unknown'?'整理状态待核对':labels[run.status] || run.status}</strong>
          {run.updatedAt&&<small className="enigma-source-note"> · {displayTime(run.updatedAt)}</small>}
          <p>
            {run.sources.length} 条来源 · 已用 {run.requests}/{run.maxRequests}{" "}
            次模型请求
          </p>
          {run.waitingReason&&<p className="enigma-source-note">排队期间不调用模型、不增加已用请求次数。已发出的请求会完成，后续请求让主任务优先。</p>}
          {run.candidates?.map((candidate: any, index: number) => (
            <p key={index}>
              <strong>{candidate.title}</strong>：{candidate.content}
              <br />
              <small>适用条件：{candidate.appliesWhen}</small>
            </p>
          ))}
          {run.relations?.map((relation: any, index: number) => (
            <p key={index}>
              {relation.kind === "contradicts" ? "存在矛盾" : "相关来源"}：
              {relation.reason}
            </p>
          ))}
          {run.runtimeState==='interrupted'&&<><p>原进程已退出。先核对记录，保留已用请求次数；不会自动重新调用模型。</p><button disabled={busy} onClick={()=>void perform('recover',run.id)}>核对中断的整理</button></>}
          {run.runtimeState==='unknown'&&<p>无法确认原进程是否已停止，请先核对运行记录，暂不重新发起整理。</p>}
          {run.status === "running" && (!run.runtimeState||run.runtimeState==='active') && (
            <button
              disabled={busy}
              onClick={() => void perform("pause", run.id)}
            >
              暂停
            </button>
          )}
          {run.status === "paused" && (
            <button
              disabled={readOnly || busy || run.requests>=run.maxRequests}
              data-tooltip={run.requests>=run.maxRequests?'已用完该次整理的模型请求额度；可选择来源发起新的整理':'重新核对来源后继续，已用请求次数保留'}
              onClick={() => void perform("resume", run.id)}
            >
              继续整理
            </button>
          )}
          {run.status==='paused'&&run.requests>=run.maxRequests&&<p className="enigma-source-note">本次请求额度已用完。需要再试时，可重新选择来源发起新的整理。</p>}
          {run.memories?.length>0&&<div className="enigma-inline-actions">{run.memories.map((id:string,index:number)=><button key={id} disabled={busy} onClick={()=>void actionState.run('read',()=>readRecordAction('memory-read',{id}))}>查看保存的记忆{run.memories.length>1?` ${index+1}`:''}</button>)}</div>}
          {run.status === "ready" && (
            <button
              disabled={readOnly || busy}
              onClick={() => void perform("publish", run.id)}
            >
              保存为有来源的候选记忆
            </button>
          )}
          {["queued", "running", "paused", "ready"].includes(run.status) && (
            <button
              disabled={busy}
              onClick={() => void perform("cancel", run.id)}
            >
              取消
            </button>
          )}
          {run.error && <p className="enigma-error">{run.error}</p>}
        </article>
      ))}
      {readOnly&&<p className="enigma-source-note">当前对话只读，可以查阅记忆；整理、反馈和停止召回需要可写权限。</p>}
      {actionState.error && <p className="enigma-error" role="alert">{actionState.error}</p>}
      {feedback&&<p role="status" className="enigma-source-note">{feedback}</p>}
      {query.error&&<p className="enigma-error">{query.error}</p>}
    </>
  );
}

export function memoryProblem(text:string){return text.replace('Source changed since draft creation','草稿创建后源码发生变化，请重新阅读后记录').replace('Memory project material is stale or changed','引用资料已过期或发生变化').replace('Memory evidence is stale or unavailable','验收证据已过期或不可读取').replace('Source changed:','源码已变化：').replace('Source unavailable:','源码暂不可读：').replace('Evidence stale:','验收证据已过期：').replace('Evidence unavailable:','验收证据暂不可读：').replace('Project material changed:','引用资料已变化：').replace('Project material removed or unavailable:','引用资料已移除或不可读：').replace('Memory body is unavailable','记忆正文暂不可读取').replace('User-edited body differs from recorded version; treat it as an unverified note until re-saved','正文与记录版本不同，更正保存前请重新核对').replace('Writer stopped while promoting; inspect current notes and do not replay this draft.','保存期间进程中断，请检查是否已经生成记忆，不要直接重放草稿。');}
