import {useState,type ReactNode} from 'react';
import {useStore} from '../stores';
import {engineeringRequest,showAction,showRecordAction,readRecordAction,openGroup,useEngineering,type Action} from './state';
import {useSideQuery} from './useSideQuery';
import {useSideAction} from './useSideAction';
import {displayTime,operationLabel} from './interaction-copy';

export function recipeEditAction(action:Action,recipe:any):Action{
  const values:Record<string,unknown>={id:recipe.id,label:recipe.label,revision:recipe.revision,timeoutMs:recipe.timeoutMs,steps:recipe.steps,parameters:Object.entries(recipe.parameters||{}).map(([name,value]:[string,any])=>({name,...value}))};
  return {...action,title:'保存配方修改',description:'修改当前配方的步骤或参数。保存会产生新修订，不会立即运行。',fields:action.fields.map(field=>({...field,value:values[field.name],...(['id','revision'].includes(field.name)?{kind:'record',source:undefined,displayValue:field.name==='id'?recipe.label:`修订 ${recipe.revision}`,help:field.name==='id'?'编辑这份已保存的配方，编号保持不变。':'保存前会再次核对当前修订，避免覆盖新修改。'}:{})}))};
}
export function recipeRunAction(action:Action,recipe:any):Action{
  const parameters=Object.entries(recipe.parameters||{}) as [string,{description:string;default?:string}][];
  return {...action,title:'确认运行配方',description:`运行「${recipe.label}」修订 ${recipe.revision}，共 ${recipe.steps.length} 个步骤；最后执行项目原检查。请先核对参数和卡片中的命令。`,fields:action.fields.map(field=>field.name==='id'?{...field,kind:'record',source:undefined,value:recipe.id,displayValue:recipe.label}:field.name==='version'?{...field,kind:'record',value:recipe.version,displayValue:`修订 ${recipe.revision}`}:
    field.name==='parameters'?{...field,kind:'object',value:Object.fromEntries(parameters.filter(([,spec])=>spec.default!==undefined).map(([name,spec])=>[name,spec.default])),fields:parameters.map(([name,spec])=>({name,label:name,kind:'text',required:spec.default===undefined,value:spec.default,help:spec.description||'按原样传给命令，不解释为代码。'}))}:field).filter(field=>field.name!=='parameters'||parameters.length>0)};
}
export function recipeProposalAction(action:Action,proposal:any):Action{
  const draft=recipeEditAction(action,{...proposal.input,revision:undefined});
  return {...draft,title:'保存为新配方',description:'补充可重复的执行步骤和参数，再保存为一份新配方。原计划证据只说明来源，保存不会执行命令。',fields:draft.fields.filter(field=>field.name!=='revision').map(field=>field.name==='id'?{...field,help:'这份草稿的新配方编号已自动生成；不会覆盖已有配方。'}:field)};
}
export function RecipesPanel({initial,evidence}:{initial:any;evidence:(value:any)=>ReactNode}){
  const [filter,setFilter]=useState('');
  const snapshot=useEngineering(s=>s.snapshot),sessionPath=useEngineering(s=>s.sessionPath),query=useSideQuery<any>('/data/recipes',sessionPath),control=useSideAction(sessionPath,'recipes');
  const value=query.data||initial,readOnly=useStore(s=>s.sessionPermissionMode==='read_only'),busy=snapshot?.state?.idle===false||snapshot?.state?.operation?.state==='running';
  const save=snapshot?.actions?.find((a:Action)=>a.id==='recipe-save'),run=snapshot?.actions?.find((a:Action)=>a.id==='recipe-run'),reconcile=snapshot?.actions?.find((a:Action)=>a.id==='recipe-reconcile'),propose=snapshot?.actions?.find((a:Action)=>a.id==='recipe-propose');
  const operation=snapshot?.state?.operation,canStop=operation?.state==='running'&&operation.title===run?.title;
  const blocked=readOnly||busy||!!query.error;
  return <section className="enigma-recipes">
    <div className="enigma-section-heading"><h3>可重复运行的配方</h3>{save&&<button disabled={blocked} data-tooltip={readOnly?'当前对话只读，不能保存配方':busy?'等待当前操作结束':'定义明确步骤与参数，末尾保留原项目检查'} onClick={()=>void showAction(save)}>创建配方</button>}</div>
    <p className="enigma-source-note">配方会执行已登记的工程步骤。先展开查看命令，再填写本次参数；保存或编辑不会自动运行。</p>
    {propose&&<div className="enigma-recipe-card"><h4>把成功任务整理成下次可用的步骤</h4><p>提炼会保存任务目标和原检查依据，供你补充可重复的命令；不会自动重放当时的代码修改。</p><button disabled={blocked||!value.proposalPlan?.eligible} data-tooltip={value.proposalPlan?.eligible?'从当前已验收计划提取草稿，不会立即执行':'当前计划全部验收通过后才能提取；检查证据也必须有效'} onClick={()=>void showAction(propose)}>从成功任务提取配方</button>{!value.proposalPlan?.eligible&&<p className="enigma-source-note">{value.proposalPlan?`${value.proposalPlan.completed} / ${value.proposalPlan.total} 步骤已验收，请先补齐当前有效的检查。`:'当前任务尚无计划。'}<button onClick={()=>openGroup('plan')}>查看任务计划</button></p>}</div>}
    {query.receivedAt>0&&<p className="enigma-source-note">运行记录每 5 秒更新 · 最近读取：{displayTime(query.receivedAt)}</p>}
    {query.error&&<p className="enigma-error" role="status">配方信息未更新，以下为最近记录。<button onClick={()=>void query.refresh()}>重新读取配方</button></p>}
    {canStop&&<button disabled={!!control.busy} data-tooltip="停止当前工作台发起的配方，已完成步骤的实际效果保留，后续步骤不再启动" onClick={()=>void control.run('stop',()=>engineeringRequest('/cancel',sessionPath,{}),()=>query.refresh())}>{control.busy?'正在停止…':'停止当前配方'}</button>}
    {value.recipes?.length>4&&<input className="enigma-timeline-search" aria-label="筛选配方" placeholder="按配方名称或编号筛选" value={filter} onChange={event=>setFilter(event.target.value)}/>}
    {(value.recipes||[]).filter((recipe:any)=>`${recipe.label} ${recipe.id}`.toLowerCase().includes(filter.trim().toLowerCase())).map((recipe:any)=><article className="enigma-recipe-card" key={recipe.id}><strong>{recipe.label}</strong><div className="enigma-chips"><span>修订 {recipe.revision}</span><span>{recipe.steps.length} 个步骤</span><span>最长 {Math.ceil((recipe.timeoutMs||300000)/1000)} 秒</span></div>
      {!!Object.keys(recipe.parameters||{}).length&&<dl>{Object.entries(recipe.parameters).map(([name,spec]:[string,any])=><div key={name}><dt>{name}</dt><dd>{spec.description||'未填写说明'}{spec.default!==undefined?` · 默认：${spec.default===''?'空文本':spec.default}`:' · 运行时必填'}</dd></div>)}</dl>}
      <details className="enigma-result"><summary>查看步骤与命令</summary><ol>{recipe.steps.map((step:any)=><li key={step.id}><strong>{step.id} · {({command:'运行命令',service:'项目服务',browser:'浏览器验证',verify:'项目原检查'} as Record<string,string>)[step.kind]||step.kind}</strong>{step.argv&&<><p>仓库：{step.repo}</p><pre>{step.argv.join('\n')}</pre></>}{step.kind==='service'&&<p>{step.action==='start'?'启动':'停止'}：{step.service}</p>}{step.kind==='browser'&&<p>已登记场景：{step.scenario}</p>}{step.kind==='verify'&&<p>执行当前登记的全部仓库与联合检查。</p>}</li>)}</ol></details>
      <div className="enigma-inline-actions">{run&&<button disabled={blocked} data-tooltip="按当前修订打开参数确认，执行前再次核对配方是否变化" onClick={()=>void showAction(recipeRunAction(run,recipe))}>运行此配方</button>}{save&&<button disabled={blocked} data-tooltip="预填当前步骤、参数和修订号，避免覆盖别人刚保存的修改" onClick={()=>void showAction(recipeEditAction(save,recipe))}>编辑配方</button>}</div>
    </article>)}
    {!value.recipes?.length&&<p className="enigma-empty-feature">还没有可运行配方。可把重复的检查、服务准备或其他步骤整理成配方。</p>}
    {!!value.recipes?.length&&!value.recipes.some((recipe:any)=>`${recipe.label} ${recipe.id}`.toLowerCase().includes(filter.trim().toLowerCase()))&&<p>没有匹配的配方，请换个名称或清空筛选。</p>}
    {!!value.proposals?.length&&<details className="enigma-result"><summary>提炼记录 · {value.proposals.filter((p:any)=>!p.savedRecipe).length} 份待完善 · {value.proposals.filter((p:any)=>p.savedRecipe).length} 份已保存</summary><p>草稿只保留成功任务的目标与检查依据，还需要填写可执行步骤。确认保存前不会运行。</p>{value.proposals.map((proposal:any)=><article className="enigma-recipe-card" key={proposal.id}><strong>{proposal.input?.label||proposal.id}</strong><p>{proposal.savedRecipe?`已保存为配方 · 修订 ${proposal.savedRecipe.revision}`:'待补充可重复的执行步骤'}</p><p className="enigma-source-note">{displayTime(proposal.createdAt)} · {proposal.origin?.evidence?.length||0} 份原验收依据 · {proposal.sourceCurrent?'原证据仍有效':'历史来源，已变化或暂不可核对'}。原任务通过不能代替新运行的检查。</p><ul>{proposal.goals?.map((goal:any)=><li key={goal.step}>{goal.repo} · {goal.goal} · 检查：{goal.checks.join('、')||'未登记'}</li>)}</ul>{save&&<button disabled={blocked} onClick={()=>void showAction(proposal.savedRecipe?recipeEditAction(save,proposal.savedRecipe):recipeProposalAction(save,proposal))}>{proposal.savedRecipe?'编辑已保存的配方':'补充并保存草稿'}</button>}<details><summary>原计划与完整来源</summary>{evidence(proposal)}</details></article>)}</details>}
    {value.proposalNotice?.truncated&&<p className="enigma-source-note">显示当前任务最近30份提炼记录，更早记录仍保留在项目中。</p>}{!!value.proposalNotice?.unavailable&&<p className="enigma-error">{value.proposalNotice.unavailable} 份提炼记录暂不可读取。</p>}
    {!!value.runs?.length&&<><h3>本任务的运行记录</h3>{[...value.runs].sort((a,b)=>String(b.run.createdAt).localeCompare(String(a.run.createdAt))).map((record:any)=><RecipeRunRecord key={record.run.id} value={record} name={value.recipes?.find((r:any)=>r.id===record.run.recipe)?.label} evidence={evidence} report={snapshot?.actions?.some((a:Action)=>a.id==='recipe-report')?()=>void control.run(`report-${record.run.id}`,()=>readRecordAction('recipe-report',{id:record.run.id})):undefined} reporting={!!control.busy}/> )}</>}
    {value.interruption&&<div className="enigma-recipe-card"><h4>{value.interruption.canReconcile?'配方中断后仍占用这个工作区':'有配方仍在执行或进程状态待确认'}</h4><p>{value.recipes?.find((recipe:any)=>recipe.id===value.interruption.recipe)?.label||'配方运行'} · {displayTime(value.interruption.createdAt)}</p><p>核对原进程和实际文件后，可以释放占用。历史运行保留；未确认的命令效果仍需单独处理，不会自动重做。</p>{reconcile&&<button disabled={blocked||!value.interruption.canReconcile} onClick={()=>void showRecordAction('recipe-reconcile',{owner:value.interruption.token},{owner:value.recipes?.find((recipe:any)=>recipe.id===value.interruption.recipe)?.label||'中断的配方'})}>核对中断配方</button>}</div>}
    {value.runs?.some((record:any)=>record.status==='unknown')&&<p className="enigma-source-note">历史中断记录不会变成执行成功。{!value.interruption?'当前已无待释放的配方占用。':''}<button onClick={()=>openGroup('timeline')}>核对中断的文件影响</button></p>}
    {control.error&&<p className="enigma-error" role="alert">{control.error}</p>}
  </section>;
}
export function RecipeRunRecord({value,name,evidence,report,reporting}:{value:any;name?:string;evidence:(value:any)=>ReactNode;report?:()=>void;reporting?:boolean}){
  const run=value.run,status=value.status||run.status;
  return <article className="enigma-recipe-card"><strong>{value.recipeLabel||name||run.recipe} · 修订 {run.revision}</strong><p>{status==='running'?'配方正在执行':status==='passed'?value.current?'本版本步骤与原检查通过':'原运行通过，当前来源或依据已变化':status==='cancelled'?'配方已停止，已完成步骤的效果保留':status==='unknown'?'运行结果待核对，不能自动重放':'配方未通过，请核对失败步骤'}</p><small>{displayTime(run.createdAt)}</small>
    <ol>{run.steps.map((step:any)=><li key={step.id}><strong>{step.id} · {step.state==='running'&&status!=='running'?'中断时仍在执行，结果待核对':step.state==='passed'&&step.kind!=='verify'?'步骤完成':operationLabel(step.state)}</strong>{step.data?.output&&<details><summary>查看输出</summary><pre>{step.data.output}</pre></details>}{step.kind==='verify'&&step.data?.results?.map((check:any)=><p key={check.check}>{check.check} · {operationLabel(check.status)}</p>)}</li>)}</ol>
    {run.error&&<details className="enigma-error"><summary>运行失败原因</summary><pre>{run.error}</pre></details>}
    <details className="enigma-result"><summary>本次参数与完整回执</summary>{evidence(value)}</details>
    {report&&<button disabled={reporting} onClick={report}>查看本次运行报告</button>}
  </article>;
}
