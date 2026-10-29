import type {ReactNode} from 'react';
import {useStore} from '../stores';
import {MarkdownContent} from '../components/chat/MarkdownContent';
import {renderMarkdown} from '../utils/markdown';
import {readRecordAction,showAction,openEngineering,useEngineering,type Action} from './state';
import {useSideAction} from './useSideAction';
import {memoryProblem} from './Memory';
import {displayTime} from './interaction-copy';

export function memoryCorrectionAction(action:Action,value:any):Action{
 const record=value.record,values:Record<string,unknown>={title:record.title,content:value.content,kind:record.kind,scope:record.scope.type,repos:record.scope.repos||[],sources:record.anchors.map((source:any)=>({repo:source.repo,file:source.file})),replaces:record.id,appliesWhen:record.appliesWhen};
 return {...action,title:'保存更正后的记忆',description:'保存新条目并停止召回旧条目。来源会重新核对；不会撤回项目文件或改写历史记录。',fields:action.fields.map(field=>({...field,value:values[field.name],...(field.name==='replaces'?{kind:'record',source:undefined,displayValue:record.title}:{})}))};
}
export function MemoryReadResult({value,details}:{value:any;details:ReactNode}){
 const record=value.record,snapshot=useEngineering(s=>s.snapshot),readOnly=useStore(s=>s.sessionPermissionMode==='read_only');
 const save=snapshot?.actions?.find((action:Action)=>action.id==='memory-save'),busy=snapshot?.state?.idle===false||snapshot?.state?.operation?.state==='running';
 return <section className="enigma-memory-document"><h3>{record.title}</h3><div className="enigma-chips"><span>{value.freshness==='current'?'来源当前有效':value.freshness==='unavailable'?'正文暂不可读取':'来源需要重新核对'}</span><span>{record.scope.type==='task'?'仅此任务':record.scope.repos?.join('、')||'项目记忆'}</span><span>{record.status==='user-stated'?'用户记录':'助手候选'}</span></div>
 <p className="enigma-source-note">{record.appliesWhen?`适用条件：${record.appliesWhen}`:'未指定适用条件，使用前请结合当前任务核对。'} · {displayTime(record.updatedAt)}</p>
 {(value.problems||[]).map((problem:string)=><p className="enigma-error" key={problem}>{memoryProblem(problem)}</p>)}
 {value.content&&<MarkdownContent html={renderMarkdown(value.content)}/>}
 {!!record.anchors.length&&<div className="enigma-inline-actions"><span>源码依据：</span>{record.anchors.map((anchor:any)=><button key={`${anchor.repo}:${anchor.file}`} data-tooltip="打开当前文件；记忆本身仍对应保存时的源码版本" onClick={()=>openEngineering({id:`file:${anchor.repo}:${anchor.file}`,title:anchor.file,group:'reading',repo:anchor.repo,file:anchor.file})}>{anchor.repo} / {anchor.file}</button>)}</div>}
 <p className="enigma-source-note">记忆是有来源的背景，不代替当前用户要求或实际验收。</p>
 {save&&value.content&&<button disabled={readOnly||busy} onClick={()=>void showAction(memoryCorrectionAction(save,value))}>更正这条记忆</button>}
 <details className="enigma-result"><summary>来源与历史记录</summary>{details}</details></section>;
}
export function MemorySavedResult({value,details}:{value:any;details:ReactNode}){
 const sessionPath=useEngineering(s=>s.sessionPath),control=useSideAction(sessionPath);
 return <section className="enigma-result"><h3>{value.replaces?'记忆已更正':'记忆已保存'}</h3><p>{value.title} · {value.status==='user-stated'?'用户记录':'待核对的候选'}</p>{value.replaces&&<p>旧条目已停止召回，历史记录保留。</p>}<button disabled={!!control.busy} onClick={()=>void control.run('read',()=>readRecordAction('memory-read',{id:value.id}))}>阅读这条记忆</button>{control.error&&<p role="alert">{control.error}</p>}<details><summary>完整记录</summary>{details}</details></section>;
}
export function MemoryOrganizedResult({value,details}:{value:any;details:ReactNode}){
 const sessionPath=useEngineering(s=>s.sessionPath),control=useSideAction(sessionPath);
 return <section className="enigma-result"><h3>经验草稿核对结果</h3><p>这次没有调用模型；仅核对来源并保存已有草稿。</p>{!value.outcomes.length&&<p>当前没有可处理的所选草稿，已保存或中断的记录不会自动重放。</p>}{value.outcomes.map((item:any)=><article className="enigma-step" key={item.draft}><div><strong>{item.status==='saved'?'已保存为候选记忆':'未保存，需要重新核对'}</strong>{item.reason&&<p>{memoryProblem(item.reason)}</p>}{item.memory&&<button disabled={!!control.busy} onClick={()=>void control.run('read',()=>readRecordAction('memory-read',{id:item.memory}))}>阅读全文</button>}</div></article>)}{control.error&&<p role="alert">{control.error}</p>}<details><summary>草稿、索引与完整证据</summary>{details}</details></section>;
}
export function MemorySearchResult({value}:{value:any}){
 const sessionPath=useEngineering(s=>s.sessionPath),control=useSideAction(sessionPath);
 return <section className="enigma-result"><h3>记忆搜索：{value.query}</h3><p>找到 {value.total??value.items.length} 条可见匹配，当前展示 {value.items.length} 条。{value.more?'更多结果可在上方查询并分页查看。':''}</p>{value.items.map((item:any)=><article className="enigma-recipe-card" key={item.id}><strong>{item.title}</strong><p>{item.summary}</p><p className="enigma-source-note">{item.freshness==='current'?'来源当前有效':'来源需重新核对'} · {item.scope.type==='task'?'仅此任务':item.scope.repos?.join('、')||'项目'}</p><button disabled={!!control.busy} onClick={()=>void control.run('read',()=>readRecordAction('memory-read',{id:item.id}))}>阅读这条记忆</button></article>)}{control.error&&<p role="alert">{control.error}</p>}</section>;
}
