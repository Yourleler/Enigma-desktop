import {beforeEach,it,expect,vi} from 'vitest';
import {createEnigmaRoute} from '../server/routes/enigma';
const state=vi.hoisted(()=>({allowed:true,files:true,readOnly:false,capture:vi.fn(),analyze:vi.fn(),action:vi.fn()}));
vi.mock('../plugins/enigma/host',()=>({engineeringHost:()=>({})}));
vi.mock('../plugins/enigma/change-workbench',()=>({ChangeWorkbench:class {capture=state.capture;analyze=state.analyze;action=state.action;}}));
vi.mock('../server/http/boundary',()=>({createRequestContext:()=>({authorize:(permission:string)=>({allowed:state.allowed&&(permission!=='files.read'||state.files)})})}));
const engine={resolveSessionRef:()=>({sessionPath:'/owned',sessionId:'owned-id',lifecycle:'active'}),getSessionPermissionMode:()=>state.readOnly?'read_only':'ask'};
beforeEach(()=>{vi.clearAllMocks();state.allowed=true;state.files=true;state.readOnly=false;state.capture.mockResolvedValue({id:'source'});state.analyze.mockResolvedValue({id:'job'});});
const body=(value:any)=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
it('binds source reads to server-authorized session identity, ignoring a forged path',async()=>{
 const response=await createEnigmaRoute(engine).request('/enigma/change-workbench/source',body({sessionPath:'/forged',input:{source:'conversation'}}));expect(response.status).toBe(200);expect(state.capture).toHaveBeenCalledWith('/owned',{source:'conversation'});
});
it('blocks analysis when session or file access is unavailable',async()=>{
 state.allowed=false;let r=await createEnigmaRoute(engine).request('/enigma/change-workbench/analyze',body({source:'s',kind:'review'}));expect(r.status).toBe(403);expect(state.analyze).not.toHaveBeenCalled();
 state.allowed=true;state.files=false;r=await createEnigmaRoute(engine).request('/enigma/change-workbench/source',body({input:{source:'conversation'}}));expect(r.status).not.toBe(200);expect(state.capture).not.toHaveBeenCalled();
});
it('keeps frozen reading available in a read-only conversation but rejects model/repair writes',async()=>{
 state.readOnly=true;const api=createEnigmaRoute(engine);expect((await api.request('/enigma/change-workbench/source',body({input:{source:'conversation'}}))).status).toBe(200);
 expect((await api.request('/enigma/change-workbench/analyze',body({source:'s',kind:'review'}))).status).not.toBe(200);expect(state.analyze).not.toHaveBeenCalled();
 expect((await api.request('/enigma/change-workbench/action',body({job:'j',finding:'f',action:'repair'}))).status).not.toBe(200);expect(state.action).not.toHaveBeenCalled();
});
