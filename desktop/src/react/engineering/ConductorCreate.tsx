import { useState } from 'react';
import { useStore } from '../stores';
import { switchSession } from '../stores/session-actions';
import { useEngineering,engineeringRequest } from './state';

export function ConductorCreateDialog({close}:{close:()=>void}){
  const state=useEngineering(),models=useStore(s=>s.models),repos=state.snapshot?.overview?.repositories||[];
  const [parallel,setParallel]=useState(2),[maximum,setMaximum]=useState(8),[writeRepos,setWriteRepos]=useState<string[]>(repos.filter((repo:any)=>repo.access==='write').map((repo:any)=>repo.id));
  const [allowedModels,setAllowedModels]=useState<string[]>([`${state.snapshot?.state?.chat?.provider}/${state.snapshot?.state?.chat?.model}`]),[rewind,setRewind]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const toggle=(values:string[],value:string,set:(values:string[])=>void)=>set(values.includes(value)?values.filter(item=>item!==value):[...values,value]);
  const create=async()=>{setBusy(true);setError('');try{const result=await engineeringRequest('/conductor/new',state.sessionPath,{limits:{maxConcurrent:parallel,maxTasks:maximum,writableRepos:writeRepos,allowedModels,allowRewind:rewind}});close();await switchSession(result.sessionPath);}catch(error){setError(String(error));}finally{setBusy(false);}};
  return <div className="enigma-modal-backdrop"><section className="enigma-modal enigma-glass" role="dialog" aria-modal="true" aria-label="创建任务编排管家"><header><h2>把目标交给管家</h2><button onClick={close}>关闭</button></header><p>管家使用一个独立对话组织工作。你可以交代任何符合下方范围的目标，不必预先决定要拆几个任务。</p>
    <label className="enigma-field"><span>最多同时运行几个工作对话</span><input type="number" min="1" max="4" value={parallel} onChange={event=>setParallel(Number(event.target.value))}/></label>
    <label className="enigma-field"><span>这组任务最多创建几个对话</span><input type="number" min="1" max="12" value={maximum} onChange={event=>setMaximum(Number(event.target.value))}/></label>
    <div className="enigma-field"><span>允许改代码的仓库</span>{repos.filter((repo:any)=>repo.access==='write').map((repo:any)=><label key={repo.id}><input type="checkbox" checked={writeRepos.includes(repo.id)} onChange={()=>toggle(writeRepos,repo.id,setWriteRepos)}/>{repo.id}</label>)}<small>不勾选则只读。每个工作对话使用独立代码工作区。</small></div>
    <div className="enigma-field"><span>允许使用的模型</span>{models.map(model=>{const key=`${model.provider}/${model.id}`;return <label key={key}><input type="checkbox" checked={allowedModels.includes(key)} onChange={()=>toggle(allowedModels,key,setAllowedModels)}/>{model.name||model.id}</label>;})}</div>
    <label className="enigma-field"><span><input type="checkbox" checked={rewind} onChange={event=>setRewind(event.target.checked)}/>允许管家恢复自己创建的工作对话</span><small>恢复会检查旧执行、原要求和当前代码；不会扩大权限或改动验收标准。</small></label>
    {error&&<p className="enigma-error">{error}</p>}<button className="enigma-primary" onClick={()=>void create()} disabled={busy||!allowedModels.length}>{busy?'正在创建…':'创建管家对话'}</button>
  </section></div>;
}
