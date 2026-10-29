import {useState,type ReactNode} from 'react';
import {openEngineering,readRecordAction,useEngineering} from './state';
import {useSideAction} from './useSideAction';
import {displayTime} from './interaction-copy';

const openSource=(source:any)=>openEngineering({id:`file:${source.repo}:${source.file}`,title:source.file,group:'reading',repo:source.repo,file:source.file});
const label=(source:any)=>`${source.repo} / ${source.file}:${source.line} · ${source.symbol}`;
const role=(kind:string)=>kind==='outgoing-call'?'向下调用':kind==='call-site'?'调用位置':kind==='import-binding'?'导入引用':kind==='source-reference'?'引用位置':'定义与源码';

export function CodeTraceResult({value,details,published=false}:{value:any;details:ReactNode;published?:boolean}){
 const sessionPath=useEngineering(s=>s.sessionPath),control=useSideAction(sessionPath),[limit,setLimit]=useState(24),[filter,setFilter]=useState('');
 const nodes=value.map?.nodes||[...(value.symbols||[]),...(value.references||[])].map((source:any,index:number)=>({id:String(index),source}));
 const shown=nodes.filter((node:any)=>`${label(node.source)} ${role(node.source.kind)}`.toLowerCase().includes(filter.toLowerCase()));
 return <section className="enigma-source-reading" data-testid="code-trace-result"><h3>「{value.query}」的源码关系</h3><div className="enigma-chips"><span>{value.symbols.length} 个定义</span><span>{value.references.length} 个引用</span><span>扫描 {value.scannedFiles||0} 个文件</span></div>
 <p className="enigma-source-note">显示本次保存的源码片段和静态关系。它们不是运行结果；打开文件时读取当前版本。</p>
 {!published&&value.map?.nodes&&<button disabled={!!control.busy} onClick={()=>void control.run('open',()=>readRecordAction('reading-open',{query:value.query,repo:value.queryRepo}))}>核对已保存的阅读版本</button>}
 {nodes.length>8&&<input className="enigma-timeline-search" aria-label="筛选源码关系" placeholder="按仓库、路径或符号筛选" value={filter} onChange={event=>{setFilter(event.target.value);setLimit(24);}}/>}
 <p className="enigma-source-note">显示 {Math.min(limit,shown.length)} / {shown.length} 个匹配节点</p>
 {shown.slice(0,limit).map((node:any)=><article className="enigma-trace-entry" key={node.id}><strong>{role(node.source.kind)}</strong><button onClick={()=>openSource(node.source)}>{node.source.repo} / {node.source.file}:{node.source.line}</button><p>{node.source.owner?`${node.source.owner} → `:''}{node.source.symbol}</p>{node.source.snippet&&<pre>{node.source.snippet}</pre>}{node.source.truncated&&<p className="enigma-source-note">保存的片段有截断，不能视为完整源码。</p>}
 {node.source.confidence&&<small>{node.source.confidence==='confirmed'?'静态绑定已确认':'候选关系，需核对源码'}</small>}
 {value.map?.nodes&&<button disabled={!!control.busy} data-tooltip="比较这个保存的源码节点与当前文件，不修改代码" onClick={()=>void control.run(node.id,()=>readRecordAction('reading-open',{query:value.query,repo:value.queryRepo,node:node.id}))}>核对节点当前代码</button>}
 </article>)}
 {shown.length>limit&&<button onClick={()=>setLimit(count=>count+24)}>继续显示源码节点</button>}{!shown.length&&<p>没有匹配的源码关系，可以换个符号或缩小范围。</p>}
 {value.truncated&&<p className="enigma-source-note">还有内容超出本次解析或输出范围。可缩小查询或增加文件预算后重新追踪。</p>}
 {!!value.diagnostics?.length&&<details><summary>解析限制与诊断 · {value.diagnostics.length} 项</summary>{value.diagnostics.map((text:string,index:number)=><p key={index}>{text.replace('Call target not resolved statically:','无法静态确定调用目标：')}</p>)}</details>}
 {control.error&&<p className="enigma-error" role="alert">{control.error}</p>}<details className="enigma-result"><summary>完整证据与诊断</summary>{details}</details></section>;
}
export function PublishedReadingResult({value,details}:{value:any;details:ReactNode}){
 return <section><p className="enigma-source-note">保存于 {displayTime(value.publishedAt)} · {value.current?'当前来源与阅读器一致':'历史阅读，需要重新核对来源或阅读器版本'}</p>{value.issues?.map((issue:string)=><p className="enigma-error" key={issue}>{issue}</p>)}<CodeTraceResult value={{...value.reading,queryRepo:value.queryRepo}} published details={details}/></section>;
}
export function ReadingNodeResult({value,details}:{value:any;details:ReactNode}){
 const sessionPath=useEngineering(s=>s.sessionPath),control=useSideAction(sessionPath);
 return <section className="enigma-source-reading"><h3>源码节点版本核对</h3><strong>{label(value.published.source)}</strong><p>{value.matchesPublishedSource?'当前片段与保存时版本一致。':'当前源码已变化，旧阅读结论需要重新核对。'}</p>{!value.current&&<p className="enigma-source-note">整份阅读的来源或解析器版本已变化，节点内容相同也不代表整份阅读仍有效。</p>}<h4>阅读时保存的片段</h4><pre>{value.published.source.snippet}</pre>{value.source?<><h4>本次读取的当前片段</h4><pre>{value.source.snippet}</pre><button onClick={()=>openSource(value.source)}>打开当前完整文件</button></>:<p className="enigma-error">当前文件已移除或原行号已不存在，仅保留历史片段。</p>}{value.query&&<div className="enigma-inline-actions"><button disabled={!!control.busy} onClick={()=>void control.run('refresh',()=>readRecordAction('reading-open',{query:value.query,repo:value.queryRepo,node:value.published.id}))}>重新核对此节点</button><button disabled={!!control.busy} onClick={()=>void control.run('map',()=>readRecordAction('reading-open',{query:value.query,repo:value.queryRepo}))}>返回完整阅读</button></div>}{control.error&&<p className="enigma-error" role="alert">{control.error}</p>}<details className="enigma-result"><summary>完整版本与证据</summary>{details}</details></section>;
}
export function SourceIndexResult({value,details}:{value:any;details:ReactNode}){
 const [limit,setLimit]=useState(30);
 return <section className="enigma-source-reading"><h3>源码文件候选：{value.query}</h3><p>按文字匹配排序，帮助找到阅读入口。得分不是调用关系或正确性结论。</p><p className="enigma-source-note">本次返回 {value.files.length} / {value.total} 个候选，显示前 {Math.min(limit,value.files.length)} 项；{value.refreshed} 份更新、{value.reused} 份复用索引。</p>{!value.files.some((file:any)=>file.score>0)&&<p>未找到关键词命中；下面列出可阅读文件，可换更具体的符号。</p>}{value.files.slice(0,limit).map((file:any)=><article className="enigma-repo" key={`${file.repo}:${file.file}`}><div><button onClick={()=>openSource(file)}>{file.repo} / {file.file}</button><p>{file.language==='TypeScript'?'TypeScript / JavaScript':file.language} · 匹配分 {file.score}</p></div></article>)}{value.files.length>limit&&<button onClick={()=>setLimit(count=>count+30)}>继续显示候选</button>}{value.truncated&&<p>还有文件未在本次预算内展示，可缩小关键词或调整文件预算。</p>}<details><summary>索引诊断与完整结果</summary>{details}</details></section>;
}
export function SchemaReadingResult({value,details}:{value:any;details:ReactNode}){
 const [limit,setLimit]=useState(20);
 return <section className="enigma-source-reading"><h3>接口数据结构{value.query?`：${value.query}`:''}</h3><p>查看 Schema / IDL 定义的字段和类型。静态字段相符不代表消费者兼容，仍需要实际检查。</p><p className="enigma-source-note">{value.definitions.length} 个定义 · {value.relations.length} 条类型引用 · {value.sources.length} 个来源文件</p>{!value.definitions.length&&<p>没有匹配的定义。可换类型或字段名，支持 Protobuf、Thrift 与 JSON Schema。</p>}{value.definitions.slice(0,limit).map((definition:any)=><details className="enigma-reading-chapter" key={definition.id}><summary>{definition.language==='JSON Schema'?definition.name:definition.qualified||definition.name} · {definition.language} · {definition.source.repo} / {definition.source.file}:{definition.source.line}</summary><button onClick={()=>openSource(definition.source)}>打开定义所在文件</button><SchemaMemberTable members={definition.members}/><details><summary>保存的源码片段</summary><pre>{definition.source.snippet}</pre>{definition.source.truncated&&<p>片段已截断，请打开定义文件查看完整内容。</p>}</details></details>)}{value.definitions.length>limit&&<button onClick={()=>setLimit(count=>count+20)}>继续显示定义</button>}{value.truncated&&<p className="enigma-source-note">部分文件、定义或引用超出本次范围，请缩小查询后复核。</p>}{!!value.diagnostics.length&&<details><summary>导入或解析问题 · {value.diagnostics.length} 项</summary>{value.diagnostics.map((text:string,index:number)=><p key={index}>{text}</p>)}</details>}<details className="enigma-result"><summary>类型关系与完整证据</summary>{details}</details></section>;
}

function SchemaMemberTable({members}:{members:any[]}){
 const [limit,setLimit]=useState(40);
 if(!members.length)return <p>该定义没有展开的字段。</p>;
 return <><p className="enigma-source-note">显示 {Math.min(limit,members.length)} / {members.length} 个字段或方法</p><div className="enigma-schema-table"><table><thead><tr><th>字段 / 方法</th><th>类型</th><th>约束</th></tr></thead><tbody>{members.slice(0,limit).map((member:any,index:number)=><tr key={index}><td>{member.name}</td><td>{member.type}</td><td>{member.required===true?'必填':member.required===false?'非必填':'未声明'}{member.fieldId!==undefined?` · 字段编号 ${member.fieldId}`:''}</td></tr>)}</tbody></table></div>{members.length>limit&&<button onClick={()=>setLimit(count=>count+40)}>继续显示字段</button>}</>;
}
