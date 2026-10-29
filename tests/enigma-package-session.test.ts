import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EngineeringHost} from '../plugins/enigma/host.ts';
import {Workspace,TaskPackages,ProjectContext} from 'enigma-next';
import {runProcess} from 'enigma-next/process';

it('registers restored package history under the native session directory without changing its private scope or starting work',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'enigma-package-host-'));
 try{
  await fs.mkdir(path.join(root,'source'));const source=await Workspace.open(path.join(root,'source'));await fs.mkdir(path.join(root,'repo'));await runProcess(['git','init','-q'],path.join(root,'repo'));await fs.writeFile(path.join(root,'repo','file.txt'),'original');await source.addRepo('api',path.join(root,'repo'),{role:'API',access:'write'});
  const material=await new ProjectContext(source).add({title:'私有背景',task:'old-task',source:{kind:'note',author:'user'},content:'保留接口兼容性'}),pack=await new TaskPackages(source).export({goal:'继续迁移',task:'old-task',source:{agent:'pi'},notes:[],resources:[material.id]});
  const restored=await TaskPackages.restore(pack.directory,path.join(root,'restored'),{preparePi:true}),native=path.join(root,'native');await fs.mkdir(native);
  await fs.mkdir(path.join(root,'profile','user'),{recursive:true});const sessions=new Map<string,any>(),engine={hanakoHome:path.join(root,'profile'),getSessionByPath:(file:string)=>sessions.get(file),getSessionIdForPath:(file:string)=>sessions.has(file)?'host-session-id':null,resolveSessionOwnership:()=>({agentId:'owner'}),getSessionPermissionMode:()=> 'operate',saveSessionTitle:vi.fn(),createDetachedSession:vi.fn(async(options:any)=>{const sessionPath=options.sessionMgr.getSessionFile(),sessionId='host-session-id';sessions.set(sessionPath,{sessionManager:options.sessionMgr});return {sessionPath,sessionId};})};
  const host=new EngineeringHost(engine);vi.spyOn(host,'publish').mockImplementation(()=>{});
  const value={packageRestored:true,goal:'继续迁移',workspace:restored.workspace.root,session:restored.piSession},result=await host.registerRestoredPackage(path.join(native,'source.jsonl'),value,{model:{id:'fixture'},thinkingLevel:'medium'});
  expect(path.dirname(result.createdSession.sessionPath)).toBe(native);expect(result.createdSession.sessionId).toBe('host-session-id');expect(result.session.sessionId).toBe(restored.piSession!.sessionId);expect(engine.createDetachedSession).toHaveBeenCalledWith(expect.objectContaining({memoryEnabled:false,visibleInSessionList:true,permissionMode:'operate'}));
  expect((await host.binding(result.createdSession.sessionPath))?.root).toBe(restored.workspace.root);
  const current=JSON.parse(await fs.readFile(path.join(restored.workspace.data,`session-${result.session.sessionId}.json`),'utf8'));expect(current.sessionFile).toBe(result.createdSession.sessionPath);expect(current.lastVerification).toBe('unverified');
  const context=await new ProjectContext(restored.workspace).read(restored.resources[0]!.target!,{task:result.session.sessionId});expect(context.content).toBe('保留接口兼容性');
  await host.registerRestoredPackage(path.join(native,'source.jsonl'),value,{model:{id:'fixture'}});expect(engine.createDetachedSession).toHaveBeenCalledTimes(1);
  const another=await TaskPackages.restore(pack.directory,path.join(root,'another'),{preparePi:true}),collision=path.join(native,path.basename(another.piSession!.sessionFile)),oldBytes=await fs.readFile(result.createdSession.sessionPath);await fs.writeFile(collision,oldBytes);
  await expect(host.registerRestoredPackage(path.join(native,'source.jsonl'),{...value,workspace:another.workspace.root,session:another.piSession},{model:{id:'fixture'}})).rejects.toThrow('身份');expect(await fs.readFile(collision)).toEqual(oldBytes);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
