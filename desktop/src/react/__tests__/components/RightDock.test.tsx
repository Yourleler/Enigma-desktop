import {openDockFiles} from '../../utils/dock-file-drop';
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {useState} from 'react';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {useStore} from '../../stores';
import {useEngineering} from '../../engineering/state';
import {dockScope,dockView,hideDockTab,moveDockTab,normalizeDockView,orderedDockTabs,selectDockTab,useRightDock} from '../../stores/right-dock-store';
import {openPreview} from '../../stores/preview-actions';
import {RightDock} from '../../components/right-workspace/RightDock';
vi.mock('../../utils/dock-file-drop',()=>({openDockFiles:vi.fn(async()=>{})}));
vi.mock('../../components/app/OpenPreviewDocumentWatchBridge',()=>({OpenPreviewDocumentWatchBridge:()=>null}));
vi.mock('../../components/right-workspace/RightWorkspacePanel',()=>({RightWorkspacePanel:()=> <p>Directory content</p>}));
vi.mock('../../components/right-workspace/RepositoryChangesCard',()=>({RepositoryChangesPanel:()=> <p>Changes content</p>}));
vi.mock('../../engineering/Engineering',()=>({EngineeringPanel:()=> <p>Tools content</p>}));
vi.mock('../../components/PreviewPanel',()=>({PreviewPanel:({visible,itemId}:any)=><div hidden={!visible}>Preview {itemId}</div>}));
vi.mock('../../components/preview/SidebarBrowser',()=>({SidebarBrowser:()=>{const [value,setValue]=useState('');return <input aria-label="Page form" value={value} onChange={e=>setValue(e.target.value)}/>;}}));
vi.mock('../../components/right-workspace/SessionTodoCard',()=>({SessionTodoCard:()=>null}));
vi.mock('../../components/right-workspace/WorkflowCard',()=>({WorkflowCard:()=>null}));
vi.mock('../../components/right-workspace/AgentActivityCard',()=>({AgentActivityCard:()=>null}));
vi.mock('../../components/right-workspace/SessionStatusCard',()=>({SessionStatusCard:()=>null}));
beforeEach(()=>{vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});useStore.setState({currentSessionPath:'/session/a',activeServerConnectionId:'local',deskBasePath:'/workspace',jianOpen:true,previewOpen:false,previewItems:[],openTabs:[],activeTabId:null});useRightDock.setState({views:{}});useEngineering.setState({snapshot:null,active:'',paneOpen:false});});
afterEach(cleanup);
it('keeps browser form state when selecting another category and retains the last category for a conversation',()=>{
 render(<RightDock/>);fireEvent.click(screen.getByRole('tab',{name:'浏览器'}));fireEvent.change(screen.getByLabelText('Page form'),{target:{value:'keep page form'}});
 fireEvent.click(screen.getByRole('tab',{name:'任务'}));expect(screen.getByLabelText('Page form')).not.toBeVisible();fireEvent.click(screen.getByRole('tab',{name:'浏览器'}));expect(screen.getByLabelText('Page form')).toHaveValue('keep page form');
 const scope=dockScope(useStore.getState());expect(useRightDock.getState().views[scope].tab).toBe('browser');
});
it('opens documents as closable tabs in the same panel and switches categories without discarding the document',()=>{
 render(<RightDock/>);act(()=>openPreview({id:'readme',type:'markdown',title:'README.md',content:'# Hello'}));
 expect(screen.getByRole('tab',{name:'README.md'})).toHaveAttribute('aria-selected','true');expect(screen.getByText('Preview readme')).toBeVisible();
 fireEvent.click(screen.getByRole('tab',{name:'变更'}));expect(screen.getByText('Preview readme')).not.toBeVisible();expect(useStore.getState().openTabs).toContain('readme');
 fireEvent.click(screen.getByRole('tab',{name:'README.md'}));expect(screen.getByText('Preview readme')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'关闭文件 README.md'}));expect(screen.queryByRole('tab',{name:'README.md'})).not.toBeInTheDocument();expect(screen.getByRole('tab',{name:'文件'})).toHaveAttribute('aria-selected','true');
});
it('isolates active tabs across conversation and connection boundaries',()=>{
 const scope=dockScope(useStore.getState());selectDockTab(scope,'tasks');render(<RightDock/>);
 expect(screen.getByRole('tab',{name:'任务'})).toHaveAttribute('aria-selected','true');
 act(()=>useStore.setState({currentSessionPath:'/session/b'}));expect(screen.getByRole('tab',{name:'文件'})).toHaveAttribute('aria-selected','true');
 act(()=>useStore.setState({currentSessionPath:'/session/a'}));expect(screen.getByRole('tab',{name:'任务'})).toHaveAttribute('aria-selected','true');
});
it('restores an older open preview after delayed document hydration without overriding a user tab choice',()=>{
 render(<RightDock/>);
 act(()=>useStore.setState({previewOpen:true,openTabs:['saved'],activeTabId:'saved',previewItems:[{id:'saved',type:'markdown',title:'Saved.md',content:'# saved'}]}));
 expect(screen.getByRole('tab',{name:'Saved.md'})).toHaveAttribute('aria-selected','true');
 fireEvent.click(screen.getByRole('tab',{name:'任务'}));
 act(()=>useStore.setState({previewItems:[{id:'saved',type:'markdown',title:'Saved.md',content:'# updated'}]}));
 expect(screen.getByRole('tab',{name:'任务'})).toHaveAttribute('aria-selected','true');
});

