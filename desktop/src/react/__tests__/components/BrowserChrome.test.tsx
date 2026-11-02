/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {BrowserChrome} from '../../browser/BrowserChrome';
import type {BrowserViewerUpdate} from '../../types';
const state:BrowserViewerUpdate={sessionPath:null,activeTabId:'a',url:'http://localhost:3000/one',tabs:[{tabId:'a',title:'First'},{tabId:'b',title:'Second'}],zoomFactor:1};
afterEach(()=>{cleanup();vi.useRealTimers();});
it('shares address, reading and tab commands without double-click closing',async()=>{
 const command=vi.fn(async(..._args:unknown[])=>{});render(<BrowserChrome state={state} ready status="手动浏览" onCommand={command} onPreview={vi.fn()}/>);
 const address=screen.getByRole('textbox',{name:'网页地址'});fireEvent.change(address,{target:{value:'localhost:4567/new'}});fireEvent.submit(address.closest('form')!);
 await waitFor(()=>expect(command).toHaveBeenCalledWith('navigate',{url:'http://localhost:4567/new'}));
 fireEvent.doubleClick(screen.getByRole('tab',{name:'First'}));expect(command).not.toHaveBeenCalledWith('closeTab',expect.anything());
 fireEvent.keyDown(screen.getByRole('tab',{name:'First'}),{key:'ArrowRight'});expect(command).toHaveBeenCalledWith('switchTab',{tabId:'b'});
 fireEvent.click(screen.getByRole('button',{name:'放大网页'}));expect(command).toHaveBeenCalledWith('zoom',{zoomFactor:1.1});
});
it('cancels the pending query when switching tabs instead of searching the new page',async()=>{
 vi.useFakeTimers();const command=vi.fn(async(..._args:unknown[])=>{});const view=render(<BrowserChrome state={state} ready status="手动浏览" onCommand={command} onPreview={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'查找网页内容'}));fireEvent.change(screen.getByRole('textbox',{name:'查找网页内容'}),{target:{value:'first only'}});
 view.rerender(<BrowserChrome state={{...state,activeTabId:'b',url:'http://localhost:3000/two'}} ready status="手动浏览" onCommand={command} onPreview={vi.fn()}/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(300);});expect(command).not.toHaveBeenCalledWith('find',expect.objectContaining({query:'first only'}));
});
it('shows actual match totals and supports continuing and closing find',async()=>{
 const command=vi.fn(async(..._args:unknown[])=>{});const view=render(<BrowserChrome state={state} ready status="手动浏览" onCommand={command} onPreview={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'查找网页内容'}));fireEvent.change(screen.getByRole('textbox',{name:'查找网页内容'}),{target:{value:'needle'}});
 await waitFor(()=>expect(command).toHaveBeenCalledWith('find',expect.objectContaining({query:'needle',tabId:'a'})));
 view.rerender(<BrowserChrome state={{...state,find:{query:'needle',active:2,matches:5,pending:false,matchCase:false}}} ready status="手动浏览" onCommand={command} onPreview={vi.fn()}/>);
 expect(screen.getByText('2 / 5')).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'上一个匹配'}));expect(command).toHaveBeenCalledWith('find',expect.objectContaining({next:true,forward:false}));
 fireEvent.click(screen.getByRole('button',{name:'关闭查找'}));expect(command).toHaveBeenCalledWith('stopFind',{});expect(screen.queryByRole('search')).toBeNull();
});
it('does not let the typing debounce restart a search after Enter advances it',async()=>{
 vi.useFakeTimers();const command=vi.fn(async(..._args:unknown[])=>{});render(<BrowserChrome state={state} ready status="手动浏览" onCommand={command} onPreview={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'查找网页内容'}));const input=screen.getByRole('textbox',{name:'查找网页内容'});fireEvent.change(input,{target:{value:'needle'}});fireEvent.keyDown(input,{key:'Enter'});
 await act(async()=>{await vi.advanceTimersByTimeAsync(400);});expect(command.mock.calls.filter(call=>call[0]==='find')).toEqual([['find',{query:'needle',matchCase:false,next:true,forward:true}]]);
});
it('restores the committed address after a cancelled provisional navigation',async()=>{
 const command=vi.fn(async()=>{});const view=render(<BrowserChrome state={state} ready status="手动浏览" onCommand={command} onPreview={vi.fn()}/>);
 const address=screen.getByRole('textbox',{name:'网页地址'});fireEvent.focus(address);fireEvent.change(address,{target:{value:'http://localhost:3000/slow'}});fireEvent.submit(address.closest('form')!);
 view.rerender(<BrowserChrome state={{...state,loading:true}} ready status="正在加载" onCommand={command} onPreview={vi.fn()}/>);
 expect(address).toHaveValue('http://localhost:3000/slow');
 fireEvent.click(screen.getByRole('button',{name:'停止加载'}));
 view.rerender(<BrowserChrome state={{...state,loading:false}} ready status="手动浏览" onCommand={command} onPreview={vi.fn()}/>);
 expect(address).toHaveValue(state.url);
 expect(command).toHaveBeenCalledWith('stop',{});
 // A newer unfinished address must survive unrelated load state updates.
 fireEvent.focus(address);fireEvent.change(address,{target:{value:'example.org/draft'}});
 view.rerender(<BrowserChrome state={{...state,loading:true}} ready status="正在加载" onCommand={command} onPreview={vi.fn()}/>);
 view.rerender(<BrowserChrome state={{...state,loading:false}} ready status="手动浏览" onCommand={command} onPreview={vi.fn()}/>);
 expect(address).toHaveValue('example.org/draft');
});
it('ignores a rejected operation from the previous page and clears find state across workspaces',async()=>{
 let fail!:(error:Error)=>void;const command=vi.fn(()=>new Promise<void>((_resolve,reject)=>{fail=reject;}));
 const view=render(<BrowserChrome state={state} ready status="手动浏览" onCommand={command} onPreview={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'刷新网页'}));
 view.rerender(<BrowserChrome state={{...state,activeTabId:'b',url:'https://example.com/new'}} ready status="手动浏览" onCommand={command} onPreview={vi.fn()}/>);
 await act(async()=>fail(new Error('Old tab failed')));expect(screen.queryByRole('alert')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'查找网页内容'}));fireEvent.change(screen.getByRole('textbox',{name:'查找网页内容'}),{target:{value:'old scope'}});
 view.rerender(<BrowserChrome state={{...state,sessionPath:'another',activeTabId:'b',url:'https://example.com/new'}} ready status="另一个对话" onCommand={command} onPreview={vi.fn()}/>);
 expect(screen.queryByRole('search')).toBeNull();
});
it('does not refocus a different page when closing find completes after a tab switch',async()=>{
 let done!:()=>void;const command=vi.fn(async(action:string)=>{if(action==='stopFind')await new Promise<void>(resolve=>{done=resolve;});});
 const view=render(<BrowserChrome state={state} ready status="手动浏览" onCommand={command} onPreview={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'查找网页内容'}));fireEvent.click(screen.getByRole('button',{name:'关闭查找'}));
 view.rerender(<BrowserChrome state={{...state,activeTabId:'b'}} ready status="手动浏览" onCommand={command} onPreview={vi.fn()}/>);
 await act(async()=>done());expect(command).not.toHaveBeenCalledWith('focusPage',{});
});
it('keeps find controls unavailable after disconnection instead of displaying old results as current',()=>{
 const command=vi.fn(async()=>{}),searched={...state,find:{query:'needle',matches:3,active:1,pending:false,matchCase:false}};
 const view=render(<BrowserChrome state={searched} ready status="手动浏览" onCommand={command} onPreview={vi.fn()}/>);
 expect(screen.getByText('1 / 3')).toBeVisible();view.rerender(<BrowserChrome state={searched} ready={false} status="连接失败" onCommand={command} onPreview={vi.fn()}/>);
 expect(screen.getByRole('textbox',{name:'查找网页内容'})).toBeDisabled();expect(screen.getByRole('button',{name:'下一个匹配'})).toBeDisabled();expect(screen.queryByText('1 / 3')).toBeNull();
 fireEvent.keyDown(screen.getByRole('textbox',{name:'查找网页内容'}),{key:'Enter'});expect(command).not.toHaveBeenCalled();
});
