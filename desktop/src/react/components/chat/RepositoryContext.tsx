import {ensureSession} from '../../stores/session-actions';
import {dockScope,selectDockTab} from '../../stores/right-dock-store';
import {toggleJianSidebar} from '../../stores/desk-actions';
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
 const roots=[...new Set([primary,...(Array.isArray(extra)?extra:[])].filter((value):value is string=>typeof value==='string'&&!!value))],key=JSON.stringify([connection,sp,roots,authorized,engineering]);
 const [result,setResult]=useState<{key:string;rows:RepositoryContext[];error?:string}>();
 useEffect(()=>{let alive=true;let request=requests.get(key);if(!request){request=hanaFetch('/api/enigma/repositories/context',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionPath:sp,roots}),throwOnHttpError:false}).then(async r=>{const data=await r.json();if(!r.ok)throw Error(data?.error||`HTTP ${r.status}`);return Array.isArray(data?.repositories)?data.repositories:[];});requests.set(key,request);void request.finally(()=>requests.delete(key)).catch(()=>{});}request.then(rows=>{if(alive)setResult({key,rows});}).catch(error=>{if(alive)setResult({key,rows:[],error:error.message});});return()=>{alive=false;};},[key]);
 return {loading:result?.key!==key,repositories:result?.key===key?result.rows:roots.map(path=>({path,name:path.split(/[\\/]/).at(-1)||path,git:false,branch:null})),error:result?.key===key?result.error:undefined,request:{sessionPath:sp,roots}};
}
export async function addConversationRepository(selected?:string){
 const folder=selected||await window.platform?.selectFolder?.();if(!folder)return;
 const state=useStore.getState(),sp=state.pendingNewSession?null:state.currentSessionPath;
 if(sp){const response=await hanaFetch('/api/sessions/authorized-folders',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:sp,action:'add',folder}),throwOnHttpError:false});const data=await response.json();if(!response.ok)throw Error(data.error);state.setSessionAuthorizedFolders(sp,data.authorizedFolders||[]);}
 else {const r=await hanaFetch('/api/enigma/repositories/context',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roots:[folder]}),throwOnHttpError:false});const data=await r.json();if(!r.ok||!data.repositories?.length)throw Error(data.error||'目录不存在');if(!state.selectedFolder)await applyFolder(folder);else addWorkspaceFolder(folder);}
}
export function RepositoryContextBar({compact=false}:{compact?:boolean}){
 const {repositories,error}=useRepositoryContext(),pending=useStore(s=>!s.currentSessionPath||s.pendingNewSession),history=useStore(s=>s.cwdHistory)??[],[notice,setNotice]=useState(''),[folderText,setFolderText]=useState(''),[terminalOpen,setTerminalOpen]=useState(false);
 const act=(fn:()=>any)=>void Promise.resolve().then(fn).catch(e=>setNotice(e.message));
 const main=repositories?.[0],label=main?.name||'选择工作目录';
 return <div className="enigma-repository-context" data-compact={compact||undefined}>
  <SurfaceMenu label="工作目录" panelClassName="enigma-repository-menu" hint="选择工作目录，查看分支或添加其他仓库" icon={<><AppIcon name="project" size={15}/><span>{label}</span>{main?.branch&&<small>{main.branch}</small>}{repositories.length>1&&<small>+{repositories.length-1}</small>}</>}>
   {repositories.map((repo,index)=><section className="enigma-repository-item" key={repo.path}><div className="enigma-repository-heading"><strong>{repo.name}</strong><small>{index===0?'主目录':'附加目录'}{repo.branch?` · ${repo.branch}`:''}</small></div><p title={repo.path}>{repo.path}</p><div className="enigma-repository-actions"><button onClick={()=>window.platform?.openFolder?.(repo.path)}>在文件管理器中打开</button>{pending&&index>0&&<><button onClick={()=>void applyFolder(repo.path)}>设为主目录</button><button onClick={()=>removeWorkspaceFolder(repo.path)}>移除</button></>}</div></section>)}
   {pending&&history.filter(path=>!repositories.some(r=>r.path===path)).slice(0,4).length>0&&<div className="enigma-repository-recent"><small>最近使用</small>{history.filter(path=>!repositories.some(r=>r.path===path)).slice(0,4).map(path=><button key={path} title={path} onClick={()=>void applyFolder(path)}>{path.split(/[\\/]/).at(-1)||path}</button>)}</div>}
   {window.platform?.openTerminal?<button onClick={()=>act(addConversationRepository)}><AppIcon name="add" size={14}/>添加目录</button>:<div><label>服务器目录<input aria-label="添加服务器目录" placeholder="/path/to/repository" value={folderText} onChange={e=>setFolderText(e.target.value)}/></label><button disabled={!folderText.trim()} onClick={()=>act(()=>addConversationRepository(folderText.trim()))}>添加目录</button></div>}
   {error&&<p role="status">{error}</p>}
  </SurfaceMenu>
  {!compact&&<button className="enigma-repository-terminal" type="button" data-tooltip="选择目录并打开工作区终端" onClick={()=>setTerminalOpen(true)}><AppIcon name="command" size={15}/><span>终端</span></button>}
  {terminalOpen&&<TerminalChooser close={()=>setTerminalOpen(false)}/>}
  {notice&&<span role="status">{notice}</span>}
 </div>;
}
export async function openWorkspaceTerminal(root:string){
 const state=useStore.getState();
 if(!state.currentSessionPath||state.pendingNewSession){if(!await ensureSession(state.pendingDraftId))return;}
 useStore.getState().setCurrentTab('chat');useStore.getState().setActivePanel(null);
 selectDockTab(dockScope(useStore.getState()),'terminal',{terminalRoot:root});toggleJianSidebar(true);
}
export function TerminalChooser({close}:{close:()=>void}){
 const {repositories}=useRepositoryContext(),[error,setError]=useState('');
 return <SurfaceModal onClose={close}><div className="enigma-modal-backdrop"><section className="enigma-connect-dialog" role="dialog" aria-modal="true" aria-label="打开工作区终端"><header><h3>打开终端</h3><button onClick={close} aria-label="关闭终端选择"><AppIcon name="close" size={16}/></button></header><p>选择终端的工作目录。网页和桌面应用均可使用。</p>{repositories.map(repo=><button className="enigma-terminal-root" key={repo.path} onClick={async()=>{try{await openWorkspaceTerminal(repo.path);close();}catch(e){setError(e instanceof Error?e.message:'终端无法打开');}}}><AppIcon name="command" size={16}/><span>{repo.name}<small>{repo.path}</small></span></button>)}{!repositories.length&&<p>请先选择仓库或工作目录。</p>}{error&&<p role="alert">{error}</p>}</section></div></SurfaceModal>;
}
