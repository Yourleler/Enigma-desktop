/** @vitest-environment jsdom */
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import JSZip from 'jszip';
import {checkOfficeArchive,loadOfficePreviewBinary,officePreviewErrorMessage} from '../../utils/office-preview-binary';
import type {PreviewItem} from '../../types';
const {fetchMock,connection}=vi.hoisted(()=>({fetchMock:vi.fn(),connection:{current:null as any}}));
vi.mock('../../hooks/use-hana-fetch',()=>({hanaFetch:fetchMock}));
vi.mock('../../stores',()=>({useStore:{getState:()=>({})}}));
vi.mock('../../services/server-connection',()=>({resolveServerConnection:()=>connection.current,isLocalOwnerConnection:(value:any)=>value?.kind==='local'}));
const item:PreviewItem={id:'docx',type:'docx',title:'new.docx',content:'',filePath:'/new-tests/new.docx',remoteContentRef:{kind:'workbench-file',mountId:'m',subdir:'docs',name:'new.docx',contentPath:''}};
let data:Uint8Array;
beforeEach(async()=>{connection.current=null;fetchMock.mockReset();const zip=new JSZip();zip.file('word/document.xml','<test/>');data=await zip.generateAsync({type:'uint8array'});document.documentElement.dataset.platform='desktop';});
afterEach(()=>{delete document.documentElement.dataset.platform;});
it('uses the remote content boundary instead of a disclosed native path in Web/remote sessions',async()=>{
 document.documentElement.dataset.platform='web';connection.current={kind:'custom_remote'};const native=vi.fn();window.platform={readFileBase64:native} as never;fetchMock.mockResolvedValue(new Response(new Uint8Array(data)));
 expect(await loadOfficePreviewBinary(item,new AbortController().signal)).toEqual(data);expect(native).not.toHaveBeenCalled();expect(fetchMock.mock.calls[0][0]).toBe('/api/workbench/content?mountId=m&subdir=docs&name=new.docx');
});
it('stops a native read that completed after cancellation',async()=>{
 const abort=new AbortController();window.platform={readFileBase64:vi.fn(async()=>{abort.abort();return btoa('late');})} as never;
 await expect(loadOfficePreviewBinary(item,abort.signal)).rejects.toMatchObject({name:'AbortError'});
});
it('rejects truncated archives and oversized expanded metadata before parsing',()=>{
 expect(()=>checkOfficeArchive(new Uint8Array([1,2,3]))).toThrow('损坏');
 const bytes=new Uint8Array(data);const view=new DataView(bytes.buffer);const end=bytes.length-22;const offset=view.getUint32(end+16,true);view.setUint32(offset+24,90*1024*1024,true);expect(()=>checkOfficeArchive(bytes)).toThrow('80 MB');
});

it('turns parser internals into actionable document errors',()=>{expect(officePreviewErrorMessage(new Error('Could not find main document part.'))).toContain('结构不完整');expect(officePreviewErrorMessage(new Error('Failed to fetch'))).toContain('连接中断');});
