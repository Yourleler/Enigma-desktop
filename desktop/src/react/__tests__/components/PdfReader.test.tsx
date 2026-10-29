/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import PdfReader from '../../components/preview/PdfReader';
import {pdfViewerOptions} from '../../utils/pdf-viewer-options';
vi.mock('../../stores',()=>({useStore:(select:Function)=>select({locale:'zh'})}));
vi.mock('../../utils/link-open',()=>({openInternalLink:vi.fn()}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function attachViewer(frame:HTMLIFrameElement){
 const callbacks=new Map<string,Function>();const options=new Map<string,unknown>();
 const viewer={initializedPromise:Promise.resolve(),eventBus:{on:vi.fn((name:string,fn:Function)=>callbacks.set(name,fn))},open:vi.fn(async()=>{callbacks.get('documentinit')?.({});}),close:vi.fn(async()=>{}),setTitleUsingUrl:vi.fn(),pdfDocument:{numPages:3},pdfViewer:{currentPageNumber:1,currentScaleValue:'page-width',pagesRotation:0}};
 Object.assign(frame.contentWindow!,{PDFViewerApplication:viewer,PDFViewerApplicationOptions:{setAll:vi.fn((next:Record<string,unknown>)=>Object.entries(next).forEach(([k,v])=>options.set(k,v))),get:(key:string)=>options.get(key)}});
 return {viewer,options};
}
it('uses the official UI with scripting disabled before passing document data',async()=>{
 render(<PdfReader url="blob:test" base64={btoa('%PDF-test')} name="new.pdf" onSystemReader={vi.fn()}/>);
 const frame=screen.getByTitle('new.pdf · 完整 PDF 阅读器') as HTMLIFrameElement;
 const {viewer,options}=attachViewer(frame);
 await act(async()=>{document.dispatchEvent(new CustomEvent('webviewerloaded',{detail:{source:frame.contentWindow}}));fireEvent.load(frame);});
 await waitFor(()=>expect(viewer.open).toHaveBeenCalledWith({data:expect.any(Uint8Array)}));
 expect(options.get('enableScripting')).toBe(false);expect(options.get('disablePreferences')).toBe(true);
 expect(options.get('defaultUrl')).toBe('');expect(viewer.setTitleUsingUrl).toHaveBeenCalledWith('new.pdf');
 expect(screen.queryByRole('status')).toBeNull();cleanup();expect(viewer.close).toHaveBeenCalled();
});
it('does not pass a document to a viewer that missed secure initialization',async()=>{
 render(<PdfReader url="blob:test" base64={btoa('%PDF-test')} name="new.pdf" onSystemReader={vi.fn()}/>);
 const frame=screen.getByTitle('new.pdf · 完整 PDF 阅读器') as HTMLIFrameElement;const {viewer}=attachViewer(frame);
 await act(async()=>{fireEvent.load(frame);});expect(await screen.findByRole('alert')).toHaveTextContent('初始化失败');expect(viewer.open).not.toHaveBeenCalled();
});
it('does not open a slow response after the preview has closed',async()=>{
 let resolve!:(value:Response)=>void;const fetchMock=vi.fn(()=>new Promise<Response>(r=>resolve=r));vi.stubGlobal('fetch',fetchMock);
 const view=render(<PdfReader url="blob:slow" name="slow.pdf" onSystemReader={vi.fn()}/>);
 const frame=screen.getByTitle('slow.pdf · 完整 PDF 阅读器') as HTMLIFrameElement;const {viewer}=attachViewer(frame);
 await act(async()=>{document.dispatchEvent(new CustomEvent('webviewerloaded',{detail:{source:frame.contentWindow}}));fireEvent.load(frame);});
 await waitFor(()=>expect(fetchMock).toHaveBeenCalled());view.unmount();
 await act(async()=>{resolve(new Response(new Uint8Array([1,2])));});expect(viewer.open).not.toHaveBeenCalled();expect(viewer.close).toHaveBeenCalled();
});
it('keeps preview edits and background model downloads disabled and uses app locale',()=>{
 expect(pdfViewerOptions('zh',true)).toMatchObject({annotationEditorMode:-1,annotationMode:1,enableAltTextModelDownload:false,localeProperties:{lang:'zh-CN'},viewerCssTheme:2});
});

it('restores through the upstream initial view so later initialization cannot reset the page',async()=>{
 const key=crypto.randomUUID();const props={url:'blob:restore',restoreKey:key,base64:btoa('%PDF'),name:'restore.pdf',onSystemReader:vi.fn()};
 const first=render(<PdfReader {...props}/>);let frame=screen.getByTitle('restore.pdf · 完整 PDF 阅读器') as HTMLIFrameElement;const one=attachViewer(frame);
 await act(async()=>{document.dispatchEvent(new CustomEvent('webviewerloaded',{detail:{source:frame.contentWindow}}));fireEvent.load(frame);});
 Object.assign(one.viewer.pdfViewer,{currentPageNumber:2,currentScaleValue:'1.25',pagesRotation:90});first.unmount();
 render(<PdfReader {...props}/>);frame=screen.getByTitle('restore.pdf · 完整 PDF 阅读器') as HTMLIFrameElement;const two=attachViewer(frame);
 await act(async()=>{document.dispatchEvent(new CustomEvent('webviewerloaded',{detail:{source:frame.contentWindow}}));fireEvent.load(frame);});
 expect(two.viewer).toMatchObject({initialBookmark:'page=2&zoom=125',initialRotation:90});
 expect(typeof (two.viewer as any)._initializeAutoPrint).toBe('function');
});
