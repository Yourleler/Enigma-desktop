// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach, expect, it} from 'vitest';
import {EditorView} from '@codemirror/view';
import {SearchQuery,getSearchQuery,setSearchQuery,openSearchPanel,searchPanelOpen} from '@codemirror/search';
import {DiffReader} from '../DiffReader';
afterEach(cleanup);
it('shows frozen context as one source document with a line anchor rather than an unchanged comparison',()=>{
 const view=render(<DiffReader sourceOnly version="context-source" line={2} change={{repo:'r',file:'context.ts',before:{content:'first\nsecond'},after:{content:'first\nsecond'}}}/>);
 expect(screen.getByRole('region',{name:'源码 context.ts'})).toBeVisible();
 expect(view.container.querySelectorAll('.cm-editor')).toHaveLength(1);
 expect(screen.queryByRole('button',{name:'双栏'})).toBeNull();expect(screen.queryByRole('button',{name:'展开全文'})).toBeNull();
 const editor=EditorView.findFromDOM(view.container.querySelector('.cm-editor') as HTMLElement)!;
 expect(editor.state.doc.lineAt(editor.state.selection.main.head).number).toBe(2);
});
it('commits pasted search text before the first Enter without requiring a keyup or blur',()=>{
 const view=render(<DiffReader version="paste-search" change={{repo:'r',file:'file.ts',before:{content:'old value'},after:{content:'new needle'}}}/>);
 fireEvent.click(screen.getByRole('button',{name:'查找'}));
 fireEvent.input(screen.getByRole('textbox',{name:'查找'}),{target:{value:'needle'}});
 const editor=EditorView.findFromDOM(view.container.querySelector('.cm-merge-b') as HTMLElement)!;
 expect(getSearchQuery(editor.state).search).toBe('needle');
});
it('does not offer text controls or a stale chunk count when the body was not retained',()=>{
  render(<DiffReader version="v" change={{repo:'r',file:'large.txt',change:'added',after:{size:520000,omitted:'文件超过512KB，仅保留变化标记'}}}/>);
  expect(screen.getByText(/520,000 字节/)).toBeVisible();
  expect(screen.queryByRole('button',{name:'展开全文'})).toBeNull();
  expect(screen.queryByRole('button',{name:'查找'})).toBeNull();
  expect(screen.queryByText(/\d+ 处/)).toBeNull();
});
it('shows rename origins and unknown authorship independently of the file-list width',()=>{
  render(<DiffReader version="v" change={{repo:'r',file:'new.bin',previousPath:'old.bin',change:'renamed',attribution:'unattributed',before:{size:3,omitted:'二进制文件'},after:{size:3,omitted:'二进制文件'}}}/>);
  expect(screen.getByText('old.bin → new.bin')).toBeVisible();
  expect(screen.getByText(/不代表由助手写入/)).toBeVisible();
});
const longChange=()=>({repo:'r',file:'long.ts',before:{content:Array.from({length:1200},(_,i)=>`const item${i+1} = ${i+1};`).join('\n')},after:{content:Array.from({length:1200},(_,i)=>`const item${i+1} = ${i===1099?110000:i+1};`).join('\n')}});
const targetEditor=(container:HTMLElement)=>EditorView.findFromDOM(container.querySelector('.cm-editor.cm-merge-b') as HTMLElement||container.querySelector('.cm-editor') as HTMLElement)!;
it('retains the selected source range and search through split, wrapping and folding changes',()=>{
 const view=render(<DiffReader version="reading-preservation" change={longChange()}/>);let editor=targetEditor(view.container);
 const from=editor.state.doc.line(1100).from;
 act(()=>{openSearchPanel(editor);editor.dispatch({selection:{anchor:from,head:from+13},effects:setSearchQuery.of(new SearchQuery({search:'item1100',caseSensitive:true}))});});
 for(const name of ['双栏','换行','展开全文','单栏']){
   fireEvent.click(screen.getByRole('button',{name}));editor=targetEditor(view.container);
   expect(editor.state.selection.main.from).toBe(from);expect(editor.state.selection.main.to).toBe(from+13);
   expect(getSearchQuery(editor.state).search).toBe('item1100');expect(getSearchQuery(editor.state).caseSensitive).toBe(true);expect(searchPanelOpen(editor.state)).toBe(true);
 }
 view.unmount();
 const reopened=render(<DiffReader version="reading-preservation" change={longChange()}/>);
 expect(targetEditor(reopened.container).state.selection.main.from).toBe(from);
});
it('preserves manual reading after an initial anchor but honors a new baseline anchor',()=>{
 const view=render(<DiffReader version="source-anchor" change={longChange()} line={1100}/>);
 let editor=targetEditor(view.container);
 expect(editor.state.doc.lineAt(editor.state.selection.main.head).number).toBe(1100);
 act(()=>editor.dispatch({selection:{anchor:editor.state.doc.line(1090).from}}));
 fireEvent.click(screen.getByRole('button',{name:'双栏'}));
 editor=targetEditor(view.container);expect(editor.state.doc.lineAt(editor.state.selection.main.head).number).toBe(1090);
 view.rerender(<DiffReader version="source-anchor" change={longChange()} line={12} side="baseline"/>);
 expect(screen.getByRole('button',{name:'双栏'})).toHaveAttribute('aria-pressed','true');
 const before=EditorView.findFromDOM(view.container.querySelector('.cm-merge-a') as HTMLElement)!;
 expect(before.state.doc.lineAt(before.state.selection.main.head).number).toBe(12);
 editor=targetEditor(view.container);expect(editor.state.doc.lineAt(editor.state.selection.main.head).number).toBe(1090);
 fireEvent.click(screen.getByRole('button',{name:'双栏'}));fireEvent.click(screen.getByRole('button',{name:'单栏'}));
 const restored=EditorView.findFromDOM(view.container.querySelector('.cm-merge-a') as HTMLElement)!;
 expect(restored.state.doc.lineAt(restored.state.selection.main.head).number).toBe(12);
});
it('does not apply old reading state to a new version or changed contents',()=>{
 const view=render(<DiffReader version="previous-file" change={longChange()}/>);const editor=targetEditor(view.container);
 act(()=>editor.dispatch({selection:{anchor:editor.state.doc.line(1100).from},effects:setSearchQuery.of(new SearchQuery({search:'item1100'}))}));
 view.rerender(<DiffReader version="next-file" change={longChange()}/>);expect(targetEditor(view.container).state.selection.main.from).toBe(0);
 view.rerender(<DiffReader version="previous-file" change={{repo:'r',file:'long.ts',before:{content:'short'},after:{content:'short changed'}}}/>);
 expect(targetEditor(view.container).state.selection.main.from).toBe(0);expect(getSearchQuery(targetEditor(view.container).state).search).toBe('');
});
