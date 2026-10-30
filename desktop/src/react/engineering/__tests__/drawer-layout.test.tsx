// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {WorkspaceCompanionRail} from '../../components/app/WorkspaceCompanionRail';
import {useStore} from '../../stores';
import {useEngineering} from '../state';
import {updateLayout} from '../../components/SidebarLayout';
import {ActionDialog} from '../Engineering';
vi.mock('../../components/app/WorkspaceFileChangeBridge',()=>({WorkspaceFileChangeBridge:()=>null}));
vi.mock('../../components/right-workspace/RightWorkspacePanel',()=>({RightWorkspacePanel:()=> <div><button className="enigma-close-pane">收起</button><button>查看内容</button></div>}));
beforeEach(()=>{
  vi.stubGlobal('innerWidth',420);vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
  useStore.setState({jianOpen:true,sidebarOpen:false});useEngineering.setState({snapshot:{connected:true},paneOpen:true,active:'group:reading'});
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();useEngineering.setState({snapshot:null,paneOpen:false,active:''});});
it('drawer cleanup does not restore stale inert state on a newly opened managed preview',()=>{
  useStore.setState({previewOpen:false,layoutDrawer:'workspace'});
  function ManagedPreview(){
    const open=useStore(s=>s.previewOpen),drawer=useStore(s=>s.layoutDrawer);
    return <section id="previewPanel" data-layout-managed="" inert={!open||!!drawer}><button>文档操作</button></section>;
  }
  const {container}=render(<><ManagedPreview/><WorkspaceCompanionRail/></>);
  expect(container.querySelector('#previewPanel')).toHaveAttribute('inert');
  act(()=>{useEngineering.setState({paneOpen:false});useStore.setState({previewOpen:true,jianOpen:false,layoutDrawer:null});});
  expect(container.querySelector('#previewPanel')).not.toHaveAttribute('inert');
  expect(screen.getByRole('button',{name:'文档操作'})).toBeInTheDocument();
  useStore.setState({previewOpen:false});
});
it('removes collapsed right-panel controls from keyboard and accessibility navigation',()=>{
  useStore.setState({jianOpen:false});
  const {container}=render(<WorkspaceCompanionRail/>);
  expect(container.querySelector('#jianSidebar')).toHaveAttribute('inert');
  expect(screen.queryByRole('button',{name:'查看内容'})).not.toBeInTheDocument();
  act(()=>useStore.setState({jianOpen:true}));
  expect(container.querySelector('#jianSidebar')).not.toHaveAttribute('inert');
  expect(screen.getByRole('button',{name:'查看内容'})).toBeInTheDocument();
});
it('narrow engineering drawer dims and disables background, Escape closes it and restores background interaction',()=>{
  const {container}=render(<><main className="main-content"><button>聊天操作</button></main><WorkspaceCompanionRail/></>);
  expect(screen.getByRole('dialog',{name:'工程内容面板'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'关闭内容面板遮罩'})).toBeInTheDocument();
  expect((container.querySelector('main') as HTMLElement).inert).toBe(true);
  fireEvent.keyDown(document,{key:'Escape'});expect(useEngineering.getState().paneOpen).toBe(false);expect(useStore.getState().jianOpen).toBe(false);expect((container.querySelector('main') as HTMLElement).inert).toBeFalsy();
});
it('clicking the scrim closes the drawer, without losing its content tab',()=>{
  render(<WorkspaceCompanionRail/>);fireEvent.click(screen.getByRole('button',{name:'关闭内容面板遮罩'}));expect(useEngineering.getState().active).toBe('group:reading');expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  act(()=>{useEngineering.setState({paneOpen:true});useStore.setState({jianOpen:true});});expect(screen.getByRole('dialog')).toBeInTheDocument();
});
it('medium windows keep the requested content panel and reclaim the conversation list first',()=>{
  vi.stubGlobal('innerWidth',1024);useStore.setState({sidebarOpen:true,jianOpen:true,previewOpen:false,currentTab:'chat',sidebarAutoCollapsed:false,jianAutoCollapsed:false});
  const {container}=render(<div className="jian-sidebar-inner"/>);
  vi.spyOn(container.firstElementChild!,'getBoundingClientRect').mockReturnValue({width:368} as DOMRect);
  act(()=>updateLayout());expect(useStore.getState().sidebarOpen).toBe(false);expect(useStore.getState().jianOpen).toBe(true);
  act(()=>updateLayout());expect(useStore.getState().sidebarOpen).toBe(false);expect(useStore.getState().jianOpen).toBe(true);
});
it('does not take focus from an operation dialog opened together with the narrow drawer',()=>{
  render(<><div className="enigma-modal-backdrop"><section role="dialog" aria-label="操作确认"><button autoFocus>确认操作</button></section></div><WorkspaceCompanionRail/></>);
  expect(screen.getByRole('button',{name:'确认操作'})).toHaveFocus();
  fireEvent.keyDown(document,{key:'Escape'});expect(useEngineering.getState().paneOpen).toBe(true);
});
it('Escape dismisses the operation form and keeps its underlying drawer open',()=>{
  useEngineering.setState({sessionPath:'/test',formSession:'/test',form:{id:'sample',title:'操作表单',description:'test',group:'reading',fields:[]},formLoading:false,formError:''});
  render(<><ActionDialog/><WorkspaceCompanionRail/></>);
  fireEvent.keyDown(screen.getByRole('button',{name:'关闭 操作表单'}),{key:'Escape'});
  expect(useEngineering.getState().form).toBeUndefined();expect(useEngineering.getState().paneOpen).toBe(true);expect(screen.getByRole('dialog',{name:'工程内容面板'})).toBeInTheDocument();
});
