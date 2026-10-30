import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {DesktopInputQueue} from '../core/desktop-input-queue';
const submit=vi.hoisted(()=>({prompt:vi.fn(),steer:vi.fn()}));
vi.mock('../core/desktop-session-submit',()=>({submitDesktopSessionMessage:submit.prompt,submitDesktopSessionInterjection:submit.steer}));
const roots:string[]=[];beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();submit.prompt.mockResolvedValue({});submit.steer.mockResolvedValue({});});afterEach(async()=>{vi.useRealTimers();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'enigma-queue-'));roots.push(root);let listener:any;const engine={hanakoHome:root,isSessionStreaming:vi.fn(()=>true),subscribe:vi.fn(fn=>{listener=fn;})};return {engine,queue:new DesktopInputQueue(engine),emit:(event:any)=>listener(event,'s')};}
const message=(text:string)=>({text,doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]},payload:{text:'Context\n'+text,displayMessage:{text}}});
it('edits and reorders queued messages, then recalls them without executing',async()=>{
 const f=await fixture(),a=await f.queue.add('s',message('A')),b=await f.queue.add('s',message('B'));
 await f.queue.update('s',{action:'pause',paused:true});await f.queue.update('s',{action:'move',id:b.id,index:0});await f.queue.update('s',{action:'edit',id:b.id,text:'B edited'});
 expect((await f.queue.read('s')).items.map(item=>item.text)).toEqual(['B edited','A']);
 expect(await f.queue.update('s',{action:'recall',id:b.id})).toMatchObject({text:'B edited'});await f.queue.update('s',{action:'remove',id:a.id});expect((await f.queue.read('s')).items).toEqual([]);expect(submit.prompt).not.toHaveBeenCalled();
});
it('delivers only after the current response and does not send the next item on a failed accepted turn',async()=>{
 const f=await fixture();await f.queue.add('s',message('A'));await f.queue.add('s',message('B'));
 await vi.advanceTimersByTimeAsync(1100);expect(submit.prompt).not.toHaveBeenCalled();
 f.engine.isSessionStreaming.mockReturnValue(false);submit.prompt.mockImplementation(async(_engine,opts)=>{opts.onInputAccepted();throw Error('provider failed');});
 await vi.advanceTimersByTimeAsync(1200);await vi.waitFor(async()=>expect((await f.queue.read('s')).items[0].state).toBe('unknown'));
 expect((await f.queue.read('s')).paused).toBe(true);await vi.advanceTimersByTimeAsync(4000);expect(submit.prompt).toHaveBeenCalledTimes(1);
});
it('keeps restart recovery paused and prevents automatic duplicate delivery',async()=>{
 const f=await fixture();await f.queue.add('s',message('A'));const restarted=new DesktopInputQueue(f.engine);
 expect((await restarted.read('s')).paused).toBe(true);
});
it('uses an explicit immediate steering action while the assistant is running',async()=>{
 const f=await fixture(),a=await f.queue.add('s',message('new direction'));await f.queue.sendNow('s',a.id);
 await vi.waitFor(()=>expect(submit.steer).toHaveBeenCalledTimes(1));await vi.waitFor(async()=>expect((await f.queue.read('s')).items).toHaveLength(0));
});
