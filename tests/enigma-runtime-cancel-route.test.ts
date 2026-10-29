import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createEnigmaRoute} from '../server/routes/enigma';
import {BackgroundRuns,TaskEvents,ServiceManager} from 'enigma-next';
const fixture=vi.hoisted(()=>({allowed:true,controller:vi.fn(),publish:vi.fn(),authorize:vi.fn()}));
vi.mock('../plugins/enigma/host',()=>({engineeringHost:()=>({controller:fixture.controller,publish:fixture.publish})}));
vi.mock('../server/http/boundary',()=>({createRequestContext:()=>({authorize:fixture.authorize})}));
const engine={resolveSessionRef:()=>({sessionPath:'/owned',sessionId:'host-owned',lifecycle:'active'})};
const request=(body:unknown)=>createEnigmaRoute(engine).request('/enigma/runtime/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{fixture.allowed=true;fixture.authorize.mockImplementation(()=>({allowed:fixture.allowed}));fixture.controller.mockReset().mockResolvedValue({options:{workspace:{}},chat:{session:'pi-owned'},safeSnapshot:(x:unknown)=>x});fixture.publish.mockReset();});
afterEach(()=>vi.restoreAllMocks());
it('requires session write access before loading or stopping a runtime resource',async()=>{
 fixture.allowed=false;const stop=vi.spyOn(TaskEvents.prototype,'cancel');const response=await request({kind:'wait',id:'owned'});
 expect(response.status).toBe(403);expect(fixture.controller).not.toHaveBeenCalled();expect(stop).not.toHaveBeenCalled();
});
it('uses the resolved native task identity for wait and background cancellation',async()=>{
 const wait=vi.spyOn(TaskEvents.prototype,'cancel').mockResolvedValue({state:{status:'cancelled'}} as any),background=vi.spyOn(BackgroundRuns.prototype,'cancel').mockResolvedValue({state:{status:'cancelled'}} as any);
 expect((await request({kind:'wait',id:'wait-one',sessionPath:'/spoofed'})).status).toBe(200);expect(wait).toHaveBeenCalledWith('wait-one','pi-owned');
 expect((await request({kind:'background',id:'command-one'})).status).toBe(200);expect(background).toHaveBeenCalledWith('command-one','pi-owned');expect(fixture.publish).toHaveBeenCalledWith('/owned','refresh',{event:'settled'});
});
it('stops only the registered service identifier and rejects arbitrary operation kinds',async()=>{
 const service=vi.spyOn(ServiceManager.prototype,'stop').mockResolvedValue({status:'cancelled'} as any);
 expect((await request({kind:'service',id:'registered'})).status).toBe(200);expect(service).toHaveBeenCalledWith('registered');
 fixture.controller.mockClear();expect((await request({kind:'kill-pid',id:'123'})).status).toBe(400);expect(fixture.controller).not.toHaveBeenCalled();
});
