import {useEffect,useState} from 'react';
import {useStore} from '../../stores';
import {hanaFetch} from '../../hooks/use-hana-fetch';
import {SurfaceMenu,SurfaceModal} from '../../engineering/SurfaceMenu';
import {AppIcon} from '../../ui/app-icons';
import {applyFolder,addWorkspaceFolder,removeWorkspaceFolder} from '../../stores/desk-actions';
import {useEngineering} from '../../engineering/state';
import {sessionScopedValue} from '../../stores/session-slice';
import './RepositoryContext.css';
export interface RepositoryContext {path:string;name:string;git:boolean;branch:string|null}
const requests=new Map<string,Promise<RepositoryContext[]>>();
export function useRepositoryContext(){
 const sp=useStore(s=>s.pendingNewSession?null:s.currentSessionPath),connection=useStore(s=>s.activeServerConnectionId),primary=useStore(s=>s.pendingNewSession?(s.selectedFolder||s.homeFolder):s.deskBasePath||s.selectedFolder||s.homeFolder),extra=useStore(s=>s.workspaceFolders),authorized=useStore(s=>sp?sessionScopedValue(s,s.sessionAuthorizedFoldersByPath,sp):null),engineering=useEngineering(s=>s.snapshot?.root);
 const roots=[...new Set([primary,...extra].filter((value):value is string=>typeof value==='string'&&!!value))],key=JSON.stringify([connection,sp,roots,authorized,engineering]);
 const [result,setResult]=useState<{key:string;rows:RepositoryContext[];error?:string}>();
 useEffect(()=>{let alive=true;let request=requests.get(key);if(!request){request=hanaFetch('/api/enigma/repositories/context',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionPath:sp,roots}),throwOnHttpError:false}).then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error);return data.repositories;});requests.set(key,request);void request.finally(()=>requests.delete(key)).catch(()=>{});}request.then(rows=>{if(alive)setResult({key,rows});}).catch(error=>{if(alive)setResult({key,rows:[],error:error.message});});return()=>{alive=false;};},[key]);
 return {repositories:result?.key===key?result.rows:roots.map(path=>({path,name:path.split(/[\\/]/).at(-1)||path,git:false,branch:null})),error:result?.key===key?result.error:undefined,request:{sessionPath:sp,roots}};
}
export async function addConversationRepository(selected?:string){
 const folder=selected||await window.platform?.selectFolder?.();if(!folder)return;
 const state=useStore.getState(),sp=state.pendingNewSession?null:state.currentSessionPath;
 if(sp){const response=await hanaFetch('/api/sessions/authorized-folders',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:sp,action:'add',folder}),throwOnHttpError:false});const data=await response.json();if(!response.ok)throw Error(data.error);state.setSessionAuthorizedFolders(sp,data.authorizedFolders||[]);}
 else {const r=await hanaFetch('/api/enigma/repositories/context',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roots:[folder]}),throwOnHttpError:false});const data=await r.json();if(!r.ok||!data.repositories?.length)throw Error(data.error||'目录不存在');if(!state.selectedFolder)await applyFolder(folder);else addWorkspaceFolder(folder);}
}
export function RepositoryContextBar({compact=false}:{compact?:boolean}){
 const {repositories,error}=useRepositoryContext(),pending=useStore(s=>!s.currentSessionPath||s.pendingNewSession),selected=useStore(s=>s.selectedFolder),[notice,setNotice]=useState(''),[folderText,setFolderText]=useState('');
 const act=(fn:()=>any)=>void Promise.resolve().then(fn).catch(e=>setNotice(e.message));
 const terminal=(root:string)=>act(async()=>{if(!window.platform?.openTerminal)throw Error('系统终端需在桌面应用中打开');const result=await window.platform.openTerminal(root);if(!result?.ok)throw Error(result?.error||'终端无法打开');});
 return <div className="enigma-repository-context" data-compact={compact||undefined}>
  <SurfaceMenu label="当前仓库与目录" hint="查看本对话的仓库、当前分支与工作目录" icon={<><AppIcon name="project" size={15}/><span>{compact?(repositories.length>1?`${repositories.length} 个仓库／目录`:repositories[0]?.name||'选择仓库'):'仓库与目录'}</span></>}>
   {repositories.map((repo,index)=><section className="enigma-repository-item" key={repo.path}><strong>{repo.name}</strong><small>{repo.path}</small><p>{repo.git?`分支 · ${repo.branch}`:'工作目录 · 未启用 Git'}{index===0?' · 主目录':''}</p><div><button onClick={()=>window.platform?.openFolder?.(repo.path)}>打开目录</button>{window.platform?.openTerminal&&<button onClick={()=>terminal(repo.path)}>打开终端</button>}{pending&&repo.path!==selected&&index>0&&<button onClick={()=>removeWorkspaceFolder(repo.path)}>移除</button>}</div></section>)}
   {window.platform?.openTerminal?<button onClick={()=>act(addConversationRepository)}>添加仓库或目录</button>:<div><label>添加服务器目录<input aria-label="添加服务器目录" placeholder="/path/to/repository" value={folderText} onChange={e=>setFolderText(e.target.value)}/></label><button disabled={!folderText.trim()} onClick={()=>act(()=>addConversationRepository(folderText.trim()))}>添加目录</button></div>}
   {error&&<p role="status">{error}</p>}
  </SurfaceMenu>
  {!compact&&repositories.map((repo,index)=><span className="enigma-repository-chip" key={repo.path} title={repo.path}><AppIcon name="project" size={13}/>{repo.name}{repo.git&&<small>{repo.branch}</small>}{index===0&&<small>主目录</small>}</span>)}
  {notice&&<span role="status">{notice}</span>}
 </div>;
}
export function TerminalChooser({close}:{close:()=>void}){
 const {repositories}=useRepositoryContext(),[error,setError]=useState('');
 return <SurfaceModal onClose={close}><div className="enigma-modal-backdrop"><section className="enigma-connect-dialog" role="dialog" aria-modal="true" aria-label="打开工作目录终端"><header><h3>打开终端</h3><button onClick={close} aria-label="关闭终端选择"><AppIcon name="close" size={16}/></button></header><p>选择终端的工作目录。这里只打开终端，不执行项目命令。</p>{repositories.map(repo=><button className="enigma-terminal-root" key={repo.path} onClick={async()=>{if(!window.platform?.openTerminal){setError('系统终端需在桌面应用中打开');return;}const result=await window.platform.openTerminal(repo.path);if(result?.ok)close();else setError(result?.error||'终端打开失败');}}><AppIcon name="command" size={16}/><span>{repo.name}<small>{repo.path}</small></span></button>)}{!repositories.length&&<p>请先选择仓库或工作目录。</p>}{error&&<p role="alert">{error}</p>}</section></div></SurfaceModal>;
}
