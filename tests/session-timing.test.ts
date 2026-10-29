import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {readSessionTiming} from '../server/session-timing';
import {LoopStore} from '../lib/loop/loop-store';
import {elapsedClock} from '../shared/session-timing';
const directories:string[]=[];
afterEach(async()=>{vi.useRealTimers();for(const dir of directories.splice(0))await fs.rm(dir,{recursive:true,force:true});});
const create=async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'session-timing-'));directories.push(dir);return dir;};
it('reads original session header after reconnect without loading history or inventing a run',async()=>{
 const dir=await create(),file=path.join(dir,'session.jsonl'),started=Date.parse('2026-10-28T00:00:00Z');
 await fs.writeFile(file,JSON.stringify({type:'session',timestamp:new Date(started).toISOString()})+'\nnot parsed message body\n');
 const value=await readSessionTiming({},file,null,started+5000);
 expect(value.createdAt).toBe(started);expect(value.run).toBeNull();expect(value.goal).toBeNull();
});
it('freezes terminal runs and does not claim an old meter is still running without a live session',async()=>{
 const engine={getSessionByPath:()=>({isIdle:true,sessionManager:{getHeader:()=>({timestamp:1000})}})};
 expect((await readSessionTiming(engine,'/unused',{state:'done',startedAt:2000,elapsedMs:9000},20000)).run).toMatchObject({state:'done',elapsedMs:9000});
 expect((await readSessionTiming(engine,'/unused',{state:'running',startedAt:2000,elapsedMs:9000},20000)).run?.state).toBe('unknown');
});
it('persists goal time across turns and pause/resume, excluding the explicit pause',async()=>{
 vi.useFakeTimers();vi.setSystemTime(100000);const dir=await create(),file=path.join(dir,'loop.json'),store=new LoopStore(file),target={sessionId:'session'};
 store.create(target,'goal');vi.setSystemTime(105000);store.update('session',{status:'paused'});
 vi.setSystemTime(125000);const restored=new LoopStore(file);restored.update('session',{status:'running'});
 vi.setSystemTime(132000);const engine={getSessionByPath:()=>({isIdle:true,sessionManager:{getHeader:()=>({timestamp:90000})}}),loopController:{toolStatus:()=>restored.get('session')}};
 const timing=await readSessionTiming(engine,'unused',null,Date.now());expect(timing.goal).toMatchObject({startedAt:100000,elapsedMs:12000,state:'running'});
 restored.update('session',{status:'completed'});vi.setSystemTime(142000);expect((await readSessionTiming(engine,'unused',null,Date.now())).goal).toMatchObject({elapsedMs:12000,state:'done'});
});
it('formats long and missing runtimes without wrapping hours or inventing a value',()=>{expect(elapsedClock(3661000)).toBe('1:01:01');expect(elapsedClock(null)).toBe('待核对');});

it('keeps a conductor clock across completed child rounds and reports interruption instead of endless running',async()=>{
 const {ConversationConductor}=await import('../plugins/enigma/conductor');
 const conductor=new ConversationConductor({engine:{}},'/manager');
 const ledger={startedAt:'2026-10-28T00:00:00Z',tasks:[{id:'one',status:'completed',startedAt:'2026-10-28T00:00:00Z',finishedAt:'2026-10-28T00:01:00Z'},{id:'two',status:'running',startedAt:'2026-10-28T00:02:00Z'}]};
 (conductor as any).load=async()=>ledger;(conductor as any).executionActive=(task:any)=>task.status==='running';
 expect(await conductor.timing(Date.parse('2026-10-28T00:03:00Z'))).toMatchObject({state:'running',elapsedMs:180000});
 ledger.tasks[1].status='blocked';expect(await conductor.timing(Date.parse('2026-10-28T00:04:00Z'))).toMatchObject({state:'unknown',elapsedMs:null});
});
it('times the conductor itself before it has launched any worker',async()=>{
 const {ConversationConductor}=await import('../plugins/enigma/conductor');
 const conductor=new ConversationConductor({engine:{isSessionStreaming:()=>true}},'/manager');
 (conductor as any).load=async()=>({startedAt:'2026-10-28T00:00:00Z',tasks:[]});
 expect(await conductor.timing(Date.parse('2026-10-28T00:00:10Z'))).toMatchObject({kind:'conductor',state:'running',elapsedMs:10000});
});
