import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EngineeringHost} from '../plugins/enigma/host';
const roots:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
async function fixture(projects:any[]=[],sessions:any[]=[]){
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'enigma-project-connect-'));roots.push(home);
 const engine={hanakoHome:home,listSessions:async()=>sessions,getSessionProjectCatalog:()=>({projects}),getSessionIdForPath:(p:string)=>p};
 const host=new EngineeringHost(engine);vi.spyOn(host,'isEnabled').mockReturnValue(true);vi.spyOn(host,'binding').mockResolvedValue(null);
 const connect=vi.spyOn(host,'connect').mockImplementation(async(_session,root,memory)=>({connected:true,root,memory}));
 return {host,home,connect};
}
it('uses a project default directory without a second picker or granting other directories',async()=>{
 const f=await fixture([{id:'p',workspacePath:'/code/main',repositoryPaths:['/code/other']}],[{path:'chat',projectId:'p',cwd:'/old'}]);
 await f.host.connectProject('chat');expect(f.connect).toHaveBeenCalledExactlyOnceWith('chat','/code/main',false);
});
it('folderless project chats share task metadata while unrelated standalone chats stay separate',async()=>{
 const f=await fixture([{id:'p'}],[{path:'a',projectId:'p',cwd:'/default'},{path:'b',projectId:'p',cwd:'/default'},{path:'c',projectId:'cwd:'}]);
 const a=await f.host.connectProject('a'),b=await f.host.connectProject('b'),c=await f.host.connectProject('c');
 expect(a.root).toBe(b.root);expect(c.root).not.toBe(a.root);expect(a.root.startsWith(f.home)).toBe(true);expect(a.root).not.toBe('/default');
});
it('coalesces concurrent openings and retains an existing task binding',async()=>{
 const f=await fixture([],[{path:'a',cwd:'/code/current'}]);await Promise.all([f.host.connectProject('a'),f.host.connectProject('a')]);expect(f.connect).toHaveBeenCalledTimes(1);
 vi.mocked(f.host.binding).mockResolvedValue({root:'/keep',memory:false,sessionPath:'a'});vi.spyOn(f.host,'snapshot').mockResolvedValue({root:'/keep'});
 expect(await f.host.connectProject('a')).toEqual({root:'/keep'});expect(f.connect).toHaveBeenCalledTimes(1);
});
it('exposes only the recorded manager navigation path, without the managed model grant',async()=>{
 const {host}=await fixture();
 vi.mocked(host.binding).mockResolvedValue({root:'/worker',memory:false,sessionPath:'child',managedGrant:{managerPath:'parent',root:'/worker',models:['private-grant']}});
 vi.spyOn(host,'controller').mockResolvedValue({safeSnapshot:(value:unknown)=>value,snapshot:()=>({idle:true})} as any);
 (host as any).overviews.set('child',{at:Date.now(),value:{repositories:[]}});
 const result=await host.snapshot('child');expect(result.managerSessionPath).toBe('parent');expect(result.managedGrant).toBeUndefined();
 vi.mocked(host.binding).mockResolvedValue({root:'/worker',memory:false,sessionPath:'child'});
 expect((await host.snapshot('child')).managerSessionPath).toBeUndefined();
});
