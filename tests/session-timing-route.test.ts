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
