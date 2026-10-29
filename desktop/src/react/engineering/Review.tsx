import {useEffect,useRef,useState,type ReactNode} from 'react';
import {useStore} from '../stores';
import {engineeringRequest,openEngineering,openGroup,showAction,useEngineering} from './state';
import {useSideQuery} from './useSideQuery';
import {displayTime} from './interaction-copy';
import {MarkdownContent} from '../components/chat/MarkdownContent';
import {renderMarkdown} from '../utils/markdown';

const statuses:Record<string,string>={completed:'审查已完成',failed:'审查未完成',cancelled:'审查已取消',stale:'原审查已过期'};
export function ReviewPanel({initial,evidence}:{initial:any;evidence:(value:any)=>ReactNode}){
  const sessionPath=useEngineering(s=>s.sessionPath),snapshot=useEngineering(s=>s.snapshot),query=useSideQuery<any>('/data/review',sessionPath);
  const readOnly=useStore(s=>s.sessionPermissionMode==='read_only'),data=query.data||initial,items=Array.isArray(data)?data:data?.items||[];
  const action=snapshot?.actions?.find((item:any)=>item.id==='review-run'),busy=snapshot?.state?.idle===false||snapshot?.state?.operation?.state==='running';
  return <section className="enigma-review">
    <h3>独立审查意见</h3><p className="enigma-feature-intro">选择代码快照作为比较起点，让独立上下文检查改动。报告是建议，测试是否通过、原要求是否完成仍需分别核对。</p>
    {action&&<button disabled={readOnly||busy} data-tooltip={readOnly?'当前对话只读，不能创建审查记录':busy?'等待当前操作结束':'选择基线、目标与需要参考的原要求，创建新审查'} onClick={()=>void showAction(action)}>发起独立审查</button>}
    <p className="enigma-source-note">每 5 秒核对报告所依据的代码和环境。{query.receivedAt>0&&` 最近读取：${displayTime(query.receivedAt)}`}</p>
    {query.error&&<p className="enigma-error" role="status">报告状态未更新，以下为最近记录。<button onClick={()=>void query.refresh()}>重新读取审查</button></p>}
    {data.truncated&&<p className="enigma-source-note">显示最近 50 份可见报告；更早记录保留在项目中。</p>}
    {!!data.unavailable?.length&&<p className="enigma-error">{data.unavailable.length} 份审查记录暂不可读取，其他报告仍可查看。</p>}
    {!items.length&&<p className="enigma-empty-feature">还没有当前任务的审查报告。提交较大改动前，或对实现存在疑问时，可以发起一次独立审查。</p>}
    {items.map((report:any,index:number)=><details key={report.id} className="enigma-review-report" open={index===0||undefined}><summary><strong>{report.goal||'历史审查报告'}</strong><small>{statuses[report.status]||'状态待核对'} · {displayTime(report.createdAt)}</small></summary><ReviewReport report={report} staleQuery={!!query.error||!query.receivedAt} evidence={evidence}/></details>)}
  </section>;
}
function ReviewReport({report,staleQuery,evidence}:{report:any;staleQuery:boolean;evidence:(value:any)=>ReactNode}){
  const [source,setSource]=useState<{repo:string;file:string;side:'target'|'baseline'}|null>(null);
  return <div>
    <div className="enigma-chips"><span>{report.scope==='legacy-workspace'?'项目历史 · 未记录所属对话':'当前任务'}</span><span>{report.model||'模型未记录'}</span>{Number.isSafeInteger(report.requests)&&<span>{report.requests} 次模型请求</span>}</div>
    <p className="enigma-source-note">{staleQuery?'无法确认报告是否仍适用。':report.sourceCurrent===false?'源码已变化，请重新审查当前改动。':report.environmentCurrent===false?'检查配置或执行环境已变化，使用结论前需重新核对。':'源码与报告版本一致。'}{report.recordedStatus==='stale'?' 生成报告期间来源就发生过变化。':''}</p>
    {!!report.evidence?.some((item:any)=>!item.current)&&<p className="enigma-error">部分参考检查依据已失效或无法读取。</p>}
    {['failed','cancelled'].includes(report.status)&&<p>这次审查没有形成完整结论，下面可能只有部分内容或失败原因。</p>}
    {report.coverage&&<p className="enigma-source-note">冻结了 {report.coverage.files} 个改动文件。{report.coverage.additionalFiles>0?`其中前 ${report.coverage.inlineDiffFiles} 个差异直接提供给模型，其余 ${report.coverage.additionalFiles} 个需要按需读取；不能据此声称全部已审查。`:'结论覆盖范围以报告正文为准。'}</p>}
    {Number.isSafeInteger(report.coverage?.providedDiffFiles)&&<p className="enigma-source-note">本次向模型提供了 {report.coverage.providedDiffFiles} / {report.coverage.files} 个文件的差异片段。读取过片段不代表已完整审查。</p>}
    <div className="enigma-review-text"><MarkdownContent html={renderMarkdown(report.text||'没有返回可读的审查结论。')}/></div>
    {!!report.changes?.length&&<details className="enigma-result"><summary>核对本次冻结的差异 · {report.changes.length} 个文件</summary>{report.changes.map((change:any)=><details key={`${change.repo}:${change.file}`} className="enigma-restore-file"><summary>{change.repo} / {change.file} · {({added:'新增',deleted:'删除',modified:'修改'} as Record<string,string>)[change.change]||change.change}</summary>{change.patch&&<pre>{change.patch}</pre>}<div className="enigma-inline-actions"><button data-tooltip="读取审查时保存的源码，不会切换或恢复项目文件" onClick={()=>setSource({repo:change.repo,file:change.file,side:change.change==='deleted'?'baseline':'target'})}>{change.change==='deleted'?'查看删除前源码':'查看审查时源码'}</button>{change.change!=='deleted'&&<button data-tooltip="打开仓库当前文件；可能与本报告引用的版本不同" onClick={()=>openEngineering({id:`file:${change.repo}:${change.file}`,title:change.file,group:'reading',repo:change.repo,file:change.file})}>查看当前文件</button>}</div></details>)}</details>}
    {source&&<FrozenReviewSource key={`${report.id}:${source.repo}:${source.file}:${source.side}`} review={report.id} source={source} close={()=>setSource(null)}/>}
    <details className="enigma-result"><summary>审查范围、来源与完整记录</summary>{evidence(report)}</details>
  </div>;
}
function FrozenReviewSource({review,source,close}:{review:string;source:{repo:string;file:string;side:'target'|'baseline'};close:()=>void}){
  const sessionPath=useEngineering(s=>s.sessionPath),connection=useEngineering(s=>s.connectionId),[start,setStart]=useState(1),[count,setCount]=useState(180),[draftStart,setDraftStart]=useState('1'),[draftCount,setDraftCount]=useState('180'),[data,setData]=useState<any>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),root=useRef<HTMLElement>(null);
  useEffect(()=>{root.current?.focus({preventScroll:true});root.current?.scrollIntoView?.({block:'nearest'});},[]);
  useEffect(()=>{const abort=new AbortController();setData(null);setError('');const params=new URLSearchParams({...source,review,start:String(start),end:String(start+count-1)});void engineeringRequest('/review/source?'+params,sessionPath,undefined,abort.signal).then(value=>{if(!abort.signal.aborted)setData(value);}).catch(error=>{if(!abort.signal.aborted)setError(String(error));});return()=>abort.abort();},[review,source.repo,source.file,source.side,start,count,sessionPath,connection,retry]);
  const page=(next:number)=>{setStart(next);setDraftStart(String(next));};
  return <section ref={root} tabIndex={-1} className="enigma-review-source" aria-label="冻结源码预览"><div className="enigma-section-heading"><h3>{source.repo} / {source.file}</h3><button onClick={close} aria-label="关闭冻结源码">×</button></div><p className="enigma-source-note">{source.side==='baseline'?'删除前保存的版本':'审查时保存的版本'}，不会修改当前文件。</p>
    <form className="enigma-inline-actions" onSubmit={event=>{event.preventDefault();const next=Number(draftStart),size=Number(draftCount);if(!Number.isInteger(next)||next<1||!Number.isInteger(size)||size<1||size>301){setError('起始行必须为正整数，每次读取 1–301 行。');return;}setStart(next);setCount(size);setRetry(n=>n+1);}}><label>起始行<input aria-label="冻结源码起始行" type="number" min={1} required value={draftStart} onChange={event=>setDraftStart(event.target.value)}/></label><label>读取行数<input aria-label="冻结源码读取行数" type="number" min={1} max={301} required value={draftCount} onChange={event=>setDraftCount(event.target.value)}/></label><button>查看行范围</button></form>
    {error?<p className="enigma-error" role="alert">读取未完成：{error}<button onClick={()=>setRetry(n=>n+1)}>重试</button></p>:!data?<p role="status">正在读取冻结源码…</p>:<><p>第 {data.line}–{data.endLine} 行，共 {data.totalLines} 行</p><pre>{data.content}</pre>{data.truncated&&<p>本段较长，已截取前 24,000 字符。可缩小读取行数；单行超过上限时只显示部分内容。</p>}<div className="enigma-inline-actions"><button disabled={start===1} onClick={()=>page(Math.max(1,start-count))}>前 {count} 行</button><button disabled={start+count>data.totalLines} onClick={()=>page(start+count)}>后 {count} 行</button></div></>}</section>;
}
