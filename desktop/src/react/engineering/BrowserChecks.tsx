import type {ReactNode} from 'react';
import {useEngineering,showAction,showRecordAction,readRecordAction,openEngineering,type Action} from './state';
import {useSideAction} from './useSideAction';
import {displayTime,operationLabel} from './interaction-copy';
const actions:Record<string,string>={goto:'打开页面',click:'点击',check:'勾选',uncheck:'取消勾选',wait:'等待元素',fill:'填写',select:'选择',press:'按键',expect:'核对内容',screenshot:'截图'};
export function BrowserChecks({value,blocked}:{value:any;blocked:boolean}){
 const snapshot=useEngineering(s=>s.snapshot),sessionPath=useEngineering(s=>s.sessionPath),control=useSideAction(sessionPath,'browser-reports');
 const configured:Action[]=snapshot?.actions||[],create=configured.find(action=>action.id==='browser-add');
 const reports=value.browserReports||{items:[],total:0,unavailable:0};
 return <section><h3>浏览器验收</h3><p className="enigma-source-note">按预先登记的页面步骤检查行为。服务必须先就绪；成功只说明这些步骤通过，不代替原项目检查。</p>{create&&<button disabled={blocked} onClick={()=>void showAction(create)}>配置浏览器场景</button>}
 {(value.scenarios||[]).map((scenario:any)=>{const service=value.services?.find((item:any)=>item.service.id===scenario.service);return <article className="enigma-recipe-card" key={scenario.id}><strong>{scenario.label}</strong><p>服务：{service?.service.label||scenario.service} · {scenario.steps.length} 步 · {service?.ready?'当前已就绪':'需要先启动并核对服务'}</p><details><summary>查看页面步骤</summary><ol>{scenario.steps.map((step:any,index:number)=><li key={index}>{actions[step.action]||step.action} {step.selector||step.path||step.label}{step.includes?` · 预期：${step.includes}`:''}{step.value?` · 输入：${step.value}`:''}{step.key?` · 按键：${step.key}`:''}</li>)}</ol></details>{configured.some(action=>action.id==='browser-run')&&<button disabled={blocked||!service?.ready} data-tooltip={service?.ready?'实际执行这些页面操作并保留截图和轨迹':'先在上方启动服务；来源或依赖变化时需要重启'} onClick={()=>void showRecordAction('browser-run',{id:scenario.id},{id:scenario.label})}>运行这个场景</button>}</article>;})}
 {reports.total>reports.items.length&&<p>显示最近 {reports.items.length} / {reports.total} 次浏览器运行。</p>}{reports.unavailable>0&&<p className="enigma-error">{reports.unavailable} 份报告暂不可读。</p>}
 {reports.items.map((item:any)=><article className="enigma-recipe-card" key={item.report.id}><strong>{item.scenarioLabel||item.report.scenario}</strong><p>{operationLabel(item.report.status)} · {displayTime(item.report.createdAt)} · {item.sourceCurrent&&item.configurationCurrent&&item.serviceCurrent?'来源与配置仍一致':'来源、配置或服务运行已变化'}</p><button disabled={!!control.busy} onClick={()=>void control.run(item.report.id,()=>readRecordAction('browser-report',{id:item.report.id}))}>查看本次浏览器报告</button></article>)}
 {control.error&&<p role="alert" className="enigma-error">{control.error}</p>}
 </section>;
}
export function BrowserReportResult({value,details}:{value:any;details:ReactNode}){
 const report=value.report;
 return <section className="enigma-browser-report"><h3>浏览器验收：{value.scenarioLabel||report.scenario}</h3><p>{operationLabel(report.status)} · {displayTime(report.createdAt)}</p><p className="enigma-source-note">本次读取时，{value.sourceCurrent&&value.configurationCurrent&&value.serviceCurrent?'来源、场景和服务运行仍一致。':'源码、场景或服务运行已变化，旧结果不能算作当前验收。'}{!value.serviceReady?'当前服务未就绪。':''}</p>
 <ol>{report.steps.map((step:any)=><li key={step.index}>{actions[step.action]||step.action} · {operationLabel(step.status)}{step.error&&<details><summary>失败详情</summary><pre className="enigma-runtime-log">{step.error}</pre></details>}</li>)}</ol>
    {report.artifactErrors?.map((error:string,index:number)=><p className="enigma-error" key={index}>{error}</p>)}
 {report.errors.length>0&&<details className="enigma-error"><summary>{report.errors.length} 项页面或运行诊断</summary>{report.errors.map((error:string,index:number)=><pre className="enigma-runtime-log" key={index}>{error}</pre>)}</details>}
 {!!report.artifacts?.length&&<div className="enigma-inline-actions">{report.artifacts.map((item:any)=><button key={item.id} data-tooltip={item.kind==='trace'?'打开可下载的浏览器轨迹成果':'查看这次运行保存的真实截图'} onClick={()=>openEngineering({id:`artifact:${item.id}`,title:item.title,group:'artifacts',artifact:item.id})}>{item.kind==='trace'?'查看浏览器轨迹':item.title}</button>)}</div>}
 {!report.artifacts?.length&&report.screenshots.length>0&&<p className="enigma-source-note">该历史报告有截图，文件位置保留在完整记录中。</p>}
 <details className="enigma-result"><summary>完整场景、截图路径与版本</summary>{details}</details></section>;
}
