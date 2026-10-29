import type { ReactNode } from 'react';
import {useStore} from '../stores';
import {openEngineering,showAction,useEngineering,type Action,type Field} from './state';
import {explainEvidenceProblem} from './interaction-copy';

export function dependencyFields(fields:Field[],choices:any,repo:unknown):Field[]{
 const repositories=choices.repos||choices.repositories||[];
 return fields.map(field=>field.name==='dependsOn'?{...field,items:repositories.filter((item:any)=>item.id!==repo).map((item:any)=>({value:item.id,label:item.role?`${item.id} · ${item.role}`:item.id})),help:'选择这个仓库直接使用的上游。例：client 调用 api，就在 client 中勾选 api；清空选择会移除已声明的依赖。'}:field);
}
export function dependencyAction(action:Action,repo:any):Action{
 return {...action,fields:action.fields.map(field=>field.name==='repo'?{...field,kind:'record',value:repo.id,displayValue:repo.id,help:'正在修改这个仓库的上游依赖。'}:field.name==='dependsOn'?{...field,value:[...repo.dependsOn]}:field)};
}
export function ProjectPanel({value,evidence}:{value:any;evidence:(value:any)=>ReactNode}){
 const snapshot=useEngineering(s=>s.snapshot),readOnly=useStore(s=>s.sessionPermissionMode==='read_only');
 const busy=snapshot?.state?.idle===false||snapshot?.state?.operation?.state==='running',blocked=readOnly||busy;
 const actions:Action[]=snapshot?.actions||[],action=(id:string)=>actions.find(item=>item.id===id);
 const open=(id:string)=>{const item=action(id);if(item&&!blocked)void showAction(item);};
 const repos=value?.repositories||[],checks=value?.checks||[],blockers=value?.blockers||[];
 return <section className="enigma-project">
  <p className="enigma-feature-intro">把相关仓库放进同一项目，声明它们的依赖，并登记真正需要通过的检查。加入仓库不会搬动原目录。</p>
  <div className="enigma-inline-actions">{action('repo-add')&&<button disabled={blocked} data-tooltip={readOnly?'当前对话只读，不能加入仓库':'关联现有本地 Git 仓库，保留原目录'} onClick={()=>open('repo-add')}>加入仓库</button>}{action('check-add')&&<button disabled={blocked||!repos.length} data-tooltip={!repos.length?'先加入要运行检查的仓库':'登记检查命令；保存后不会自动执行'} onClick={()=>open('check-add')}>添加验收检查</button>}</div>
  {!repos.length&&<div className="enigma-empty-feature"><h3>先加入要处理的仓库</h3><p>仓库可以位于不同目录；之后可按上下游关系联动修改。</p></div>}
  <p className="enigma-source-note">{repos.length} 个仓库 · {checks.length} 项检查 · {blockers.length} 项待核对</p>
  {repos.map((repo:any)=><article className="enigma-repo" key={repo.id}><div><strong>{repo.id}</strong><p>{repo.role||'尚未填写职责'}</p><small title={repo.root} data-tooltip={repo.root}>{repo.root}</small><div className="enigma-chips"><span>{repo.access==='write'?'可写':'只读'}</span><span>{repo.dependsOn.length?`依赖：${repo.dependsOn.join('、')}`:'未声明上游依赖'}</span></div><div className="enigma-inline-actions"><button onClick={()=>openEngineering({id:`repo:${repo.id}`,title:repo.id,group:'reading',repo:repo.id})}>浏览代码</button>{action('repo-dependencies')&&<button disabled={blocked} data-tooltip="查看并修改这个仓库直接依赖的上游，已有选择会带入" onClick={()=>void showAction(dependencyAction(action('repo-dependencies')!,repo))}>调整上游依赖</button>}</div></div></article>)}
  <div className="enigma-section-heading"><h3>项目验收检查</h3>{action('verify')&&<button disabled={blocked||!checks.length} data-tooltip={!checks.length?'先登记至少一项检查':'执行下方全部检查，保存实际输出与代码版本'} onClick={()=>open('verify')}>运行全部检查</button>}</div>
  {!checks.length&&<p className="enigma-source-note">还没有验收检查。先添加项目现有的测试或构建命令，才能判断改造是否通过。</p>}
  {checks.map((check:any)=><article className="enigma-recipe-card" key={check.id}><strong>{check.id}</strong><p>{check.repo} · {check.joint?'跨仓联合检查':'仓库检查'}{check.timeoutMs?` · 最长 ${check.timeoutMs/1000} 秒`:''}</p><pre className="enigma-runtime-log">{check.argv.join('\n')}</pre><small>每行一个命令参数。登记状态不表示检查已经通过。</small></article>)}
  {!!blockers.length&&<><h3>仍需核对</h3>{blockers.map((blocker:string)=><p key={blocker} className="enigma-source-note">{explainEvidenceProblem(blocker)}</p>)}</>}
  <details className="enigma-result"><summary>完整项目配置</summary>{evidence(value)}</details>
 </section>;
}
