import { GlassSelection } from '../ui/GlassSelection';
import { useId,type ReactNode } from 'react';
import { showAction, showRecordAction, readRecordAction, useEngineering,rememberEngineeringView, type Action } from './state';
import {useSideAction} from './useSideAction';
import {RecipesPanel} from './Recipes';
import {useStore} from '../stores';

const guides: Record<string, {title:string;description:string;actions:string[]}> = {
  handoff: {title:'把背景带到下一个任务',description:'想在新对话继续相近工作，选「同背景开启新任务」。想交给其他 Agent，导出交接背景；需要连代码一起搬走时，再导出任务包。拿到已有任务包后，先检查内容再复现。原对话都会保留。',actions:['new-context','handoff-export','package-export','package-inspect']},
  skills: {title:'技能与配方有什么区别？',description:'技能是给助手参考的操作说明；配方是一组可重复运行的工程步骤。添加发现路径后可查找技能；配方运行会执行其中登记的命令。',actions:['skills-paths']},
};
export function GuidedRecords({group,value,details,evidence=()=>null}:{group:string;value:any;details:ReactNode;evidence?:(value:any)=>ReactNode}) {
  const view=useEngineering(state=>state.sections?.skills||'skills'),tabs=useId();
  const setView=(value:'skills'|'recipes')=>{useEngineering.setState(state=>({sections:{...state.sections,skills:value}}));rememberEngineeringView();};
  const snapshot=useEngineering(s=>s.snapshot), guide=guides[group];
  const sessionPath=useEngineering(s=>s.sessionPath),actionState=useSideAction(sessionPath);
  const available:Action[]=snapshot?.actions||[];
  const readOnly=useStore(s=>s.sessionPermissionMode==='read_only');
  const busy=!!actionState.busy||snapshot?.state?.idle===false || snapshot?.state?.operation?.state==='running';
  const entries: Array<{key:string;title:string;summary:string;manual?:boolean;command?:string;action?:string;args?:Record<string,unknown>;label?:string}> = group==='skills'
    ? (value.catalog?.skills||[]).map((s:any)=>({key:s.id,title:s.name,summary:s.description,manual:s.modelInvocation===false,command:s.command,action:'skills-read',args:{id:s.id,version:s.version},label:'阅读技能'}))
    : (value.packages||[]).map((p:any)=>({key:p.id,title:p.goal||'已导出的任务包',summary:`${p.status==='failed'?'导出未完成':p.status==='preparing'?'正在准备':p.status==='unavailable'?'内容暂不可读取':`${p.repos??'—'} 个仓库 · 待检查完整性`} · ${p.directory}`,action:!p.status||p.status==='complete'?'package-inspect':undefined,args:{directory:p.directory},label:'检查这个任务包'}));
  return <section><h3>{guide.title}</h3><p className="enigma-feature-intro">{guide.description}</p>
    {group==='skills'&&<div className="enigma-view-tabs" role="tablist" aria-label="技能与配方类型" data-glass-segmented=""><GlassSelection selection={view}/>{(['skills','recipes'] as const).map(tab=><button key={tab} role="tab" id={`${tabs}-${tab}`} aria-selected={view===tab} aria-controls={`${tabs}-panel-${tab}`} tabIndex={view===tab?0:-1} onClick={()=>setView(tab)} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?'skills':event.key==='End'?'recipes':view==='skills'?'recipes':'skills';setView(next);document.getElementById(`${tabs}-${next}`)?.focus();}}}>{tab==='skills'?'技能':'配方'}</button>)}</div>}
    {(group!=='skills'||view==='skills')&&<div role={group==='skills'?'tabpanel':undefined} id={`${tabs}-panel-skills`} aria-labelledby={group==='skills'?`${tabs}-skills`:undefined}>
    {group==='skills'&&value.catalog?.truncated&&<p className="enigma-source-note">显示 {value.catalog.skills.length} / {value.catalog.totalMatches} 项匹配技能。可以用上方关键词缩小范围。</p>}
    {group==='skills'&&value.catalog?.unavailable?.length>0&&<p className="enigma-source-note">有 {value.catalog.unavailable.length} 项技能暂不可读，原因保留在下方完整记录中。</p>}
    <div className="enigma-inline-actions">{guide.actions.map(id=>{const action=available.find(a=>a.id===id);const blocked=readOnly&&!!action?.effect&&action.effect!=='read';return action&&<button key={id} disabled={busy||blocked} data-tooltip={blocked?'当前对话只读，不能修改配置':busy?'等待当前操作完成后再使用':action.description} onClick={()=>void showAction(action)}>{action.title}</button>;})}</div>
    {group==='handoff'&&value.packagesTruncated&&<p className="enigma-source-note">显示当前任务最近50份任务包，更早文件仍保留在项目中。</p>}
    {entries.length ? entries.map(entry=><article className="enigma-repo" key={entry.key}><div><strong>{entry.title}</strong>{entry.manual&&<p className="enigma-source-note">仅手动调用 · {entry.command}</p>}{entry.summary?.length>180?<details className="enigma-skill-description"><summary>{entry.summary.slice(0,140)}…</summary><p>{entry.summary}</p></details>:<p>{entry.summary}</p>}{entry.action&&available.some(a=>a.id===entry.action)&&<button disabled={busy} data-tooltip={group==='skills'?'只查看技能说明，不会执行其中步骤':'核对这份任务包内容'} onClick={()=>void (['skills-read','package-inspect'].includes(entry.action!)?actionState.run(entry.action!,()=>readRecordAction(entry.action!,entry.args||{})):showRecordAction(entry.action!,entry.args||{}))}>{entry.label}</button>}</div></article>) : <p className="enigma-source-note">{group==='skills'?'当前没有匹配的技能，可以先添加发现路径，或换个关键词。':'还没有导出的代码任务包；同背景新任务仍可直接使用。'}</p>}
    {actionState.error&&<p className="enigma-error" role="alert">{actionState.error}</p>}
    </div>}
    {group==='skills'&&view==='recipes'&&<div role="tabpanel" id={`${tabs}-panel-recipes`} aria-labelledby={`${tabs}-recipes`}><RecipesPanel initial={value} evidence={evidence}/></div>}
    <details className="enigma-result"><summary>完整记录与技术详情</summary>{details}</details>
  </section>;
}
