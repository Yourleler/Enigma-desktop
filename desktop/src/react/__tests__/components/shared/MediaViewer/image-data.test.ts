/** @vitest-environment jsdom */
import {afterEach,expect,it,vi} from 'vitest';
import {loadImageData} from '../../../../components/shared/MediaViewer/image-data';
const mocks=vi.hoisted(()=>({load:vi.fn(),cleanup:vi.fn(),images:[] as any[]}));
vi.mock('../../../../components/shared/MediaViewer/media-source',()=>({loadMediaSource:mocks.load}));
afterEach(()=>{vi.unstubAllGlobals();mocks.cleanup.mockClear();mocks.load.mockReset();mocks.images.length=0;});
const file={id:'a',source:'desk',kind:'image',name:'new.png',path:'/new-tests/new.png'} as const;
function images(){vi.stubGlobal('Image',class{naturalWidth=600;naturalHeight=400;onload:any;onerror:any;removeAttribute=vi.fn();set src(value:string){mocks.images.push(this);}});}
it('decodes actual dimensions and keeps resource cleanup with the returned source',async()=>{
 images();mocks.load.mockResolvedValue({url:'blob:media',cleanup:mocks.cleanup});const result=loadImageData(file,new AbortController().signal);await vi.waitFor(()=>expect(mocks.images.length).toBe(1));mocks.images[0].onload();expect(await result).toMatchObject({src:'blob:media',width:600,height:400});expect(mocks.cleanup).not.toHaveBeenCalled();(await result).cleanup?.();expect(mocks.cleanup).toHaveBeenCalledOnce();
});
it('releases a source that resolves after cancellation',async()=>{
 const abort=new AbortController();mocks.load.mockImplementation(async()=>{abort.abort();return {url:'blob:late',cleanup:mocks.cleanup};});await expect(loadImageData(file,abort.signal)).rejects.toMatchObject({name:'AbortError'});expect(mocks.cleanup).toHaveBeenCalledOnce();
});
it('cancels pending decoding and frees the URL without reporting success',async()=>{
 images();mocks.load.mockResolvedValue({url:'blob:slow',cleanup:mocks.cleanup});const abort=new AbortController();const result=loadImageData(file,abort.signal);const rejected=expect(result).rejects.toMatchObject({name:'AbortError'});await vi.waitFor(()=>expect(mocks.images.length).toBe(1));abort.abort();await rejected;expect(mocks.cleanup).toHaveBeenCalledOnce();expect(mocks.images[0].onload).toBeNull();
});
