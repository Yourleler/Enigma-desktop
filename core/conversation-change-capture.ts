import path from 'node:path';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ConversationChanges,type ChangeRoot} from '../lib/conversation-changes.ts';
import {SessionManager} from '../lib/pi-sdk/index.ts';
import {PathGuard} from '../lib/sandbox/path-guard.ts';
import {deriveSandboxPolicy} from '../lib/sandbox/policy.ts';
import {Workspace} from 'enigma-next';
const stores=new WeakMap<object,ConversationChanges>();
export function conversationChanges(engine:any){
  let store=stores.get(engine);if(store)return store;
  store=new ConversationChanges(path.join(engine.hanakoHome,'conversation-changes'),async session=>{
    const id=engine.getSessionIdForPath?.(session),manifest=engine.getSessionManifest?.(id);
    const primary=manifest?.workspaceScope?.primaryCwd||engine.getSessionByPath?.(session)?.sessionManager?.getCwd?.()||SessionManager.open(session).getCwd();
    let engineeringRoots:string[]=[];
    try{const {engineeringHost}=await import('../plugins/enigma/host.ts');const binding=await engineeringHost(engine).binding(session);if(binding)engineeringRoots=(await Workspace.open(binding.root)).config.repos.map(r=>r.root);}catch{}
    const folders=[primary,...engine.getSessionWorkspaceFolders?.(session)||[],...engine.getSessionAuthorizedFolders?.(session)||[],...engineeringRoots].map(f=>typeof f==='string'?f:f?.path||f?.root).filter(Boolean);
    const roots:ChangeRoot[]=[];for(const folder of [...new Set(folders)] as string[]){try{const root=await fs.realpath(folder);if(roots.some(r=>root===r.root||root.startsWith(r.root+path.sep)))continue;roots.push({id:createHash('sha256').update(root).digest('hex').slice(0,12),root,name:path.basename(root)});}catch{}}
    return roots.slice(0,12);
  },(session,file)=>{
    const cwd=path.dirname(file);const policy=deriveSandboxPolicy({cwd,workspace:cwd,hanakoHome:engine.hanakoHome,agentDir:path.dirname(path.dirname(session)),mode:'standard'});
    return new PathGuard(policy).check(file,'read').allowed;
  });stores.set(engine,store);return store;
}
export async function startChangeCapture(engine:any,sessionPath:string|undefined,text:unknown,manager:any){
  if(!sessionPath||!engine?.hanakoHome)return null;
  try{return await conversationChanges(engine).begin(sessionPath,typeof text==='string'?text:'附件输入',manager?.getLeafId?.()||null);}catch(error){engine.log?.warn?.('对话变更记录初始化失败');return null;}
}
export async function finishChangeCapture(engine:any,sessionPath:string|undefined,id:string|null,manager:any,interrupted=false){
  if(!sessionPath||!id||!engine?.hanakoHome)return;
  try{
    const branch=manager?.getBranch?.()||[],turn=(await conversationChanges(engine).list(sessionPath)).find(t=>t.id===id);
    const parentIndex=branch.findIndex((entry:any)=>entry.id===turn?.parentEntry);
    const input=branch.slice(parentIndex+1).find((entry:any)=>entry.type==='message'&&entry.message.role==='user');
    const final=branch.findLast((entry:any)=>entry.type==='message'&&entry.message.role==='assistant');
    await conversationChanges(engine).end(sessionPath,id,input?.id,interrupted||final?.message?.stopReason==='aborted'||final?.message?.stopReason==='error');
  }catch{engine.log?.warn?.('对话变更记录封存失败');}
  finally{conversationChanges(engine).release(sessionPath,id);}
}
export function captureToolChanges(tools:any[],engine:any,cwd:string,getSessionPath:()=>string){
  return tools.map(tool=>({...tool,execute:async(...args:any[])=>{
    const session=getSessionPath();if(!session||!engine.hanakoHome)return tool.execute(...args);
    return conversationChanges(engine).observeTool(session,tool.name,args[1],cwd,()=>tool.execute(...args));
  }}));
}
export async function inheritChangeCapture(engine:any,source:string,target:string,entries:any[]){
  if(!engine?.hanakoHome)return;
  try{await conversationChanges(engine).inherit(source,target,new Set(entries.map(e=>e.id)));}catch{engine.log?.warn?.('分支文件历史继承未完成，原记录保留');}
}
