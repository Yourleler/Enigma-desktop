import type { ReactNode } from 'react';
import { useStore } from '../stores';
import { engineeringRequest, showRecordAction,showAction,readRecordAction,useEngineering,type Action } from './state';
import { useSideAction } from './useSideAction';
import { useSideQuery } from './useSideQuery';
import { displayTime, operationLabel,executionHint } from './interaction-copy';
import {BrowserChecks} from './BrowserChecks';

export function serviceEditAction(action:Action,item:any):Action {
  const service=item.service;
  const values={...service,version:item.configuration,envFromServices:Object.entries(service.envFromServices||{}).map(([name,value]:[string,any])=>({name,...value}))};
  return {...action,title:'保存服务配置',description:'保存新的启动配置，不会启动进程。正在运行或效果未知的服务需要先停止并核对。',fields:action.fields.map(field=>({...field,value:values[field.name],...(['id','version'].includes(field.name)?{kind:'record',source:undefined,label:field.name==='id'?'正在编辑的服务':'配置版本',help:field.name==='id'?'名称可以修改，服务关联保持不变。':'保存时再次核对版本，避免覆盖其他修改。',displayValue:field.name==='id'?service.label:'已自动带入'}:{})}))};
}
export function RuntimeLog({state}:{state:any}) {
  return <>{state?.output?<pre className="enigma-runtime-log">{state.output}</pre>:<p className="enigma-source-note">还没有捕获到输出，安静本身不代表没有进展。</p>}{state?.truncated&&<p>当前只保留部分输出，不能当作完整日志。</p>}{state?.error&&<p className="enigma-error">{state.error}</p>}{executionHint(state?.output)&&<p className="enigma-source-note">{executionHint(state.output)}</p>}{state?.exitCode!==undefined&&state.exitCode!==null&&<p>退出码：{state.exitCode}</p>}</>;
}
const serviceHint=(item:any)=>({
  'ready':'就绪检查通过，服务可供当前任务使用；不代表任务验收完成。',
  'source-changed':'源码已变化，进程仍可能运行旧代码；需要重启后再验证。',
  'dependency-changed':'上游服务已换了一次运行，需要重启本服务以更新连接。',
  'configuration-changed':'启动配置已经变化，需要先核对再重启。',
  'readiness-timeout':'在规定时间内没有满足就绪条件。进程可能仍在运行，可以查看日志、停止或重启。',
  'unknown':item.reconciled?'原运行效果已核对，可以显式重新启动；原中断记录保留。':'当前运行身份或效果不明，先核对原进程与日志。',
  'running':item.service.readiness?'进程正在运行，尚未满足就绪条件。':'进程正在运行，但没有配置就绪条件，不能据此判断服务可用。',
  'not-started':'尚未启动。展开配置可查看命令、依赖和就绪条件。',
} as Record<string,string>)[item.status];