it('keeps a file-list preview inside Files until the user pins it',()=>{
 render(<RightDock/>);act(()=>openPreview({id:'inline',type:'markdown',title:'Guide.md',content:'# guide'},{placement:'files'}));
 expect(screen.getByRole('tab',{name:'文件'})).toHaveAttribute('aria-selected','true');
 expect(screen.queryByRole('tab',{name:'Guide.md'})).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'固定为独立标签'})).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'固定为独立标签'}));
 expect(screen.getByRole('tab',{name:'Guide.md'})).toHaveAttribute('aria-selected','true');
});
it('closes and restores a base panel without clearing its browser state',()=>{
 render(<RightDock/>);fireEvent.click(screen.getByRole('tab',{name:'浏览器'}));fireEvent.change(screen.getByLabelText('Page form'),{target:{value:'retain'}});
 fireEvent.click(screen.getByRole('button',{name:'关闭面板 浏览器'}));expect(screen.queryByRole('tab',{name:'浏览器'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'添加面板'}));fireEvent.click(screen.getByRole('button',{name:/浏览器重新添加/}));
 expect(screen.getByLabelText('Page form')).toHaveValue('retain');
});
it('persists tab order and closed panels and does not reorder a tab dropped on itself',()=>{
 const scope=dockScope(useStore.getState()),ids=['files','changes','browser','tasks'] as const;
 moveDockTab(scope,'browser','files',[...ids]);expect(orderedDockTabs(dockView(scope),[...ids])).toEqual(['browser','files','changes','tasks']);
 moveDockTab(scope,'browser','browser',[...ids]);expect(orderedDockTabs(dockView(scope),[...ids])[0]).toBe('browser');
 hideDockTab(scope,'changes',[...ids]);const restored=normalizeDockView(JSON.parse(JSON.stringify(dockView(scope))));
 expect(orderedDockTabs(restored,[...ids])).toEqual(['browser','files','tasks']);
});

it('accepts an arriving file before the next drag movement and opens the drop once',async()=>{
 const {container}=render(<RightDock/>),dock=container.querySelector('[data-right-dock]')!;
 const file=new File(['# dropped'],'dropped.md',{type:'text/markdown'}),dataTransfer={types:['Files'],files:[file],getData:()=>'',dropEffect:'none'};
 expect(fireEvent.dragEnter(dock,{dataTransfer})).toBe(false);
 expect(screen.getByText('松开后固定为独立标签')).toBeInTheDocument();
 await act(async()=>{fireEvent.drop(dock,{dataTransfer});});
 expect(openDockFiles).toHaveBeenCalledWith([file],null);
});
