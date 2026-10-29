/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import DocxPreview from '../../components/preview/DocxPreview';
const mocks=vi.hoisted(()=>({load:vi.fn(async()=>new Uint8Array([1,2])),link:vi.fn()}));
vi.mock('../../stores',()=>({useStore:(selector:Function)=>selector({activeServerConnectionId:'test'})}));
vi.mock('../../utils/office-preview-binary',()=>({loadOfficePreviewBinary:mocks.load,loadOfficePreviewText:vi.fn(async()=>'<p>按需读取的文本</p>'),officePreviewErrorMessage:()=> '文档无法读取'}));
vi.mock('../../utils/link-open',()=>({openInternalLink:mocks.link}));
afterEach(()=>{cleanup();mocks.load.mockClear();mocks.link.mockClear();});
const item={id:'word',type:'docx',title:'new.docx',content:'<p>正文</p><script>bad()</script>',fileVersion:{size:2,mtimeMs:1}};
function report(frame:HTMLIFrameElement,type:string,fields:Record<string,unknown>={}){
 const channel=new URL(frame.src).hash.slice(1);
 act(()=>{window.dispatchEvent(new MessageEvent('message',{source:frame.contentWindow!,data:{channel,type,...fields}}));});
}
it('isolates document scripts from the host and ignores forged status messages',async()=>{
 render(<DocxPreview previewItem={item}/>);const frame=screen.getByTitle('new.docx · Word 版式') as HTMLIFrameElement;
 expect(frame).toHaveAttribute('sandbox','allow-scripts');
 act(()=>{window.dispatchEvent(new MessageEvent('message',{data:{type:'rendered',pages:99}}));});expect(screen.queryByText(/99 页/)).toBeNull();
 report(frame,'ready');await waitFor(()=>expect(mocks.load).toHaveBeenCalled());report(frame,'rendered',{pages:2});expect(screen.getByText('原始版式 · 2 页')).toBeVisible();
});
it('preserves a rendered frame when unchanged version metadata is refreshed',async()=>{
 const view=render(<DocxPreview previewItem={item}/>);const frame=screen.getByTitle('new.docx · Word 版式') as HTMLIFrameElement;report(frame,'ready');report(frame,'rendered',{pages:2});
 view.rerender(<DocxPreview previewItem={{...item,fileVersion:{...item.fileVersion}}}/>);expect(screen.getByTitle('new.docx · Word 版式')).toBe(frame);expect(mocks.load).toHaveBeenCalledTimes(1);
});
it('releases failed rendering and offers sanitized text reading',async()=>{
 render(<DocxPreview previewItem={item}/>);const frame=screen.getByTitle('new.docx · Word 版式') as HTMLIFrameElement;report(frame,'error',{message:'不能渲染'});
 expect(screen.queryByTitle('new.docx · Word 版式')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'文本阅读'}));
 expect(screen.getByText('正文')).toBeVisible();expect(document.querySelector('.enigma-docx-text script')).toBeNull();
});
it('does not route executable links or messages from another frame',()=>{
 render(<DocxPreview previewItem={item}/>);const frame=screen.getByTitle('new.docx · Word 版式') as HTMLIFrameElement;
 const channel=new URL(frame.src).hash.slice(1);
 act(()=>window.dispatchEvent(new MessageEvent('message',{source:window,data:{channel,type:'link',href:'https://wrong.example'}})));expect(mocks.link).not.toHaveBeenCalled();
 report(frame,'link',{href:'javascript:alert(1)'});expect(mocks.link).not.toHaveBeenCalled();
 report(frame,'link',{href:'https://example.com/new-test'});expect(mocks.link).toHaveBeenCalledWith('https://example.com/new-test',{origin:'desk'});
});

it('loads semantic text on demand when layout tabs only contain metadata',async()=>{
 render(<DocxPreview previewItem={{...item,content:''}}/>);
 fireEvent.click(screen.getByRole('button',{name:'文本'}));
 expect(await screen.findByText('按需读取的文本')).toBeVisible();
});

it('displays a frame-confirmed search limit separately from exact counts',()=>{
 render(<DocxPreview previewItem={item}/>);const frame=screen.getByTitle('new.docx · Word 版式') as HTMLIFrameElement;report(frame,'rendered',{pages:1});fireEvent.change(screen.getByRole('textbox',{name:'搜索文档内容'}),{target:{value:'word'}});report(frame,'matches',{index:1,count:2000,truncated:false});expect(screen.getByText('1 / 2000')).toBeTruthy();expect(screen.queryByText(/已显示前/)).toBeNull();report(frame,'matches',{index:1,count:2000,truncated:true});expect(screen.getByText('1 / 2000+')).toBeTruthy();expect(screen.getByText('已显示前 2000 项，请缩小查询范围。')).toBeTruthy();
});
