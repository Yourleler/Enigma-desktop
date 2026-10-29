/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {BrowserViewerApp} from '../../browser-viewer/BrowserViewerApp';
vi.mock('../../bootstrap',()=>({initTheme:vi.fn()}));
const switchTab=vi.fn(),closeTab=vi.fn(),stop=vi.fn();
beforeEach(()=>{
 switchTab.mockClear();closeTab.mockClear();stop.mockClear();
 window.hana={browserViewerState:vi.fn(async()=>({running:true,sessionPath:null,tabs:[{tabId:'a',title:'A'},{tabId:'b',title:'B'}],activeTabId:'a',canGoBack:false})),onBrowserUpdate:vi.fn(()=>vi.fn()),browserSwitchTab:switchTab,browserCloseTab:closeTab,browserEmergencyStop:stop,getSplashInfo:vi.fn(async()=>({locale:'zh'}))} as never;
 window.i18n={load:vi.fn(async()=>{})} as never;
});
afterEach(cleanup);
it('does not revoke control in manual browsing and disabled navigation is truly disabled',async()=>{
 render(<BrowserViewerApp/>);await screen.findByRole('tab',{name:'A'});
 expect(screen.queryByTitle(/停止控制/)).toBeNull();expect(screen.getByTitle('后退')).toBeDisabled();
});
it('keeps double-clicked tabs open and offers independent accessible close controls',async()=>{
 render(<BrowserViewerApp/>);const tab=await screen.findByRole('tab',{name:'A'});fireEvent.doubleClick(tab);expect(closeTab).not.toHaveBeenCalled();
 fireEvent.keyDown(tab,{key:'ArrowRight'});expect(switchTab).toHaveBeenCalledWith('b',null);expect(screen.getByRole('tab',{name:'B'})).toHaveFocus();
 fireEvent.click(screen.getByRole('button',{name:'关闭网页：B'}));expect(closeTab).toHaveBeenCalledWith('b',null);
 await waitFor(()=>expect(window.i18n.load).toHaveBeenCalledWith('zh'));
});

it('refreshes authoritative state after closing an inactive tab on older shells',async()=>{
 render(<BrowserViewerApp/>);await screen.findByRole('tab',{name:'B'});
 vi.mocked(window.hana!.browserViewerState!).mockResolvedValue({running:true,sessionPath:null,tabs:[{tabId:'a',title:'A'}],activeTabId:'a'});
 fireEvent.click(screen.getByRole('button',{name:'关闭网页：B'}));
 await waitFor(()=>expect(screen.queryByRole('tab',{name:'B'})).toBeNull());expect(screen.getByRole('tab',{name:'A'})).toHaveAttribute('aria-selected','true');
});
