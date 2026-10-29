import {useState,type ReactNode} from 'react';
import {useStore} from '../stores';
import {switchSession} from '../stores/session-actions';
import {useEngineering,showAction,readRecordAction,type Action} from './state';
import {useSideAction} from './useSideAction';
import {displayTime} from './interaction-copy';

export function packageRestoreAction(action:Action,value:any):Action {
  return {...action,fields:action.fields.map(field=>field.name==='directory'?{...field,kind:'record',value:value.directory,displayValue:value.directory}:field.name==='expectedManifest'?{...field,kind:'record',value:value.manifestHash,displayValue:`已核对 · ${value.manifestHash.slice(0,12)}`}:
    field.name==='writeRepos'?{...field,source:undefined,items:value.manifest.repos.map((item:any)=>({value:item.repo.id,label:`${item.repo.id} · ${item.repo.role||'仓库'}`})),value:[]}:field)};
}

export function TaskPackageResult({value,details}:{value:any;details:ReactNode}) {
  const manifest=value.manifest,snapshot=useEngineering(s=>s.snapshot),sessionPath=useEngineering(s=>s.sessionPath),readOnly=useStore(s=>s.sessionPermissionMode==='read_only'),control=useSideAction(sessionPath,'package');
  const [technical,setTechnical]=useState(false);
  const busy=!!control.busy||snapshot?.state?.idle===false||snapshot?.state?.operation?.state==='running',restore=snapshot?.actions?.find((action:Action)=>action.id==='package-restore');
  const files=manifest.repos.reduce((count:number,item:any)=>count+Object.keys(item.files||{}).length,0);
  return <section className="enigma-package-result">
    <h3>{value.packageInspection?'任务包内容已核对':'任务包已导出'}</h3><strong>{manifest.goal}</strong>
    <p className="enigma-source-note">{displayTime(manifest.createdAt)} · {manifest.repos.length} 个仓库 · {files} 个文件 · {(manifest.bytes/1024).toFixed(1)} KB</p>
    <p>这是代码和所选背景的快照。导入会创建新的工作目录；写权限在下一步选择，原验收结果只作为历史来源。</p>
    <p className="enigma-source-note">任务包目录：{value.directory}</p>
    <div className="enigma-inline-actions">{value.packageInspection&&restore?<button disabled={readOnly||busy||!!manifest.unresolved.length} data-tooltip={readOnly?'当前对话只读，不能复现任务包':manifest.unresolved.length?'原任务包还有未确认效果，先处理来源任务':'选择新目录与包内仓库写权限；执行前再次核对这份包的版本'} onClick={()=>void showAction(packageRestoreAction(restore,value))}>在新目录复现这份任务包</button>:<button disabled={busy} onClick={()=>void control.run('inspect',()=>readRecordAction('package-inspect',{directory:value.directory}))}>检查包内容并准备复现</button>}</div>
    {!!manifest.unresolved.length&&<p className="enigma-error">来源任务还有 {manifest.unresolved.length} 项执行效果待核对，当前不能创建可执行的复现任务。</p>}
    <h4>包内仓库</h4>{manifest.repos.map((item:any)=><article className="enigma-repo" key={item.repo.id}><div><strong>{item.repo.id}</strong><p>{item.repo.role||'职责未填写'} · {Object.keys(item.files).length} 个文件</p><p className="enigma-source-note">{item.directory}{item.repo.dependsOn?.length?` · 依赖 ${item.repo.dependsOn.join('、')}`:''}</p></div></article>)}
    <h4>携带的背景</h4><p>{manifest.notes.length} 条来源消息 · {manifest.materials.length} 份资料 · {manifest.artifacts.length} 项成果 · {manifest.memories.length} 条历史记忆</p>
    <p className="enigma-source-note">历史记忆与旧验收不会自动成为新任务的有效记忆或通过记录。</p>
    {!!manifest.notes.length&&<details><summary>查看来源消息与原要求</summary>{manifest.notes.map((note:any,index:number)=><article className="enigma-step" key={index}><div><strong>{({user:'用户',assistant:'助手',source:'来源资料'} as any)[note.role]||'来源'} · {({background:'背景',requirement:'要求',decision:'决定',observation:'观察'} as any)[note.kind]||note.kind}</strong><p>{note.text}</p></div></article>)}</details>}
    <details><summary>检查、服务与配方定义</summary><p>{manifest.runtime.checks.length} 项原检查 · {manifest.runtime.services.length} 项服务 · {manifest.runtime.recipes.length} 份配方。导入时可以选择是否登记这些定义。</p>{manifest.runtime.checks.map((check:any)=><article className="enigma-recipe-card" key={check.id}><strong>{check.id} · {check.repo}</strong><pre>{check.argv.join('\n')}</pre></article>)}</details>
    {control.error&&<p className="enigma-error" role="alert">{control.error}</p>}
    <details className="enigma-result" onToggle={event=>setTechnical(event.currentTarget.open)}><summary>完整包清单与证据</summary>{technical&&details}</details>
  </section>;
}

export function RestoredPackageResult({value,details}:{value:any;details:ReactNode}) {
  const [technical,setTechnical]=useState(false);
  return <section className="enigma-package-result"><h3>任务包已在新目录复现</h3><p>{value.goal}</p><p className="enigma-source-note">工作目录：{value.workspace}</p>
    <ul>{value.repos.map((repo:any)=><li key={repo.id}>{repo.id} · {repo.access==='write'?'允许写入':'只读'}</li>)}</ul>
    <p>{value.runtimeActivated?'已登记原检查与服务定义，尚未启动或执行。':'当前只复现代码与背景，未启用原检查和服务定义。'}原来源的通过结果没有计入新任务验收。</p>
    {value.createdSession?.sessionPath&&<button onClick={()=>void switchSession(value.createdSession.sessionPath)}>打开复现后的工作对话</button>}
    {!!value.materials?.some((item:any)=>item.skipped)&&<p className="enigma-source-note">部分来源资料在导出时已经过期，未作为有效资料导入。</p>}
    <details className="enigma-result" onToggle={event=>setTechnical(event.currentTarget.open)}><summary>完整复现记录</summary>{technical&&details}</details>
  </section>;
}
