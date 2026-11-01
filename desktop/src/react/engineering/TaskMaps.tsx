import {ReadingCoverage} from './ReadingCoverage';
import {SearchField} from '../ui/SearchField';
import {useState,useRef,useEffect,type ReactNode} from 'react';
import {useStore} from '../stores';
import {useEngineering,showAction,showRecordAction,openEngineering,type Action,type Field} from './state';
import {useSideQuery} from './useSideQuery';
import {displayTime} from './interaction-copy';

const roles:Record<string,string>={entry:'入口',contract:'接口契约',implementation:'实现',consumer:'消费者与引用',test:'测试',configuration:'配置',documentation:'文档'};
const statuses:Record<string,string>={unassessed:'尚未判断',supported:'源码说明支持',conflict:'发现不符',insufficient:'依据不足'};
const sourceLabel=(node:any)=>`${node.source.repo} / ${node.source.file}:${node.source.line} · ${node.source.symbol}`;
export function mapAnnotationAction(action:Action,report:any):Action{
  const nodes=report.nodes.map((node:any)=>({value:node.id,label:`${node.source.repo} / ${node.source.file}:${node.source.line} · ${node.source.symbol||roles[node.role]||'源码'}`}));
  const row=(field:Field):Field=>({...field,fields:field.fields?.map(child=>child.name==='anchors'?{...child,kind:'multi',label:'选择源码依据',items:nodes}:child.name==='id'&&field.name==='requirements'?{...child,kind:'select',label:'选择已有要求',help:'选择这份地图中已登记的要求，无需填写编号。',items:(report.requirements||[]).map((item:any)=>({value:item.id,label:item.text}))}:child)});
  return {...action,title:'保存地图说明',description:'说明必须引用已发布的源码节点。判断与测试结果分别记录，不会修改项目代码。',fields:action.fields.map(field=>field.name==='id'?{...field,kind:'record',source:undefined,value:report.id,displayValue:report.goal}:field.name==='revision'?{...field,kind:'record',value:report.revision,displayValue:`修订 ${report.revision}`} : row(field)).filter(field=>field.name!=='requirements'||report.requirements?.length)};
}
export function TaskMaps(){
  const sessionPath=useEngineering(s=>s.sessionPath),snapshot=useEngineering(s=>s.snapshot),query=useSideQuery<any>('/data/maps',sessionPath),readOnly=useStore(s=>s.sessionPermissionMode==='read_only');
  const data=query.data,busy=snapshot?.state?.idle===false||snapshot?.state?.operation?.state==='running',build=snapshot?.actions?.find((a:Action)=>a.id==='map-build');
  return <section className="enigma-task-maps"><h3>按任务组织代码阅读</h3><p className="enigma-feature-intro">把入口、接口、实现、消费者和检查串成阅读路线。地图保留生成时的源码片段；新的修改或资料更新会让旧地图失效。</p>
    {build&&<button disabled={readOnly||busy} data-tooltip={readOnly?'当前对话只读，不能生成地图':busy?'等待当前操作结束':'输入目标、起始符号和需要核对的要求，生成有来源的阅读路线'} onClick={()=>void showAction(build)}>建立任务地图</button>}
    <p className="enigma-source-note">{query.receivedAt?`每 5 秒核对来源 · 最近读取：${displayTime(query.receivedAt)}`:'正在读取已有地图…'}</p>
    {query.error&&<p className="enigma-error" role="status">地图状态未更新，以下为最近记录。<button onClick={()=>void query.refresh()}>重新读取地图</button></p>}
    {data?.truncated&&<p>显示最近 30 份地图，更早记录保留在项目中。</p>}{!!data?.unavailable?.length&&<p className="enigma-error">{data.unavailable.length} 份地图记录暂不可读取。</p>}
    {data&&!data.items.length&&<p className="enigma-empty-feature">还没有当前任务的代码地图。想先理解改造入口和跨仓影响时，可以从目标或符号开始。</p>}
    {(data?.items||[]).map((item:any,index:number)=><details className="enigma-review-report" key={item.report.id} open={index===0||undefined}><summary><strong>{item.report.goal}</strong><small>修订 {item.report.revision} · {query.error?'状态待核对':item.current?'当前来源有效':'历史地图，需重新核对'} · {displayTime(item.report.createdAt)}</small></summary><TaskMapCard item={item} busy={busy||!!query.error} blocked={busy||readOnly||!item.current||!!query.error}/></details>)}
  </section>;
}
function TaskMapCard({item,blocked,busy}:{item:any;blocked:boolean;busy:boolean}){
  const report=item.report,snapshot=useEngineering(s=>s.snapshot),[filter,setFilter]=useState(''),[limit,setLimit]=useState(30);
  const sourceElements=useRef(new Map<string,HTMLDetailsElement>()),[focusRequest,setFocusRequest]=useState<{id:string}|null>(null);
  const byId=new Map(report.nodes.map((node:any)=>[node.id,node])),ordered=report.path.map((step:any)=>byId.get(step.node)).filter(Boolean) as any[];
  const jumpTo=(id:string)=>{setFilter('');setLimit(value=>Math.max(value,ordered.findIndex(node=>node.id===id)+1));setFocusRequest({id});};
  useEffect(()=>{if(!focusRequest)return;const element=sourceElements.current.get(focusRequest.id);if(element){element.open=true;element.querySelector('summary')?.focus();element.scrollIntoView?.({block:'nearest',behavior:'auto'});}},[focusRequest]);
  const references=(ids:string[])=><div className="enigma-inline-actions">{[...new Set(ids)].map(id=>byId.get(id) as any).filter(Boolean).map(node=><button key={node.id} data-tooltip="跳到地图保存的源码片段，查看这条说明的实际依据" onClick={()=>jumpTo(node.id)}>{sourceLabel(node)}</button>)}</div>;
  const nodes=ordered.filter(node=>`${node.source.repo} ${node.source.file} ${node.source.symbol} ${roles[node.role]||node.role}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const annotate=snapshot?.actions?.find((a:Action)=>a.id==='map-annotate'),coverage=snapshot?.actions?.find((a:Action)=>a.id==='map-coverage');
  return <div><div className="enigma-chips"><span>{report.nodes.length} 个源码节点</span><span>{report.edges.length} 条静态关系</span><span>{report.requirements?.length||0} 项要求</span>{report.truncated&&<span>仍有未展开范围</span>}</div>
    {item.issues?.map((issue:string)=><p className="enigma-error" key={issue}>{issue}</p>)}
    <div className="enigma-inline-actions">{coverage&&<button disabled={busy} onClick={()=>void showRecordAction('map-coverage',{id:report.id},{id:report.goal})} data-tooltip={busy?'等待当前操作结束或重新读取状态':'选择当前检查证据，将源码判断与实际测试分别核对'}>核对这份地图的覆盖</button>}{annotate&&<button disabled={blocked} data-tooltip={blocked?'只读、执行中或来源已变化时不能补充当前地图':'选择源码节点作为依据，补充解释、风险或需求判断'} onClick={()=>void showAction(mapAnnotationAction(annotate,report))}>补充说明与风险</button>}</div>
    {!!report.architecture?.length&&<details className="enigma-result"><summary>仓库职责与依赖</summary><p className="enigma-source-note">职责与仓库依赖来自项目登记；下方源码节点才是本次实际展开的范围。</p>{report.architecture.map((repo:any)=><p key={repo.repo}><strong>{repo.repo}</strong> · {repo.responsibility||'职责待补充'}{repo.dependsOn.length?` · 依赖 ${repo.dependsOn.join('、')}`:''} · {repo.nodes.length} 个源码节点</p>)}</details>}
    {!!report.edges.length&&<details className="enigma-result"><summary>源码连接关系 · {report.edges.length} 条</summary>{report.edges.map((edge:any,index:number)=><div key={index}><p>{edge.kind==='outgoing-call'?'向下调用':edge.kind==='call-site'?'调用位置':edge.kind==='import-binding'?'导入引用':'静态源码关系'} · {edge.confidence==='confirmed'?'静态绑定已确认':'待核对'}（不代表已执行）</p>{references([edge.from,edge.to])}</div>)}</details>}
    <ReadingCoverage reading={report}/><h4>建议阅读顺序</h4><p className="enigma-source-note">顺序是阅读建议；连接关系来自静态解析，运行行为还需要实际验证。</p>
    {ordered.length>6&&<SearchField className="enigma-timeline-search" aria-label="筛选地图源码节点" placeholder="按符号、路径、仓库或职责筛选" value={filter} onChange={event=>{setFilter(event.target.value);setLimit(30);}}/>}
    <p className="enigma-source-note">显示 {Math.min(limit,nodes.length)} / {nodes.length} 个匹配节点</p>
    {nodes.slice(0,limit).map((node:any,index:number)=><details className="enigma-reading-chapter" key={node.id} ref={element=>{if(element)sourceElements.current.set(node.id,element);else sourceElements.current.delete(node.id);}}><summary>{index+1}. {roles[node.role]||node.role} · {sourceLabel(node)}</summary><pre>{node.source.snippet}</pre>{node.source.truncated&&<p>片段已截断，不能视为完整源码。</p>}<button data-tooltip="打开仓库当前文件；上方片段仍是地图生成时的版本" onClick={()=>openEngineering({id:`file:${node.source.repo}:${node.source.file}`,title:node.source.file,group:'reading',repo:node.source.repo,file:node.source.file})}>打开当前源码</button><p className="enigma-source-note">保存的版本：{node.source.hash?.slice(0,12)}</p></details>)}
    {nodes.length>limit&&<button onClick={()=>setLimit(value=>value+30)}>继续显示节点</button>}
    {!!report.insights?.length&&<><h4>解释与风险</h4>{report.insights.map((insight:any,index:number)=><article className="enigma-step" key={index}><div><strong>{insight.title}</strong><p>{insight.text}</p><small>{insight.anchors.length} 个来源 · 待核对的解释</small>{references(insight.anchors)}</div></article>)}</>}
    {!!report.requirements?.length&&<><h4>需求与测试点</h4>{report.requirements.map((requirement:any)=><article className="enigma-step" key={requirement.id}><div>
      <strong>{requirement.text}</strong>
      <p>{statuses[requirement.status]||requirement.status}{requirement.checks.length?` · 对应检查：${requirement.checks.join('、')}`:' · 尚未关联检查'}</p>
      {requirement.explanation&&<p>{requirement.explanation}</p>}
      {references(requirement.anchors||[])}
    </div></article>)}</>}
  </div>;
}
export function MapCoverageResult({value,details}:{value:any;details:ReactNode}){
  return <section className="enigma-result"><h3>地图需求覆盖：{value.goal}</h3><p>{value.current?'本次核对时，地图来源有效。':'本次核对时，地图来源已变化，源码判断需要重新核对。'}源码判断与检查执行分别展示。</p><p className="enigma-source-note">这是一次核对结果；后续代码、资料或检查变化后，需要重新核对。</p><button onClick={()=>void showRecordAction('map-coverage',{id:value.map},{id:value.goal})}>重新核对这份地图</button>{value.evidenceIssue&&<p className="enigma-error">{value.evidenceIssue}</p>}{value.requirements.length?value.requirements.map((item:any)=><article className="enigma-step" key={item.id}><div><strong>{item.text}</strong><p>{statuses[item.status]||item.status} · {item.checksPassed?'关联检查已实际通过':'尚无本次有效的关联检查'}</p>{item.explanation&&<p>{item.explanation}</p>}</div></article>):<p>这份地图未登记需求与测试点，不能据此评估任务覆盖。</p>}<details><summary>完整覆盖证据</summary>{details}</details></section>;
}
