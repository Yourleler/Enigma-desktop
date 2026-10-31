import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Workspace} from 'enigma-next';
import {EngineeringHost} from '../plugins/enigma/host.ts';
const cleanup:string[]=[];
afterEach(async()=>{for(const root of cleanup.splice(0))await fs.rm(root,{recursive:true,force:true});vi.restoreAllMocks();});
it('reviews the selected effects within registered write roots and excludes read-only repositories',async()=>{
 const parent=await fs.mkdtemp(path.join(os.tmpdir(),'enigma-approval-'));cleanup.push(parent);
 const root=path.join(parent,'coordination'),writable=path.join(parent,'writable'),readonly=path.join(parent,'readonly');
 await fs.mkdir(root);
 for(const directory of [writable,readonly]){await fs.mkdir(directory);execFileSync('git',['init','-q'],{cwd:directory});}
 const workspace=await Workspace.open(root);await workspace.addRepo('write',writable,{access:'write'});await workspace.addRepo('read',readonly,{access:'read'});
 await fs.writeFile(path.join(workspace.data,'session-main.json'),'{}');
 const entries=[{id:'u',type:'message',message:{role:'user',content:[{type:'text',text:'Restore selected checkpoint in the registered writable repository.'}]}}];
 const engine={getSessionPermissionMode:()=> 'auto',getSessionAuthorizedFolders:()=>[],confirmStore:{},getSessionByPath:()=>({sessionManager:{getSessionId:()=> 'main',getBranch:()=>entries,getEntries:()=>entries}}),approvalGateway:{review:vi.fn(async()=>({action:'allow'}))}};
 const host=new EngineeringHost(engine);vi.spyOn(host,'binding').mockResolvedValue({root,memory:false,sessionPath:'main'});vi.spyOn(host,'publish').mockImplementation(()=>{});
 const effects=JSON.stringify({files:[{repo:'write',file:'NOTE.md',change:'deleted'}]});
 expect(await host.confirm('main',{kind:'confirm',title:'Restore',message:effects})).toBe(true);
 const [request,context]=engine.approvalGateway.review.mock.calls[0] as any[];
 expect(request.sideEffect.summary).toBe(effects);
 expect(context.workspaceFolders).toEqual([root,await fs.realpath(writable)]);
 expect(context.workspaceFolders).not.toContain(await fs.realpath(readonly));
 expect(context.authorizedFolders).toEqual([]);
 expect(context.explicitUserAuthorization).toContain('Restore selected');
});
