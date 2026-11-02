import {Hono} from 'hono';
import {beforeEach,expect,it,vi} from 'vitest';
import {registerSessionTimingRoute} from '../server/session-timing';
const state=vi.hoisted(()=>({allowed:true,authorize:vi.fn()}));
vi.mock('../server/http/boundary',()=>({createRequestContext:()=>({authorize:(...args:unknown[])=>{state.authorize(...args);return {allowed:state.allowed};}})}));
beforeEach(()=>{state.allowed=true;state.authorize.mockClear();});
it('reads only an explicitly resolved and authorized session',async()=>{
 const engine={resolveSessionRef:vi.fn(()=>({sessionPath:'/real',sessionId:'one'})),getSessionByPath:()=>({isIdle:false,sessionManager:{getHeader:()=>({timestamp:1000})}})};
 const route=new Hono(),sample=vi.fn(()=>({state:'running',startedAt:2000,elapsedMs:1000}));registerSessionTimingRoute(route,engine,sample);
 expect((await route.request('/sessions/timing')).status).toBe(400);expect(sample).not.toHaveBeenCalled();
 state.allowed=false;expect((await route.request('/sessions/timing?path=/fake')).status).toBe(403);expect(sample).not.toHaveBeenCalled();
 state.allowed=true;const response=await route.request('/sessions/timing?path=/fake');expect(response.status).toBe(200);expect(sample).toHaveBeenCalledWith('/real');expect(state.authorize).toHaveBeenCalledWith('sessions.read',{kind:'session',sessionId:'one',sessionPath:'/real'});
 expect(await response.json()).toMatchObject({sessionPath:'/real',createdAt:1000,run:{state:'running'}});
});
it('controls the exact displayed goal and refuses stale or read-only requests',async()=>{
 let loop={createdAt:1000,updatedAt:2000,status:'running',prompt:'Test goal',turnCount:1,target:{kind:'desktop',sessionId:'one'}};
 const target={sessionId:'one'},controller={toolStatus:()=>loop,targetFromSessionRef:vi.fn(async(ref)=>ref?.kind==='desktop'?target:null),pause:vi.fn(async()=>{loop={...loop,status:'paused',updatedAt:3000};}),resume:vi.fn(),stop:vi.fn()};
 const engine={resolveSessionRef:()=>({sessionPath:'/real',sessionId:'one',lifecycle:'active'}),getSessionByPath:()=>({sessionManager:{getHeader:()=>({timestamp:1000})}}),loopController:controller};
 const route=new Hono();registerSessionTimingRoute(route,engine,()=>null);
 const request=(extra:any={})=>route.request('/sessions/goal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionPath:'/alias',action:'pause',createdAt:1000,revision:2000,...extra})});
 state.allowed=false;expect((await request()).status).toBe(403);expect(controller.pause).not.toHaveBeenCalled();
 state.allowed=true;expect((await request({revision:1500})).status).toBe(409);
 const response=await request();expect(response.status).toBe(200);expect((await response.json()).goal).toMatchObject({state:'paused',objective:'Test goal'});expect(controller.pause).toHaveBeenCalledExactlyOnceWith(target,'user');
 expect((await request()).status).toBe(409);expect(controller.pause).toHaveBeenCalledTimes(1);
});
