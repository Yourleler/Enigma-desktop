import {EventEmitter} from 'node:events';
import {expect,it,vi} from 'vitest';
import {createVisualActivityMonitor} from '../desktop/src/shared/visual-activity.cjs';

it('starts suspended on an already locked desktop and resumes only when both sleep and lock are cleared',()=>{
 const power=Object.assign(new EventEmitter(),{getSystemIdleState:vi.fn(()=> 'locked')}),changed=vi.fn();
 const monitor=createVisualActivityMonitor(power,changed);
 expect(monitor.getState()).toMatchObject({suspended:true,reason:'locked'});
 power.emit('unlock-screen');expect(monitor.getState().suspended).toBe(false);
 power.emit('suspend');expect(monitor.getState().reason).toBe('sleep');
 power.emit('lock-screen');power.emit('resume');expect(monitor.getState()).toMatchObject({suspended:true,reason:'locked'});
 power.emit('unlock-screen');expect(monitor.getState()).toMatchObject({suspended:false,reason:'active'});
 const count=changed.mock.calls.length;power.emit('unlock-screen');expect(changed).toHaveBeenCalledTimes(count);
 monitor.dispose();for(const name of ['lock-screen','unlock-screen','suspend','resume'])expect(power.listenerCount(name)).toBe(0);
});

it('tolerates unavailable idle-state detection without discarding a known lock during resume',()=>{
 const power=Object.assign(new EventEmitter(),{getSystemIdleState:()=>{throw Error('unavailable');}});
 const monitor=createVisualActivityMonitor(power,()=>{});expect(monitor.getState().suspended).toBe(false);
 power.emit('lock-screen');power.emit('suspend');power.emit('resume');expect(monitor.getState().suspended).toBe(true);
 power.emit('unlock-screen');expect(monitor.getState().suspended).toBe(false);monitor.dispose();
});

it('uses the read-only native probe when the generic idle API incorrectly reports active',async()=>{
 const power=Object.assign(new EventEmitter(),{getSystemIdleState:()=> 'active'}),changed=vi.fn(),probe=vi.fn(async()=>({suspended:true}));
 const monitor=createVisualActivityMonitor(power,changed,{probeSession:probe});
 await vi.waitFor(()=>expect(monitor.getState().suspended).toBe(true));expect(probe).toHaveBeenCalledOnce();
 power.emit('suspend');power.emit('resume');expect(monitor.getState().suspended).toBe(true);
 await vi.waitFor(()=>expect(probe).toHaveBeenCalledTimes(2));
 power.emit('unlock-screen');expect(monitor.getState().suspended).toBe(false);monitor.dispose();
});

it('does not let a late initial probe re-suspend an unlocked or disposed monitor',async()=>{
 const power=Object.assign(new EventEmitter(),{getSystemIdleState:()=> 'active'});let done!:(value:any)=>void;
 const monitor=createVisualActivityMonitor(power,()=>{},{probeSession:()=>new Promise(resolve=>{done=resolve;})});
 await Promise.resolve();power.emit('unlock-screen');done({suspended:true});await new Promise<void>(resolve=>setImmediate(resolve));
 expect(monitor.getState().suspended).toBe(false);monitor.dispose();
 const changed=vi.fn();let delayed!:(value:any)=>void;
 const next=createVisualActivityMonitor(power,changed,{probeSession:()=>new Promise(resolve=>{delayed=resolve;})});
 await Promise.resolve();next.dispose();delayed({suspended:true});await new Promise<void>(resolve=>setImmediate(resolve));expect(changed).not.toHaveBeenCalled();
});
