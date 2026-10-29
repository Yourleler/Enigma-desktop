import {beforeEach,expect,it,vi} from 'vitest';
import {createEnigmaRoute} from '../server/routes/enigma';
const fixture=vi.hoisted(()=>({allowed:true,files:vi.fn(),controller:vi.fn(),authorize:vi.fn()}));
vi.mock('../plugins/enigma/host',()=>({engineeringHost:()=>({controller:fixture.controller})}));
vi.mock('../server/http/boundary',()=>({createRequestContext:()=>({authorize:fixture.authorize})}));
const engine={resolveSessionRef:()=>({sessionPath:'/owned',sessionId:'host-owned',lifecycle:'active'})};
beforeEach(()=>{vi.clearAllMocks();fixture.allowed=true;fixture.authorize.mockImplementation(()=>({allowed:fixture.allowed}));fixture.controller.mockResolvedValue({options:{workspace:{files:fixture.files}}});fixture.files.mockResolvedValue(Array.from({length:6100},(_,i)=>`folder/file-${String(i).padStart(5,'0')}.ts`));});
it('searches every path before applying the display limit and provides stable subsequent pages',async()=>{
 const route=createEnigmaRoute(engine),first=await(await route.request('/enigma/files/api?limit=500')).json();
 expect(first.files).toHaveLength(500);expect(first.totalFiles).toBe(6100);expect(first.nextOffset).toBe(500);
 const second=await(await route.request(`/enigma/files/api?limit=500&offset=500&version=${first.version}`)).json();expect(second.files[0]).toBe('folder/file-00500.ts');
 const match=await(await route.request('/enigma/files/api?query=file-06099&limit=500')).json();expect(match.files).toEqual(['folder/file-06099.ts']);expect(match.totalMatches).toBe(1);
});
it('rejects paging a changed file set and disallows invalid or unauthorized queries',async()=>{
 const route=createEnigmaRoute(engine),first=await(await route.request('/enigma/files/api?limit=500')).json();fixture.files.mockResolvedValue(['new-file.ts']);
 expect((await route.request(`/enigma/files/api?limit=500&offset=500&version=${first.version}`)).status).toBe(409);
 expect((await route.request('/enigma/files/api?limit=-1')).status).toBe(400);
 fixture.allowed=false;fixture.files.mockClear();expect((await route.request('/enigma/files/api?query=secret')).status).toBe(403);expect(fixture.files).not.toHaveBeenCalled();
});
