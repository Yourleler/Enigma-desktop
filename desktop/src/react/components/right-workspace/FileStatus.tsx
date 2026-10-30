import {createContext,useContext,useEffect,useMemo,useState,type ReactNode} from 'react';
import {useStore} from '../../stores';
import {hanaFetch} from '../../hooks/use-hana-fetch';
import {useEngineering} from '../../engineering/state';
import {dockScope,selectDockTab} from '../../stores/right-dock-store';
import type {FileRef} from '../../types/file-ref';

type StatusFile={path:string;status:string;previousPath?:string};
type StatusResult={repositories:Array<{id:string;root:string;files:StatusFile[];error?:string}>;git:boolean;error?:string;lookup?:Map<string,StatusFile>};
const EMPTY:StatusResult={repositories:[],git:false};
const Context=createContext<StatusResult>(EMPTY);
const normalize=(path:string)=>path.replace(/\\/g,'/').replace(/\/$/,'');
const labels:Record<string,string>={added:'新增',modified:'修改',deleted:'删除',renamed:'改名',conflict:'冲突',uploaded:'已上传',attached:'附件',created:'已生成',captured:'截图',referenced:'已引用',read:'已读取',staged:'已暂存',sent:'已发送'};
export function fileOperationLabel(file:Pick<FileRef,'operations'|'origin'|'source'|'status'>){
  if(file.status==='expired')return '文件不可用';
  const operations=file.operations||[],last=[...operations].reverse().find(op=>labels[op]);
  return last?labels[last]:file.origin==='user_upload'?'已上传':file.source==='session-attachment'?'附件':null;
}
export function FileStatusProvider({children,active=true}:{children:ReactNode;active?:boolean}){
  const session=useStore(s=>s.currentSessionPath),connection=useStore(s=>s.activeServerConnectionId),root=useEngineering(s=>s.snapshot?.root);
  const key=JSON.stringify([session,connection,root]),[result,setResult]=useState<{key:string;value:StatusResult}>({key:'',value:EMPTY});
  useEffect(()=>{
    if(!session||!active)return;
    const abort=new AbortController();let pending=false;
    const load=async()=>{
      if(pending||document.hidden)return;pending=true;
      try{const res=await hanaFetch(`/api/enigma/changes/files?sessionPath=${encodeURIComponent(session)}`,{signal:abort.signal,timeout:28000,throwOnHttpError:false});const value=await res.json();if(!res.ok||!Array.isArray(value.repositories)||value.repositories.some((repo:any)=>typeof repo.root!=='string'||!Array.isArray(repo.files)))throw new Error(value.error||'文件状态暂不可用');if(!abort.signal.aborted)setResult({key,value});}
      catch{if(!abort.signal.aborted)setResult({key,value:{...EMPTY,error:'文件状态暂不可用'}});}
      finally{pending=false;}
    };
    void load();const timer=setInterval(load,8000);window.addEventListener('focus',load);document.addEventListener('visibilitychange',load);
    return()=>{abort.abort();clearInterval(timer);window.removeEventListener('focus',load);document.removeEventListener('visibilitychange',load);};
  },[key,active]);
  const current=result.key===key?result.value:EMPTY;
  const indexed=useMemo(()=>{
    const lookup=new Map<string,StatusFile>();
    for(const repo of current.repositories)for(const file of repo.files){
      const root=normalize(repo.root),full=`${root}/${file.path}`;lookup.set(full,file);
      let parent=full.slice(0,full.lastIndexOf('/'));
      while(parent.length>=root.length){if(!lookup.has(parent))lookup.set(parent,file);parent=parent.slice(0,parent.lastIndexOf('/'));}
    }
    return {...current,lookup};
  },[current]);
  return <Context.Provider value={indexed}>{children}</Context.Provider>;
}
export function FileStatusBadge({path,isDir=false,file}:{path?:string;isDir?:boolean;file?:FileRef}){
  const result=useContext(Context),target=normalize(path||file?.path||'');
  const match=result.lookup?.get(target);
  const activity=file?fileOperationLabel(file):null;
  const label=activity||(match?(isDir?'有变更':labels[match.status]):null);
  if(!label)return null;
  const hint=[activity?`对话文件记录：${activity}`:'',match?`Git 未提交状态：${labels[match.status]}${match.previousPath?` · 原位置 ${match.previousPath}`:''}`:''].filter(Boolean).join(' · ');
  return <span className="enigma-file-status" data-status={activity?'activity':match?.status||'activity'} data-tooltip={hint} title={hint}>{label}</span>;
}
export function DeletedFiles(){
  const value=useContext(Context),root=useStore(s=>s.deskWorkspaceNativeRoot||s.deskBasePath);
  const deleted=value.repositories.flatMap(repo=>repo.files.filter(file=>file.status==='deleted'&&(!root||`${normalize(repo.root)}/${file.path}`.startsWith(normalize(root)+'/'))).map(file=>({...file,id:repo.id})));
  if(value.error||value.repositories.some(repo=>repo.error))return <p className="enigma-file-status-note" role="status">部分文件状态暂不可用</p>;
  if(!deleted.length)return null;
  return <details className="enigma-deleted-files"><summary>已删除的文件 · {deleted.length}</summary>{deleted.map(file=><button key={`${file.id}:${file.path}`} data-tooltip="在变更面板中查看删除内容" onClick={()=>selectDockTab(dockScope(useStore.getState()),'changes')}><span>{file.path}</span><span className="enigma-file-status" data-status="deleted">删除</span></button>)}</details>;
}
