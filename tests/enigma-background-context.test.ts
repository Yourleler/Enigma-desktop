import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {EngineeringHost} from '../plugins/enigma/host.ts';
import {SessionManager} from '../lib/pi-sdk/index.ts';
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
it.each(['project-one','cwd:'])('inherits source folder, project %s and read-only permissions without activating another session',async(projectId)=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'background-context-'));roots.push(root);const cwd=path.join(root,'files'),profile=path.join(root,'profile');await fs.mkdir(cwd);await fs.mkdir(profile);const manager=SessionManager.create(cwd,path.join(profile,'sessions'));manager.appendMessage({role:'user',content:'original',timestamp:Date.now()});const sourcePath=manager.getSessionFile()!;
 const source={sessionManager:manager,model:{provider:'test',id:'fixed'},thinkingLevel:'medium'};
 const engine={hanakoHome:profile,getSessionByPath:()=>source,listSessions:async()=>[{path:sourcePath,cwd,projectId}],resolveSessionOwnership:()=>({agentId:'owner'}),getSessionPermissionMode:()=> 'read_only',getSessionWorkspaceFolders:()=>[cwd],getSessionAuthorizedFolders:()=>[],createDetachedSession:vi.fn(async(args:any)=>({sessionPath:args.sessionMgr.getSessionFile(),sessionId:'new'})),setSessionProjectAssignment:vi.fn(),createSession:vi.fn()};
 const host=new EngineeringHost(engine);vi.spyOn(host,'binding').mockResolvedValue({root:path.join(root,'coordinator'),memory:false,sessionPath:sourcePath,modelPolicy:{mode:'single',phase:'execution',execution:{provider:'test',id:'fixed'},requests:3,failures:0,maxRequests:5}});
 vi.spyOn(host,'saveBinding').mockResolvedValue();const result=await host.createBackgroundContext(sourcePath,async target=>{target.appendMessage({role:'user',content:'selected background',timestamp:Date.now()});});
 expect(engine.createDetachedSession).toHaveBeenCalledWith(expect.objectContaining({cwd,permissionMode:'read_only',agentId:'owner',authorizedFolders:[],workspaceFolders:[cwd]}));
 expect(host.saveBinding).toHaveBeenCalledWith(result.sessionPath,expect.objectContaining({modelPolicy:expect.objectContaining({requests:3,maxRequests:5})}));
 expect(engine.setSessionProjectAssignment).toHaveBeenCalledWith({sessionPath:result.sessionPath,projectId});expect(engine.createSession).not.toHaveBeenCalled();expect(SessionManager.open(result.sessionPath).getCwd()).toBe(cwd);expect(manager.getBranch().filter(e=>e.type==='message')).toHaveLength(1);
});
it('keeps managed worker creation under the conductor task limit',async()=>{
 const engine={hanakoHome:'/unused',createDetachedSession:vi.fn()},host=new EngineeringHost(engine);vi.spyOn(host,'binding').mockResolvedValue({root:'/unused',memory:false,sessionPath:'/source',managedGrant:{managerPath:'/manager',root:'/unused',models:['test/model']}});
 await expect(host.createBackgroundContext('/source')).rejects.toThrow('管家');expect(engine.createDetachedSession).not.toHaveBeenCalled();
});
