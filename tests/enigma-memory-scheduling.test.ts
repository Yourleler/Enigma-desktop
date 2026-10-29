import{afterEach,expect,it,vi}from'vitest';
import fs from'node:fs/promises';import path from'node:path';import os from'node:os';
import{Workspace,MemoryStore}from'enigma-next';
import{EngineeringMemory}from'../plugins/enigma/memory-host';
import{callText}from'../core/llm-client';
vi.mock('../core/llm-client',()=>({callText:vi.fn()}));
vi.mock('../core/model-execution-config',()=>({callTextConfigFromUtilityConfig:()=>({})}));
const cleanup:(()=>Promise<unknown>)[]=[];
afterEach(async()=>{for(const close of cleanup.reverse())await close();cleanup.length=0;vi.mocked(callText).mockReset();});
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'enigma-memory-scheduling-')),workspace=await Workspace.open(root);
 cleanup.push(()=>fs.rm(root,{recursive:true,force:true}));
 const source=await(await MemoryStore.open(workspace)).save({kind:'decision',scope:{type:'project'},title:'来源说明',content:'保留原检查',appliesWhen:'当前任务',origin:{kind:'user',reference:'fixture'}},{userStated:true});
 let busy=true;const engine={getSessionPermissionMode:()=> 'operate',isSessionStreaming:()=>busy,getSessionByPath:()=>({sessionManager:{getSessionId:()=> 'session',getBranch:()=>[]}}),resolveUtilityConfigFresh:async()=>({}),_utilityOptionsForContext:()=>({})};
 const host={engine,binding:async()=>({root:workspace.root,memory:true}),hasForegroundWork:()=>busy,publish:vi.fn()};const memory=new EngineeringMemory(host);cleanup.push(()=>memory.close());
 const output=JSON.stringify({candidates:[{title:'可复用要求',kind:'decision',content:'保留原检查',appliesWhen:'当前来源未变化',sources:[source.id]}],relations:[]});
 return{memory,source,engine,host,output,setBusy:(value:boolean)=>{busy=value;}};
}
it('waits for foreground work without charging a request, then dispatches once idle',async()=>{
 const f=await fixture();vi.mocked(callText).mockResolvedValue(f.output);const run=await f.memory.start('/session',[f.source.id]);
 await vi.waitFor(async()=>expect((await f.memory.list('/session'))[0]?.waitingReason).toBe('foreground'));
 expect(callText).not.toHaveBeenCalled();expect((await f.memory.list('/session'))[0]?.requests).toBe(0);
 f.setBusy(false);await vi.waitFor(async()=>expect((await f.memory.list('/session')).find(r=>r.id===run.id)?.status).toBe('ready'));
 expect(callText).toHaveBeenCalledTimes(1);
});
it('cancels queued work promptly without letting later work bypass an active memory request',async()=>{
 const f=await fixture();f.setBusy(false);let finish!:(value:string)=>void;
 vi.mocked(callText).mockImplementationOnce(async()=>await new Promise<string>(resolve=>{finish=resolve;})).mockResolvedValue(f.output);
 const first=await f.memory.start('/session',[f.source.id]);await vi.waitFor(()=>expect(callText).toHaveBeenCalledTimes(1));
 const second=await f.memory.start('/session',[f.source.id]),third=await f.memory.start('/session',[f.source.id]);
 await f.memory.action('/session',second.id,'cancel');expect(callText).toHaveBeenCalledTimes(1);
 finish(f.output);await vi.waitFor(async()=>expect((await f.memory.list('/session')).find(r=>r.id===third.id)?.status).toBe('ready'));
 const runs=await f.memory.list('/session');expect(runs.find(r=>r.id===second.id)?.requests).toBe(0);expect(runs.find(r=>r.id===first.id)?.status).toBe('ready');expect(callText).toHaveBeenCalledTimes(2);
});
it('yields before a repair request and retains the charge for only the request already sent',async()=>{
 const f=await fixture();f.setBusy(false);vi.mocked(callText).mockImplementationOnce(async()=>{f.setBusy(true);return 'invalid json';}).mockResolvedValue(f.output);
 const run=await f.memory.start('/session',[f.source.id]);await vi.waitFor(async()=>{const state=(await f.memory.list('/session')).find(r=>r.id===run.id);expect(state?.waitingReason).toBe('foreground');expect(state?.requests).toBe(1);});
 expect((await f.memory.list('/session')).find(r=>r.id===run.id)?.requests).toBe(1);expect(callText).toHaveBeenCalledTimes(1);
 f.setBusy(false);await vi.waitFor(async()=>expect((await f.memory.list('/session')).find(r=>r.id===run.id)?.status).toBe('ready'));expect(callText).toHaveBeenCalledTimes(2);
});
it('rechecks current permissions after waiting and never dispatches if changed to read-only',async()=>{
 const f=await fixture(),run=await f.memory.start('/session',[f.source.id]);f.engine.getSessionPermissionMode=()=> 'read_only';f.setBusy(false);
 await vi.waitFor(async()=>expect((await f.memory.list('/session')).find(r=>r.id===run.id)?.status).toBe('paused'));
 expect(callText).not.toHaveBeenCalled();expect((await f.memory.list('/session')).find(r=>r.id===run.id)?.error).toContain('只读');
});
it('closing the host pauses queued work without charging it or leaving shutdown blocked',async()=>{
 const f=await fixture(),run=await f.memory.start('/session',[f.source.id]);await f.memory.close();
 const current=(await f.memory.list('/session')).find(item=>item.id===run.id);expect(current?.status).toBe('paused');expect(current?.requests).toBe(0);expect(callText).not.toHaveBeenCalled();
});
