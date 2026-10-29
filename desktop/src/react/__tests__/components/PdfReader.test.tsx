/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import PdfReader from '../../components/preview/PdfReader';
const mocks=vi.hoisted(()=>({load:vi.fn(),viewers:[] as any[],ports:[] as any[],tasks:[] as any[],open:vi.fn()}));
vi.mock('../../utils/link-open',()=>({openInternalLink:mocks.open}));
vi.mock('pdfjs-dist',()=>({AnnotationMode:{ENABLE:1},PDFWorker:{create:vi.fn(()=>({}))},getDocument:mocks.load}));
vi.mock('pdfjs-dist/build/pdf.worker.mjs?worker',()=>({default:class {terminate=vi.fn();constructor(){mocks.ports.push(this);}}}));
vi.mock('pdfjs-dist/web/pdf_viewer.css?inline',()=>({default:':root {--page-margin:8px} .page {color:black}'}));
vi.mock('pdfjs-dist/web/pdf_viewer.mjs',()=>({
 EventBus:class{handlers=new Map<string,Function[]>();dispatch=vi.fn((name:string,value:any)=>this.handlers.get(name)?.forEach(fn=>fn(value)));on(name:string,fn:Function){this.handlers.set(name,[...(this.handlers.get(name)||[]),fn]);}},
 PDFLinkService:class{addLinkAttributes=vi.fn();setDocument=vi.fn();setViewer=vi.fn();},PDFFindController:class{},
 PDFViewer:class{bus:any;currentPageNumber=1;pagesCount=12;currentScaleValue='page-width';pdfDocument:any;pagesRotation=0;updateScale=vi.fn();setDocument=vi.fn((doc:any)=>{this.pdfDocument=doc;if(doc)this.bus.dispatch('pagesinit',{});});constructor(options:any){this.bus=options.eventBus;mocks.viewers.push(this);}}
}));
beforeEach(()=>{
 mocks.load.mockReset();mocks.viewers.length=0;mocks.ports.length=0;mocks.tasks.length=0;
 mocks.load.mockImplementation(()=>{const task={promise:Promise.resolve({numPages:12}),destroy:vi.fn(()=>Promise.resolve())};mocks.tasks.push(task);return task;});
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const show=()=>render(<PdfReader url="file:///new-test/report.pdf" restoreKey={crypto.randomUUID()} name="report.pdf" onSystemReader={vi.fn()}/>);
it('tracks page events, clamps requested pages and releases the worker on close',async()=>{
 const view=show();await waitFor(()=>expect(screen.getByLabelText('PDF 页码')).toBeEnabled());
 const current=mocks.viewers[0];
 act(()=>current.bus.dispatch('pagechanging',{pageNumber:5}));
 expect(screen.getByLabelText('PDF 页码')).toHaveValue('5');
 fireEvent.change(screen.getByLabelText('PDF 页码'),{target:{value:'999'}});fireEvent.blur(screen.getByLabelText('PDF 页码'));
 expect(current.currentPageNumber).toBe(12);
 view.unmount();await waitFor(()=>expect(mocks.ports[0].terminate).toHaveBeenCalledOnce());expect(current.setDocument).toHaveBeenLastCalledWith(null);
});
it('uses search events for match feedback and confines the find shortcut to this reader',async()=>{
 show();await waitFor(()=>expect(screen.getByLabelText('搜索 PDF 内容')).toBeEnabled());
 const input=screen.getByLabelText('搜索 PDF 内容');fireEvent.change(input,{target:{value:'chapter'}});
 await waitFor(()=>expect(mocks.viewers[0].bus.dispatch).toHaveBeenCalledWith('find',expect.objectContaining({query:'chapter',highlightAll:true})));
 act(()=>{mocks.viewers[0].bus.dispatch('updatefindcontrolstate',{state:0,matchesCount:{current:2,total:4}});mocks.viewers[0].bus.dispatch('updatefindmatchescount',{matchesCount:{current:2,total:4}});});expect(screen.getByText('2 / 4')).toBeVisible();
 fireEvent.keyDown(input,{key:'Enter',shiftKey:true});expect(mocks.viewers[0].bus.dispatch).toHaveBeenLastCalledWith('find',expect.objectContaining({type:'again',findPrevious:true}));
 fireEvent.keyDown(screen.getByLabelText('PDF 正文'),{key:'f',ctrlKey:true});expect(input).toHaveFocus();
});
it('does not attach a late document after the panel closes',async()=>{
 let resolve!:(value:any)=>void;const destroy=vi.fn(()=>Promise.resolve());mocks.load.mockReturnValue({promise:new Promise(r=>resolve=r),destroy});
 const view=show();await waitFor(()=>expect(mocks.load).toHaveBeenCalledOnce());const current=mocks.viewers[0];view.unmount();
 await act(async()=>{resolve({numPages:4});});expect(current.setDocument).not.toHaveBeenCalledWith(expect.objectContaining({numPages:4}));expect(destroy).toHaveBeenCalledOnce();expect(mocks.ports[0].terminate).toHaveBeenCalledOnce();
});
it('shows password fallback and retry releases the failed loading task',async()=>{
 const destroy=vi.fn(()=>Promise.resolve());mocks.load.mockImplementationOnce(()=>({promise:Promise.reject({name:'PasswordException'}),destroy}));show();
 expect(await screen.findByRole('alert')).toHaveTextContent('需要密码');fireEvent.click(screen.getByRole('button',{name:'重新加载'}));
 await waitFor(()=>expect(screen.getByLabelText('PDF 页码')).toBeEnabled());expect(destroy).toHaveBeenCalledOnce();expect(mocks.ports[0].terminate).toHaveBeenCalledOnce();
});
it('restores the last page, scale and rotation when the same file is reopened',async()=>{
 const key=crypto.randomUUID();
 const view=render(<PdfReader url="file:///new-test/keep.pdf" restoreKey={key} name="keep.pdf" onSystemReader={vi.fn()}/>);
 await waitFor(()=>expect(screen.getByLabelText('PDF 页码')).toBeEnabled());
 Object.assign(mocks.viewers[0],{currentPageNumber:7,currentScaleValue:'1.25',pagesRotation:90});view.unmount();
 render(<PdfReader url="file:///new-test/keep.pdf" restoreKey={key} name="keep.pdf" onSystemReader={vi.fn()}/>);
 await waitFor(()=>expect(screen.getByLabelText('PDF 页码')).toBeEnabled());
 expect(mocks.viewers[1]).toMatchObject({currentPageNumber:7,currentScaleValue:'1.25',pagesRotation:90});
});
