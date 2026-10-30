// @vitest-environment jsdom
import {beforeEach,expect,it,vi} from 'vitest';
import {useStore} from '../../stores';
import {openDockFiles} from '../../utils/dock-file-drop';
import {openFileRefPreview,openWorkbenchFilePreview} from '../../utils/remote-file-preview';
import {openFilePreview} from '../../utils/file-preview';
import {hanaFetch} from '../../hooks/use-hana-fetch';
vi.mock('../../utils/remote-file-preview',()=>({openFileRefPreview:vi.fn(async()=>{}),openWorkbenchFilePreview:vi.fn(async()=>{})}));
vi.mock('../../utils/file-preview',()=>({openFilePreview:vi.fn(async()=>{})}));
vi.mock('../../hooks/use-hana-fetch',()=>({hanaFetch:vi.fn()}));
beforeEach(()=>{vi.clearAllMocks();document.documentElement.setAttribute('data-platform','web');useStore.setState({currentSessionPath:'/session',activeServerConnectionId:'local',deskBasePath:'/workspace',deskWorkspaceMountId:null,deskFiles:[]});});
it('opens dragged workspace files through the scoped file route rather than copying them',async()=>{
 await openDockFiles([],{dragId:'one',source:'workspace',files:[{id:'f',name:'readme.md',path:'/workspace/readme.md',sourceSubdir:''}]});
 expect(openWorkbenchFilePreview).toHaveBeenCalledWith(expect.objectContaining({placement:'tab',localRootPath:'/workspace',subdir:'',file:{name:'readme.md',isDir:false}}));
 expect(hanaFetch).not.toHaveBeenCalled();
});
it('imports browser-selected files and previews the returned resource',async()=>{
 const resource={resourceId:'r1',studioId:'s1',links:{self:'/api/resources/r1',content:'/api/resources/r1/content'}};
 vi.mocked(hanaFetch).mockResolvedValue({ok:true,json:async()=>({uploads:[{dest:'/upload/doc.md',fileId:'f1',resource}]})} as Response);
 const file={name:'doc.md',type:'text/markdown',arrayBuffer:async()=>new TextEncoder().encode('# doc').buffer} as File;
 await openDockFiles([file]);
 expect(openFileRefPreview).toHaveBeenCalledWith(expect.objectContaining({fileId:'f1',resource}),expect.objectContaining({placement:'tab',sessionPath:'/session'}));
});
it('does not activate a late imported file in a different conversation',async()=>{
 vi.mocked(hanaFetch).mockImplementation(async()=>{useStore.setState({currentSessionPath:'/different'});return {ok:true,json:async()=>({uploads:[{dest:'/upload/doc.md'}]})} as Response;});
 await openDockFiles([{name:'doc.md',type:'text/markdown',arrayBuffer:async()=>new TextEncoder().encode('doc').buffer} as File]);
 expect(openFileRefPreview).not.toHaveBeenCalled();
});
