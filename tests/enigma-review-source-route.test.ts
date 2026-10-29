import {beforeEach,expect,it,vi} from 'vitest';
import {createEnigmaRoute} from '../server/routes/enigma';
import {readStoredReviewSource} from 'enigma-next';
const state=vi.hoisted(()=>({allowed:true,controller:vi.fn(),authorize:vi.fn()}));
vi.mock('../plugins/enigma/host',()=>({engineeringHost:()=>({controller:state.controller})}));
vi.mock('../server/http/boundary',()=>({createRequestContext:()=>({authorize:state.authorize})}));
vi.mock('enigma-next',async load=>({...await load<typeof import('enigma-next')>(),readStoredReviewSource:vi.fn()}));
const engine={resolveSessionRef:()=>({sessionPath:'/owned',sessionId:'host-owned',lifecycle:'active'})};
beforeEach(()=>{vi.clearAllMocks();state.allowed=true;state.authorize.mockImplementation(()=>({allowed:state.allowed}));state.controller.mockResolvedValue({options:{workspace:{root:'fixture'}},chat:{session:'pi-owned'}});vi.mocked(readStoredReviewSource).mockResolvedValue({content:'frozen'} as any);});
it('binds frozen source reads to the authorized native task and selected side',async()=>{
 const r=await createEnigmaRoute(engine).request('/enigma/review/source?review=review-a&repo=api&file=removed.ts&side=baseline&start=2&end=10');expect(r.status).toBe(200);
 expect(readStoredReviewSource).toHaveBeenCalledWith({root:'fixture'},'review-a','pi-owned','api','removed.ts',2,10,'baseline');
});
it('rejects unauthorized reads and unsupported source variants',async()=>{
 state.allowed=false;expect((await createEnigmaRoute(engine).request('/enigma/review/source?review=r&repo=api&file=a')).status).toBe(403);expect(readStoredReviewSource).not.toHaveBeenCalled();
 state.allowed=true;expect((await createEnigmaRoute(engine).request('/enigma/review/source?review=r&repo=api&file=a&side=live')).status).toBe(400);
});
