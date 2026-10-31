// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {WorkspaceCompanionRail} from '../../components/app/WorkspaceCompanionRail';
import {MainContent} from '../../MainContent';
import {useStore} from '../../stores';
import {useEngineering} from '../state';
import {SidebarLayout,updateLayout} from '../../components/SidebarLayout';
import {useRightDock} from '../../stores/right-dock-store';
import {ActionDialog} from '../Engineering';
vi.mock('../../components/app/WorkspaceFileChangeBridge',()=>({WorkspaceFileChangeBridge:()=>null}));
vi.mock('../../components/right-workspace/RightDock',()=>({RightDock:()=> <button>查看内容</button>}));
vi.mock('../../components/BrowserCard',()=>({BrowserCard:()=>null}));
vi.mock('../../components/ComputerUseOverlay',()=>({ComputerUseOverlay:()=>null}));
beforeEach(()=>{
 vi.stubGlobal('t',(key:string)=>key);vi.stubGlobal('innerWidth',420);vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
 localStorage.clear();document.documentElement.removeAttribute('style');useRightDock.setState({views:{}});
 useStore.setState({jianOpen:true,sidebarOpen:false,sidebarAutoCollapsed:false,jianAutoCollapsed:false,layoutDrawer:'workspace',layoutPriority:'workspace',previewOpen:false,previewExpanded:false,currentTab:'chat',currentChannel:null,welcomeVisible:false});
 useEngineering.setState({snapshot:{connected:true},paneOpen:true,active:'group:reading',form:undefined});
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();useEngineering.setState({snapshot:null,paneOpen:false,active:'',form:undefined});useStore.setState({layoutDrawer:null});});
function Frame(){return <><SidebarLayout restorePreference={false}/><div className="enigma-workspace-frame"><MainContent><button>聊天操作</button></MainContent><WorkspaceCompanionRail/></div></>;}
it('narrow pane occupies the shared frame without recreating the removed floating card or scrim',()=>{
 const {container}=render(<Frame/>);expect(screen.getByRole('complementary',{name:'工作面板'})).toBeInTheDocument();expect(container.querySelector('.main-content')).toHaveAttribute('inert');expect(screen.queryByRole('dialog',{name:'工程内容面板'})).toBeNull();expect(screen.queryByRole('button',{name:'关闭内容面板遮罩'})).toBeNull();
 fireEvent.keyDown(document,{key:'Escape'});expect(useStore.getState().jianOpen).toBe(false);expect(useStore.getState().layoutDrawer).toBeNull();expect(container.querySelector('.main-content')).not.toHaveAttribute('inert');
});
it('closing a narrow pane preserves the selected content and lets it reopen',()=>{
 render(<Frame/>);fireEvent.keyDown(document,{key:'Escape'});expect(useEngineering.getState().active).toBe('group:reading');
 act(()=>{useStore.setState({jianOpen:true,jianAutoCollapsed:false});updateLayout('workspace');});expect(useStore.getState().layoutDrawer).toBe('workspace');expect(screen.getByRole('button',{name:'查看内容'})).toBeInTheDocument();
});
it('removes closed pane controls from keyboard navigation',()=>{
 useStore.setState({jianOpen:false,layoutDrawer:null});const {container}=render(<WorkspaceCompanionRail/>);expect(container.querySelector('#jianSidebar')).toHaveAttribute('inert');
 act(()=>useStore.setState({jianOpen:true}));expect(container.querySelector('#jianSidebar')).not.toHaveAttribute('inert');
});
it('shrinks panels before hiding navigation when 1024px has room for both',()=>{
 vi.stubGlobal('innerWidth',1024);useStore.setState({sidebarOpen:true,jianOpen:true,layoutDrawer:null});render(<Frame/>);act(()=>updateLayout());
 expect(useStore.getState()).toMatchObject({sidebarOpen:true,jianOpen:true,layoutDrawer:null});expect(parseFloat(document.documentElement.style.getPropertyValue('--right-dock-width'))).toBeLessThanOrEqual(384);
});
it('reclaims navigation first when only 780px is available for a workspace and conversation',()=>{
 vi.stubGlobal('innerWidth',780);useStore.setState({sidebarOpen:true,jianOpen:true,layoutDrawer:null});render(<Frame/>);act(()=>updateLayout('workspace'));
 expect(useStore.getState()).toMatchObject({sidebarOpen:false,jianOpen:true,layoutDrawer:null});
});
it('does not let Escape close the pane underneath an operation form',()=>{
 useEngineering.setState({sessionPath:'/test',formSession:'/test',form:{id:'sample',title:'操作表单',description:'test',group:'reading',fields:[]},formLoading:false,formError:''});
 render(<><Frame/><ActionDialog/></>);fireEvent.keyDown(screen.getByRole('button',{name:'关闭 操作表单'}),{key:'Escape'});expect(useEngineering.getState().form).toBeUndefined();expect(useStore.getState().jianOpen).toBe(true);
});
it('keeps independently managed previews accessible when the pane closes',()=>{
 function Preview(){const drawer=useStore(s=>s.layoutDrawer);return <section data-testid="preview" data-layout-managed="" inert={!!drawer}><button>文档操作</button></section>;}
 render(<><Frame/><Preview/></>);expect(screen.getByTestId('preview')).toHaveAttribute('inert');fireEvent.keyDown(document,{key:'Escape'});expect(screen.getByTestId('preview')).not.toHaveAttribute('inert');
});
