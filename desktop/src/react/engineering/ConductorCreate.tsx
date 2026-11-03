import {SurfaceModal} from './SurfaceMenu';
import {useState} from 'react';
import {useStore} from '../stores';
import {loadSessions,switchSession} from '../stores/session-actions';
import {useEngineering,engineeringRequest} from './state';
import {useRepositoryContext} from '../components/chat/RepositoryContext';
import {hanaFetch} from '../hooks/use-hana-fetch';
import {FormSelectControl} from './FormSelect';
import {AppIcon} from '../ui/app-icons';
import './ConductorPage.css';

export function ConductorCreateDialog({close,embedded=false}:{close:()=>void;embedded?:boolean}){
 const models=useStore(s=>s.models),currentPath=useStore(s=>s.currentSessionPath)||'',connection=useStore(s=>s.activeServerConnectionId),snapshot=useEngineering(s=>s.snapshot);
 const {repositories,loading:repositoriesLoading}=useRepositoryContext();
 const [sourcePath]=useState(currentPath),[sourceConnection]=useState(connection);
 const initial=snapshot?.modelPolicy||useStore.getState().pendingNewSessionModelPolicy;
 const key=(model:any)=>model?`${model.provider}/${model.id}`:'';
 const defaultModel=key(initial?.execution)||key(models.find(m=>m.isCurrent)||models[0]);
 const [mode,setMode]=useState(initial?.mode||'delegated'),[main,setMain]=useState(defaultModel),[worker,setWorker]=useState(key(initial?.worker)||defaultModel),[planner,setPlanner]=useState(key(initial?.planning)||defaultModel),[reviewer,setReviewer]=useState(key(initial?.review)||defaultModel);
 const [parallel,setParallel]=useState(2),[maximum,setMaximum]=useState(8),[rewind,setRewind]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const server=useStore(s=>s.activeServerConnection),nativePicker=!!window.hana&&server?.kind==='local'&&typeof window.platform?.selectFolder==='function';
 type Repo={path:string;name:string;git:boolean;gitRoot?:string|null;branch:string|null};
 const [extraRoots,setExtraRoots]=useState<Repo[]>([]),[rootText,setRootText]=useState(''),[adding,setAdding]=useState(false),[access,setAccess]=useState<Record<string,'none'|'read'|'write'>>({});
 // A conversation folder inside a repository is offered as its repository root, which is what the conductor registers.
 const asRoot=(r:Repo):Repo=>r.git&&r.gitRoot&&r.gitRoot!==r.path?{...r,path:r.gitRoot,name:r.gitRoot.split(/[\\/]/).at(-1)||r.gitRoot}:r;
 const available=[...new Map([...(repositories as Repo[]),...extraRoots].map(asRoot).map(r=>[r.path,r] as const)).values()];
 const modelOptions=models.map(m=>({value:key(m),label:m.name||m.id,group:m.provider}));
 const selectModel=(label:string,value:string,change:(value:string)=>void)=><label><span>{label}</span><FormSelectControl label={label} value={value} onChange={change} options={modelOptions}/></label>;
 const add=async()=>{if(adding)return;setError('');
  const root=nativePicker?await window.platform!.selectFolder():rootText.trim();if(!root)return;
  setAdding(true);
  try{const r=await hanaFetch('/api/enigma/repositories/context',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roots:[root]})}),data=await r.json().catch(()=>null);
   if(!r.ok)throw Error(data?.error||'无法读取该目录');const found=(data?.repositories||[])[0];if(!found)throw Error('无法读取该目录');const repo=asRoot(found);
   if(!repo.git)throw Error(`${repo.name} 不是 Git 仓库，管家只能登记 Git 仓库`);
   setExtraRoots(old=>[...old.filter(x=>asRoot(x).path!==repo.path),repo]);setAccess(old=>({...old,[repo.path]:old[repo.path]&&old[repo.path]!=='none'?old[repo.path]:'read'}));setRootText('');
  }catch(e){setError(e instanceof Error?e.message:'添加仓库失败');}finally{setAdding(false);}
 };
 const create=async()=>{
  if(busy)return;setBusy(true);setError('');
  try{
   if(sourcePath!==(useStore.getState().currentSessionPath||'')||sourceConnection!==useStore.getState().activeServerConnectionId)throw Error('对话已切换，请重新打开管家创建页');
   const role=(value:string)=>{const m=models.find(m=>key(m)===value);if(!m)throw Error('请选择可用模型');return {provider:m.provider,id:m.id};};
   const phased=mode==='plan-execute'||mode==='adaptive';
   const policy={mode,execution:role(main),...(mode==='delegated'||phased?{worker:role(worker)}:{}),...(phased?{planning:role(planner),review:role(reviewer)}:{})};
   const selected=available.filter(r=>access[r.path]&&access[r.path]!=='none').map(r=>({root:r.path,access:access[r.path]}));
   const selectedModels=[main,...(mode==='delegated'||phased?[worker]:[]),...(phased?[planner,reviewer]:[])];
   const result=await engineeringRequest('/conductor/new',sourcePath,{agentId:useStore.getState().currentAgentId,modelPolicy:policy,...(selected.length?{repositories:selected}:{}),limits:{maxConcurrent:parallel,maxTasks:maximum,writableRepos:[],allowedModels:[...new Set(selectedModels)],allowRewind:rewind}});
   await loadSessions();
   if(sourcePath!==(useStore.getState().currentSessionPath||'')||sourceConnection!==useStore.getState().activeServerConnectionId){setError('会话或服务已切换，管家已创建，可从列表打开');return;}
   close();useStore.getState().setActivePanel(null);await switchSession(result.sessionPath);
  }catch(e){setError(e instanceof Error?e.message:'创建失败');}finally{setBusy(false);}
 };
 const content=<section className="enigma-conductor-create" aria-label="创建任务管家">
  {!embedded&&<header><h2>新建任务管家</h2><button onClick={close} aria-label="关闭管家创建"><AppIcon name="close" size={16}/></button></header>}
  <p className="enigma-page-description">把一项目标拆成工作对话，分别安排模型、跟踪结果，再统一检查。先选择工作范围与模型，创建后在管家对话里交代目标。</p>
  <fieldset disabled={busy}>
   <section><h3>工作范围</h3><p>选择管家可以读取或修改的仓库。没有代码任务时可以留空，照常处理资料和安排工作。</p>
    <div className="enigma-conductor-repos">{available.map(repo=><div key={repo.path}><AppIcon name="project" size={17}/><span><strong>{repo.name}</strong><small>{repo.path}</small>{!repo.git&&<small>{repositoriesLoading?'正在识别仓库…':'普通目录：代码协作请选择 Git 仓库；资料可在创建后附加。'}</small>}</span><select aria-label={`${repo.name} 工作权限`} value={access[repo.path]||'none'} disabled={!repo.git} onChange={e=>setAccess({...access,[repo.path]:e.target.value as any})}><option value="none">不参与</option><option value="read">只读</option><option value="write">可修改</option></select></div>)}</div>
    <div className="enigma-conductor-add">{!nativePicker&&<input aria-label="仓库根目录" placeholder={server&&server.kind!=='local'?'服务器上的仓库根目录路径':'仓库根目录路径'} value={rootText} onChange={e=>setRootText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void add();}}}/>}<button type="button" disabled={adding||(!nativePicker&&!rootText.trim())} onClick={()=>void add()}><AppIcon name="add" size={15}/>{adding?'正在检查…':'添加仓库'}</button></div>
   </section>
   <section><h3>模型编排</h3><p>主模型负责组织工作，子模型执行分配的任务；可以使用不同模型。</p>
    <label><span>工作方式</span><select aria-label="管家模型编排方式" value={mode} onChange={e=>setMode(e.target.value)}><option value="single">单模型</option><option value="delegated">主模型 + 子模型</option><option value="plan-execute">规划 → 执行 → 复核</option><option value="adaptive">按任务进展切换阶段</option></select></label>
    <div className="enigma-conductor-models">{selectModel(mode==='plan-execute'||mode==='adaptive'?'执行模型':'主模型',main,setMain)}{mode!=='single'&&selectModel('子任务模型',worker,setWorker)}{(mode==='plan-execute'||mode==='adaptive')&&<>{selectModel('规划模型',planner,setPlanner)}{selectModel('复核模型',reviewer,setReviewer)}</>}</div>
    {!models.length&&<p>请先在设置的供应商页面配置模型。</p>}
   </section>
   <section><h3>执行安排</h3><div className="enigma-conductor-models"><label><span>同时工作数</span><input aria-label="同时工作数" type="number" min="1" max="4" value={parallel} onChange={e=>setParallel(Number(e.target.value))}/></label><label><span>这组任务的对话总数上限</span><input aria-label="工作对话上限" type="number" min="1" max="12" value={maximum} onChange={e=>setMaximum(Number(e.target.value))}/></label></div><label className="enigma-conductor-check"><input type="checkbox" checked={rewind} onChange={e=>setRewind(e.target.checked)}/>允许管家恢复自己创建的工作对话</label></section>
  </fieldset>
  {error&&<p role="alert" className="enigma-error">{error}</p>}
  <footer><button onClick={close}>取消</button><button className="enigma-primary" disabled={busy||!models.length} onClick={()=>void create()}>{busy?'正在创建管家…':'创建管家对话'}</button></footer>
 </section>;
 return embedded?content:<SurfaceModal onClose={close}><div className="enigma-modal-backdrop"><div className="enigma-modal enigma-surface-card" data-glass-frame="sheet">{content}</div></div></SurfaceModal>;
}
