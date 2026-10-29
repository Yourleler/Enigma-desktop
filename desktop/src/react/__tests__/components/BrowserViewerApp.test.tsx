/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {BrowserViewerApp} from '../../browser-viewer/BrowserViewerApp';
vi.mock('../../bootstrap',()=>({initTheme:vi.fn()}));
const command=vi.fn(),layout=vi.fn();
let state:any;
beforeEach(()=>{
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});command.mockReset();layout.mockClear();
 state={sessionPath:null,url:'https://example.com',tabs:[{tabId:'a',title:'A'},{tabId:'b',title:'B'}],activeTabId:'a',canGoBack:false};command.mockResolvedValue(state);
 window.hana={browserViewerState:vi.fn(async()=>state),onBrowserUpdate:vi.fn(()=>vi.fn()),browserViewerCommand:command,browserViewerLayout:layout} as never;
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('renders shared address controls and scopes commands to its current workspace',async()=>{
 render(<BrowserViewerApp/>);await screen.findByRole('tab',{name:'A'});expect(screen.queryByTitle(/停止控制/)).toBeNull();expect(screen.getByTitle('后退')).toBeDisabled();
 const address=screen.getByRole('textbox',{name:'网页地址'});fireEvent.change(address,{target:{value:'https://example.com/new'}});fireEvent.submit(address.closest('form')!);
 await waitFor(()=>expect(command).toHaveBeenCalledWith({action:'navigate',sessionPath:null,tabId:'a',url:'https://example.com/new'}));expect(layout).toHaveBeenCalled();
});
it('refreshes actual state after closing a background tab and offers direct redocking',async()=>{
 render(<BrowserViewerApp/>);await screen.findByRole('tab',{name:'B'});command.mockResolvedValue({...state,tabs:[state.tabs[0]]});
 fireEvent.click(screen.getByRole('button',{name:'关闭网页：B'}));await waitFor(()=>expect(screen.queryByRole('tab',{name:'B'})).toBeNull());
 fireEvent.click(screen.getByRole('button',{name:'放回侧栏'}));await waitFor(()=>expect(command).toHaveBeenCalledWith(expect.objectContaining({action:'dock',sessionPath:null})));
});