export function EnvironmentPanel({ initial, evidence }: { initial:any; evidence:(value:any)=>ReactNode }) {
  const sessionPath=useEngineering(s=>s.sessionPath),snapshot=useEngineering(s=>s.snapshot);
  const query=useSideQuery<any>('/data/environment',sessionPath),control=useSideAction(sessionPath);
  const readOnly=useStore(s=>s.sessionPermissionMode==='read_only'),value=query.data||initial;
  const taskBusy=snapshot?.state?.idle===false||snapshot?.state?.operation?.state==='running',blocked=readOnly||taskBusy||!!query.error||!!control.busy;
  const actions:Action[]=snapshot?.actions||[],action=(id:string)=>actions.find(item=>item.id===id);
  const stop=(kind:'service'|'background'|'wait',id:string)=>control.run(`${kind}:${id}`,()=>engineeringRequest('/runtime/cancel',sessionPath,{kind,id}),()=>query.refresh());
  const stopping=(kind:string,id:string)=>control.busy===`${kind}:${id}`;
  const services=value.services||[],currentServiceRuns=new Set(services.map((item:any)=>item.run)),background=(value.background||[]).filter((item:any)=>!currentServiceRuns.has(item.spec.id));
  const serviceName=(id:string)=>services.find((item:any)=>item.service.id===id)?.service.label||id;
  return <div className="enigma-environment">
    <p className="enigma-feature-intro">服务持续运行，供页面或接口使用；后台命令执行一次工作；等待器只观察结果，取消等待不会停止目标。</p>
    <div className="enigma-inline-actions">{[['service-add','配置项目服务'],['background-start','运行后台命令'],['wait-start','等待一个结果']].map(([id,title])=>action(id)&&<button key={id} disabled={blocked} onClick={()=>void showAction(action(id)!)}>{title}</button>)}</div>
    <p className="enigma-source-note">每 5 秒更新。停止某一项不会停止整个对话。{query.receivedAt>0&&` 最近读取：${displayTime(query.receivedAt)}`}</p>
    {query.error&&<p className="enigma-error" role="status">环境状态暂未更新，以下显示最近记录。<button onClick={()=>void query.refresh()}>重新读取环境</button></p>}
    {control.error&&<p className="enigma-error" role="alert">{control.error}</p>}
    <h3 className="enigma-section-title">项目服务</h3>
    {!services.length&&<p className="enigma-source-note">还没有登记服务。可先配置命令和就绪条件，保存不会自动启动。</p>}
    {services.map((item:any)=>{
      const running=item.run&&!item.executionTerminal,unknown=item.status==='unknown'&&!item.reconciled;
      return <article className="enigma-step" key={item.service.id}><span aria-hidden="true">{item.ready?'●':'○'}</span><div>
        <strong>{item.service.label}</strong><div className="enigma-chips"><span>{item.status==='cancelled'?'服务已停止':operationLabel(item.status)}</span><span>{item.service.repo}</span>{item.url&&<span>{item.executionTerminal?'上次地址：':''}{item.url}</span>}</div>
        {serviceHint(item)&&<p>{serviceHint(item)}</p>}
        <details className="enigma-result"><summary>启动命令、依赖与就绪条件</summary><pre className="enigma-runtime-log">{item.service.argv.join('\n')}</pre><p>参数逐项传递，不拼接成 shell。</p>{!!item.service.dependsOn?.length&&<p>启动前需要：{item.service.dependsOn.map(serviceName).join('、')}</p>}<p>就绪条件：{item.service.readiness?`${item.service.readiness.type.toUpperCase()} · ${item.service.readiness.path||''} ${item.service.readiness.includes||''} · 最长 ${(item.service.readiness.timeoutMs||30000)/1000} 秒`:'未配置'}</p>{item.service.portPrefix&&<p>从日志前缀读取端口：{item.service.portPrefix}</p>}{item.service.readiness?.port&&<p>固定端口：{item.service.readiness.port}</p>}</details>
        {item.process&&<details className="enigma-result"><summary>服务输出与退出信息</summary><RuntimeLog state={item.process}/></details>}
        <div className="enigma-inline-actions">{running?<button disabled={!!control.busy} data-tooltip="停止当前登记的服务进程，不中断主对话" onClick={()=>void stop('service',item.service.id)}>{stopping('service',item.service.id)?'正在停止…':'停止此服务'}</button>:action('service-start')&&<button disabled={blocked||unknown} onClick={()=>void showRecordAction('service-start',{id:item.service.id},{id:item.service.label})}>启动此服务</button>}
          {item.run&&action('service-restart')&&<button disabled={blocked||unknown} data-tooltip="停止旧实例，按当前配置重启并核对就绪；依赖它的服务可能需要随后重启" onClick={()=>void showRecordAction('service-restart',{id:item.service.id},{id:item.service.label})}>重启此服务</button>}
          {action('service-add')&&item.configuration&&<button disabled={blocked||running||unknown} data-tooltip={running?'停止服务后可以修改启动配置':'预填当前配置，保存时核对版本以避免覆盖其他修改'} onClick={()=>void showAction(serviceEditAction(action('service-add')!,item))}>编辑服务配置</button>}
          {unknown&&item.executionTerminal&&action('background-acknowledge')&&<button disabled={blocked} onClick={()=>void showRecordAction('background-acknowledge',{id:item.run},{id:item.service.label})}>核对中断效果</button>}
        </div>
      </div></article>;
    })}
    <h3 className="enigma-section-title">后台运行记录</h3>
    {!background.length&&<p className="enigma-source-note">暂无独立后台命令。当前服务的输出在上方卡片中。</p>}
    {background.map((item:any)=><article className="enigma-step" key={item.spec.id}><span aria-hidden="true">{!item.terminal?'◌':'○'}</span><div><strong>{item.spec.label}</strong>
      <div className="enigma-chips"><span>{operationLabel(item.state.status)}</span><span>{item.spec.repo}</span>{item.spec.kind==='service'&&<span>历史服务运行</span>}{item.reconciled&&<span>实际效果已核对</span>}</div><small>{displayTime(item.spec.createdAt)}</small>
      <details className="enigma-result"><summary>命令与日志</summary><pre className="enigma-runtime-log">{item.spec.argv.join('\n')}</pre><RuntimeLog state={item.state}/>{item.reconciliation&&<p>核对说明：{item.reconciliation.observation}</p>}<details><summary>完整运行回执</summary>{evidence(item)}</details></details>
      {!item.terminal&&<button disabled={!!control.busy} data-tooltip="取消这条后台命令，不中断主对话" onClick={()=>void stop('background',item.spec.id)}>{stopping('background',item.spec.id)?'正在停止…':'取消此后台任务'}</button>}
      {item.state.status==='unknown'&&!item.reconciled&&item.terminal&&action('background-acknowledge')&&<button disabled={blocked} onClick={()=>void showRecordAction('background-acknowledge',{id:item.spec.id},{id:item.spec.label})}>记录已核对的效果</button>}
    </div></article>)}
    <h3 className="enigma-section-title">等待外部结果</h3>
    {!value.waits?.length&&<p className="enigma-source-note">选择后台命令、服务或其他结果，可以单独等待并按需接续任务。</p>}
    {(value.waits||[]).map((wait:any)=><article className="enigma-step" key={wait.spec.id}><div><strong>{wait.spec.label}</strong>
      <p>{wait.runtimeState==='interrupted'?'等待器已退出，未确认目标结果':wait.runtimeState==='unknown'&&wait.state.status==='waiting'?'等待状态暂不可确认':({waiting:'等待中',completed:'目标已完成',failed:'目标未通过',cancelled:'等待已取消',timeout:'等待超时'} as Record<string,string>)[wait.state.status]||wait.state.status}</p>
      <small>{{github:'GitHub检查',service:'项目服务',delegation:'独立子任务',background:'后台命令'}[wait.spec.condition.kind as string]||'外部结果'} · {wait.state.status==='cancelled'?'已停止自动接续':wait.spec.resume?'结果到达后接续':'只记录结果'}</small>
      {wait.spec.condition.kind==='service'&&<p>{serviceName(wait.spec.condition.service)} · 等待{wait.spec.condition.state==='ready'?'就绪':'停止'}</p>}
      {wait.spec.condition.kind==='background'&&<p>目标：{(value.background||[]).find((run:any)=>run.spec.id===wait.spec.condition.run)?.spec.label||wait.state.result?.label||'历史后台运行'}</p>}
      {wait.spec.condition.kind==='delegation'&&<p>目标：{wait.state.result?.goal||'所选独立子任务'} · 等待执行结束</p>}
      {wait.spec.condition.kind==='github'&&<p>{wait.spec.condition.repo} · 运行 #{wait.spec.condition.run}</p>}
      {wait.state.result?.output&&<details className="enigma-result"><summary>目标的最近输出</summary><pre className="enigma-runtime-log">{wait.state.result.output}</pre></details>}{wait.state.lastError&&<p className="enigma-source-note">{wait.state.lastError}</p>}
      <details className="enigma-result"><summary>等待条件与最近结果</summary>{evidence({condition:wait.spec.condition,state:wait.state})}</details>
      {wait.state.status==='waiting'&&<button disabled={!!control.busy} data-tooltip="停止等待器，目标命令或服务继续运行，也不再自动接续" onClick={()=>void stop('wait',wait.spec.id)}>{stopping('wait',wait.spec.id)?'正在取消…':'取消此等待'}</button>}
    </div></article>)}
    <BrowserChecks value={value} blocked={blocked}/>
  </div>;
}
