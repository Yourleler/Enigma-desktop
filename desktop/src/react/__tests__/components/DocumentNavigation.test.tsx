// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {DocumentNavigation} from '../../components/preview/DocumentNavigation';
import {LinkDiagnosticsBadge} from '../../components/preview/MarkdownChrome';
beforeEach(()=>vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('shows searchable headings including deeper levels and sends the real heading location',()=>{
 const onJump=vi.fn();const headings=[{id:'a',text:'简介',level:1,line:0,offset:0},{id:'b',text:'深入细节',level:4,line:50,offset:500}];render(<DocumentNavigation documentId="a" headings={headings} activeHeadingId="b" editable={false} wrapLines onJump={onJump} onFind={vi.fn()} onGotoLine={vi.fn()} onToggleWrap={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'目录 2'}));fireEvent.change(screen.getByRole('textbox',{name:'筛选目录'}),{target:{value:'细节'}});expect(screen.queryByRole('button',{name:'简介'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'深入细节'}));expect(onJump).toHaveBeenCalledWith(headings[1]);expect(screen.getByRole('button',{name:'深入细节'})).toHaveAttribute('aria-current','location');
});
it('makes code navigation commands explicit without requiring hover discovery',()=>{
 const find=vi.fn(),goto=vi.fn(),wrap=vi.fn(),fold=vi.fn();render(<DocumentNavigation documentId="a" headings={[]} activeHeadingId={null} editable wrapLines onJump={vi.fn()} onFind={find} onGotoLine={goto} onToggleWrap={wrap} onFold={fold}/>);
 fireEvent.click(screen.getByRole('button',{name:'查找 / 替换'}));fireEvent.click(screen.getByRole('button',{name:'阅读选项'}));fireEvent.click(screen.getByRole('button',{name:'跳转行'}));fireEvent.click(screen.getByRole('button',{name:'阅读选项'}));fireEvent.click(screen.getByRole('button',{name:'自动换行'}));fireEvent.click(screen.getByRole('button',{name:'阅读选项'}));fireEvent.click(screen.getByRole('button',{name:'折叠全部章节'}));expect([find,goto,wrap,fold].every(fn=>fn.mock.calls.length===1)).toBe(true);
});
it('shows malformed anchor diagnostics without crashing the document',()=>{
 render(<LinkDiagnosticsBadge previewItem={{id:'a',type:'markdown',title:'test.md',filePath:'/test/test.md',content:'[bad](#bad%ZZ)'}} headings={[]}/>);expect(screen.getByText('1 个链接问题')).toHaveAttribute('title',expect.stringContaining('编码无效'));
});

it('explains exactly what HTML search and copy act on',()=>{
 render(<DocumentNavigation documentId="html" contentType="html" headings={[]} activeHeadingId={null} editable={false} wrapLines onJump={vi.fn()} onFind={vi.fn()} onGotoLine={vi.fn()} onToggleWrap={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'文件预览帮助'}));
 expect(screen.getByText(/复制整个 HTML 文件的源码/)).toBeVisible();expect(screen.getByText(/可见网页文字/)).toBeVisible();
});
