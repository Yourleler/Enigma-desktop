import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {createEnigmaRoute} from '../server/routes/enigma';
import {Artifacts} from 'enigma-next';
const fixture=vi.hoisted(()=>({allowed:true,controller:vi.fn(),authorize:vi.fn()}));
vi.mock('../plugins/enigma/host',()=>({engineeringHost:()=>({controller:fixture.controller})}));
vi.mock('../server/http/boundary',()=>({createRequestContext:()=>({authorize:fixture.authorize})}));
const engine={resolveSessionRef:()=>({sessionPath:'/owned',sessionId:'host-owned',lifecycle:'active'})};
let root:string;
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'enigma-artifact-route-'));fixture.allowed=true;fixture.authorize.mockImplementation(()=>({allowed:fixture.allowed}));fixture.controller.mockReset().mockResolvedValue({options:{workspace:{}},chat:{session:'pi-owned'}});});
afterEach(async()=>{vi.restoreAllMocks();await rm(root,{recursive:true,force:true});});
it('serves actual JPEG MIME, intact bytes and a safe original Unicode filename under the resolved task scope',async()=>{
 const bytes=Buffer.from([255,216,255,224,0,4]),path=join(root,'blob');await writeFile(path,bytes);
 const read=vi.spyOn(Artifacts.prototype,'read').mockResolvedValue({path,record:{id:'artifact-a',kind:'screenshot',extension:'.jpg',origin:{file:'docs/中文截图.jpg'}}} as any);
 const response=await createEnigmaRoute(engine).request('/enigma/artifact/artifact-a?sessionPath=/spoofed');
 expect(response.status).toBe(200);expect(read).toHaveBeenCalledWith('artifact-a','pi-owned');expect(response.headers.get('content-type')).toBe('image/jpeg');
 expect(response.headers.get('content-disposition')).toContain('filename="artifact-a.jpg"');expect(response.headers.get('content-disposition')).toContain("filename*=UTF-8''%E4%B8%AD");
 expect(response.headers.get('x-content-type-options')).toBe('nosniff');expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
});
it('rejects unauthorized downloads before reading a stored artifact',async()=>{
 fixture.allowed=false;const read=vi.spyOn(Artifacts.prototype,'read');
 expect((await createEnigmaRoute(engine).request('/enigma/artifact/artifact-a')).status).toBe(403);
 expect(read).not.toHaveBeenCalled();expect(fixture.controller).not.toHaveBeenCalled();
});
