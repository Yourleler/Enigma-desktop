// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen}from'@testing-library/react';
import {afterEach,beforeEach,expect,it,vi}from'vitest';
import {ConductorCreateDialog}from'../ConductorCreate';
import {ConductorTasks}from'../ConductorTasks';
import {useEngineering,engineeringRequest,openEngineering}from'../state';
import {useStore}from'../../stores';
import {loadSessions,switchSession}from'../../stores/session-actions';
import {composeTaskRequest}from'../compose-task';
vi.mock('../state',async load=>({...await load<typeof import('../state')>(),engineeringRequest:vi.fn(),openEngineering:vi.fn()}));
vi.mock('../../stores/session-actions',()=>({loadSessions:vi.fn(),switchSession:vi.fn()}));
vi.mock('../compose-task',()=>({composeTaskRequest:vi.fn()}));
beforeEach(()=>{vi.clearAllMocks();useEngineering.setState({sessionPath:'/old',connectionId:'a',snapshot:{overview:{repositories:[]}}});useStore.setState({currentSessionPath:'/old',currentAgentId:'test',activeServerConnectionId:'a',models:[{id:'model',provider:'test',name:'Test',isCurrent:true}] as any});});
afterEach(cleanup);
it('refreshes the new manager identity before opening its composer',async()=>{
 vi.mocked(engineeringRequest).mockResolvedValue({sessionPath:'/created',sessionId:'manager-id'});const close=vi.fn();render(<ConductorCreateDialog close={close}/>);
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'创建管家对话'})));
 expect(loadSessions).toHaveBeenCalledOnce();expect(switchSession).toHaveBeenCalledWith('/created');
 expect(vi.mocked(loadSessions).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(switchSession).mock.invocationCallOrder[0]);
});
it('a delayed manager creation never navigates away from a new conversation',async()=>{
 let resolve!:(value:any)=>void;vi.mocked(engineeringRequest).mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const close=vi.fn();render(<ConductorCreateDialog close={close}/>);
 fireEvent.click(screen.getByRole('button',{name:'创建管家对话'}));act(()=>useStore.setState({currentSessionPath:'/new'}));
 await act(async()=>resolve({sessionPath:'/created'}));expect(switchSession).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent('会话或服务已切换');
});
it('creates from home without manufacturing or switching a source conversation',async()=>{
 useStore.setState({currentSessionPath:null});useEngineering.setState({sessionPath:'',snapshot:null});
 vi.mocked(engineeringRequest).mockResolvedValue({sessionPath:'/created',sessionId:'manager-id'});render(<ConductorCreateDialog close={vi.fn()}/>);
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'创建管家对话'})));
 expect(engineeringRequest).toHaveBeenCalledWith('/conductor/new','',expect.objectContaining({agentId:'test',limits:expect.objectContaining({writableRepos:[]})}));
 expect(switchSession).toHaveBeenCalledWith('/created');
});
it('a late generated report cannot open an artifact from another connection',async()=>{
 let resolve!:(value:any)=>void;vi.mocked(engineeringRequest).mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 render(<ConductorTasks value={{projects:[],conflicts:[],events:[],active:0,tasks:[{id:'task',title:'Task',goal:'Goal',status:'completed',writeRepos:[]}]}}/>);
 fireEvent.click(screen.getByRole('button',{name:'汇总为工作报告'}));act(()=>useEngineering.setState({connectionId:'b'}));await act(async()=>resolve({id:'old-report',title:'Report'}));expect(openEngineering).not.toHaveBeenCalled();
});
it('provides direct stop for running workers and clearly drafts review or recovery for settled workers',async()=>{
 vi.mocked(engineeringRequest).mockResolvedValue({status:'cancelled'});
 render(<ConductorTasks value={{projects:[],conflicts:[],events:[],active:1,tasks:[{id:'running',title:'Run',goal:'Goal',status:'running',writeRepos:[]},{id:'done',title:'Done',goal:'Goal',status:'completed',writeRepos:[]},{id:'failed',title:'Fail',goal:'Goal',status:'failed',writeRepos:[]}]}}/>);
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'停止此任务'})));expect(engineeringRequest).toHaveBeenCalledWith('/conductor/cancel','/old',{id:'running'});
 fireEvent.click(screen.getByRole('button',{name:'让管家预览成果'}));expect(composeTaskRequest).toHaveBeenCalledWith(expect.stringContaining('done'));
 fireEvent.click(screen.getByRole('button',{name:'让管家核对接续'}));expect(composeTaskRequest).toHaveBeenCalledWith(expect.stringContaining('failed'));
});
it('shows retained requests and expires an old verified badge when the live task report changes',async()=>{
 vi.useFakeTimers();
 try{
  useEngineering.setState({snapshot:{kind:'manager'}});
  const initial={projects:[],conflicts:[],events:[],active:0,tasks:[{id:'one',title:'Recovered',goal:'Keep source',status:'blocked',writeRepos:[],progress:{requests:2,verification:'verified'}}]};
  vi.mocked(engineeringRequest).mockResolvedValueOnce(initial).mockResolvedValue({...initial,tasks:[{...initial.tasks[0],progress:{requests:5,verification:'stale'}}]});
  await act(async()=>{render(<ConductorTasks value={initial}/>);});
  expect(screen.getByText('原检查已通过')).toBeVisible();expect(screen.getByText(/累计模型请求 2 次/)).toBeVisible();
  await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
  expect(screen.getByText('原检查需要重新验证')).toBeVisible();expect(screen.queryByText('原检查已通过')).toBeNull();expect(screen.getByText(/累计模型请求 5 次/)).toBeVisible();
 }finally{cleanup();vi.useRealTimers();}
});
