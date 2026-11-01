import {beforeEach,expect,it,vi} from 'vitest';
import {createUsageRoute} from '../server/routes/usage';
const state=vi.hoisted(()=>({allowed:true}));
vi.mock('../server/http/boundary',()=>({createRequestContext:()=>({authorize:()=>({allowed:state.allowed})})}));
beforeEach(()=>{state.allowed=true;});
it('authorizes the resolved conversation before reading any ledger',async()=>{
 const engine={resolveSessionRef:()=>({sessionId:'id',sessionPath:'/resolved'}),usageLedger:{list:vi.fn(()=>({entries:[]}))}};
 state.allowed=false;expect((await createUsageRoute(engine).request('/usage/summary?sessionPath=/other')).status).toBe(403);expect(engine.usageLedger.list).not.toHaveBeenCalled();
 expect((await createUsageRoute(engine).request('/usage/export?sessionPath=/other&format=json')).status).toBe(403);expect(engine.usageLedger.list).not.toHaveBeenCalled();
 state.allowed=true;const response=await createUsageRoute(engine).request('/usage/summary?sessionPath=/old');expect(response.status).toBe(200);expect((await response.json()).scope).toBe('session');
});
it('returns downloadable exports and rejects unsupported formats',async()=>{
 const engine={resolveSessionRef:()=>({sessionId:'id',sessionPath:'/resolved'}),usageLedger:{list:()=>({entries:[]})}};
 const route=createUsageRoute(engine);
 expect((await route.request('/usage/export?format=html')).status).toBe(400);
 const response=await route.request('/usage/export?format=json');
 expect(response.headers.get('X-Enigma-Usage-Export')).toBe('1');expect(response.headers.get('Content-Disposition')).toContain('attachment');
 expect((await response.json()).records).toEqual([]);
});
