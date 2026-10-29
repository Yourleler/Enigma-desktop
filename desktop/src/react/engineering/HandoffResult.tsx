import {useState,type ReactNode} from 'react';
import {MarkdownContent} from '../components/chat/MarkdownContent';
import {renderMarkdown} from '../utils/markdown';
import {readRecordAction,useEngineering} from './state';
import {useSideAction} from './useSideAction';
import {displayTime} from './interaction-copy';

const modes:Record<string,string>={background:'沿用背景，开始新目标',continue:'继续原任务',alternative:'比较另一种方案'};
export function HandoffResult({value,details}:{value:any;details:ReactNode}){
 const manifest=value.manifest||value,directory=value.directory||value.path,inspected=typeof value.safeToContinue==='boolean';
 const sessionPath=useEngineering(s=>s.sessionPath),control=useSideAction(sessionPath),[copied,setCopied]=useState(false),[copyError,setCopyError]=useState(''),[technical,setTechnical]=useState(false);
 const copy=async()=>{setCopyError('');try{await navigator.clipboard.writeText(value.document);setCopied(true);}catch{setCopyError('复制未完成，可以展开正文手动选择复制，或读取下方文件。');}};
 return <section className="enigma-handoff-result"><h3>{inspected?value.safeToContinue?'交接已核对：代码版本一致':'交接需要重新核对当前状态':value.delta?'差量交接已导出':'交接背景已导出'}</h3>
 <strong>{manifest.goal}</strong><p className="enigma-source-note">{modes[manifest.mode]||manifest.mode} · {displayTime(manifest.createdAt)}</p>
 <p>{manifest.mode==='background'?'只沿用所选背景，旧任务计划不会在新目标中自动启动。':'原计划与要求作为接续依据；接收方仍需读取当前代码并重新验收。'}这份交接不复制代码，也不自动发送给其他 Agent。</p>
 {inspected&&<p className="enigma-source-note">这是本次核对的状态；后续文件、记忆或验收变化时，请重新核对。</p>}
 {!!value.delta?.omittedUnchangedBackground&&<p className="enigma-error">此差量省略了 {value.delta.omittedUnchangedBackground} 条已分享背景。接收方若没看过上一份交接，需要同时取得它；不能猜测省略内容。原用户要求仍在本份中。</p>}
 <div className="enigma-inline-actions">{directory&&<button disabled={!!control.busy} onClick={()=>void control.run('inspect',()=>readRecordAction('handoff-inspect',{directory}))}>{inspected?'重新核对这份交接':'核对这份交接'}</button>}{value.document&&<button onClick={()=>void copy()} data-tooltip="复制交接正文，可贴到其他Agent；不会自动创建或发送任务">{copied?'已复制交接正文':'复制交接正文'}</button>}</div>
 {copyError&&<p role="alert">{copyError}</p>}{control.error&&<p role="alert" className="enigma-error">{control.error}</p>}
 <p className="enigma-source-note">交接文件：{value.documentPath||`${directory}/handoff.md`}</p>
 <div className="enigma-chips"><span>{manifest.notes.length} 条来源消息</span><span>{manifest.repos.length} 个仓库</span><span>{manifest.evidence.length} 份历史证据</span><span>{manifest.memories.length} 条记忆引用</span></div>
 {inspected&&<><h4>与当前工作区核对</h4>{value.code.map((repo:any)=><p key={repo.repo}><strong>{repo.repo}</strong> · {repo.state==='current'?'代码版本一致':repo.state==='changed'?'代码已变化，请重新阅读和验证':'当前工作区找不到对应仓库'}</p>)}
 {!!value.evidence.length&&<p>{value.evidence.filter((item:any)=>item.current).length} / {value.evidence.length} 份证据在本次核对时仍有效。换工作区后，源证据不算目标执行结果。</p>}
 {!!value.memories.length&&<p>{value.memories.filter((item:any)=>item.state==='current').length} / {value.memories.length} 条引用在当前权限和版本下可用；过期、忘记或其他任务的私有记忆不带入正文。</p>}
 {!!value.warnings.length&&<div className="enigma-handoff-warnings">{value.warnings.map((warning:string,index:number)=><p key={index} className="enigma-source-note">{handoffWarning(warning)}</p>)}</div>}</>}
 {value.document&&<details className="enigma-result"><summary>阅读完整交接正文</summary><MarkdownContent html={renderMarkdown(value.document)}/></details>}
 <details className="enigma-result" onToggle={event=>setTechnical(event.currentTarget.open)}><summary>来源、版本与完整记录</summary>{technical&&details}</details>
 </section>;
}
function handoffWarning(value:string){
 if(value.startsWith('This delta omits'))return '差量交接省略了已分享背景，必要时同时查阅上一份交接。';
 return ({'Memory source is outside the target workspace; omitted until explicitly mapped and revalidated.':'记忆来源不在当前工作区，已省略，需要映射并重新核对后才能引用。','Unknown source/target effects require inspection before continuation.':'来源或当前任务有未知执行效果，需要先核对再继续。','Code context changed or is unavailable; no historical acceptance is activated.':'代码版本变化或仓库不可用，旧验收没有作为当前通过结果。','Source and target workspace differ; target configuration and permissions take precedence.':'当前工作区与来源不同，沿用当前配置与权限。','Code changed during import inspection; retry from a stable target state.':'核对期间代码发生变化，请在修改结束后重试。'} as Record<string,string>)[value]||value;
}
