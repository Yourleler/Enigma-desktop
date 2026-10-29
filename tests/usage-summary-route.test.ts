import {beforeEach,expect,it,vi} from 'vitest';
import {createUsageRoute} from '../server/routes/usage';
const state=vi.hoisted(()=>({allowed:true}));
vi.mock('../server/http/boundary',()=>({createRequestContext:()=>({authorize:()=>({allowed:state.allowed})})}));
beforeEach(()=>{state.allowed=true;});
it('authorizes the resolved conversation before reading any ledger',async()=>{
 const engine={resolveSessionRef:()=>({sessionId:'id',sessionPath:'/resolved'}),usageLedger:{list:vi.fn(()=>({entries:[]}))}};
 state.allowed=false;expect((await createUsageRoute(engine).request('/usage/summary?sessionPath=/other')).status).toBe(403);expect(engine.usageLedger.list).not.toHaveBeenCalled();
 state.allowed=true;const response=await createUsageRoute(engine).request('/usage/summary?sessionPath=/old');expect(response.status).toBe(200);expect((await response.json()).scope).toBe('session');
});
