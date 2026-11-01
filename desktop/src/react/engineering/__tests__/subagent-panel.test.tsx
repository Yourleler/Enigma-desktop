// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {SubagentPanel} from '../../components/right-workspace/SubagentPanel';
import {useStore} from '../../stores';
import {hanaFetch} from '../../hooks/use-hana-fetch';
vi.mock('../../hooks/use-hana-fetch',()=>({hanaFetch:vi.fn()}));
vi.mock('../../components/chat/SubagentSessionPreview',()=>({SubagentSessionPreview:({taskId}:any)=><p>任务记录 {taskId}</p>}));
const activity=(id:string)=>({id,kind:'subagent' as const,status:'done' as const,sessionPath:'/parent',agentId:'worker',agentName:'Worker',summary:'Checked',childSessionPath:'/child/'+id,startedAt:1,finishedAt:2});
beforeEach(()=>{vi.clearAllMocks();useStore.setState({currentSessionPath:'/parent',activeServerConnectionId:'local',agentActivitiesBySession:{'/parent':[activity('first'),activity('second')]},pendingMessageLocate:null});});afterEach(cleanup);
it('selects a child and locates its actual canonical parent message index',async()=>{
 vi.mocked(hanaFetch).mockResolvedValue(new Response(JSON.stringify({messages:[{id:'17',role:'assistant',content:'Created task'},{id:'42',role:'assistant',content:'Another task'}],blocks:[{type:'subagent',taskId:'first',afterIndex:0},{type:'subagent',taskId:'second',afterIndex:1}]})));
 render(<SubagentPanel/>);fireEvent.change(screen.getByLabelText('选择子任务'),{target:{value:'second'}});expect(screen.getByText('任务记录 second')).toBeVisible();fireEvent.click(screen.getByText('在父对话中定位'));
 await waitFor(()=>expect(useStore.getState().pendingMessageLocate).toMatchObject({sessionPath:'/parent',messageIndex:42}));
});
it('discards a parent lookup after switching conversations',async()=>{
 let resolve!:(r:Response)=>void;vi.mocked(hanaFetch).mockImplementation(()=>new Promise(r=>{resolve=r;}));render(<SubagentPanel/>);fireEvent.click(screen.getByText('在父对话中定位'));act(()=>useStore.setState({currentSessionPath:'/another'}));
 await act(async()=>resolve(new Response(JSON.stringify({messages:[{id:'17',role:'assistant',content:'Task'}],blocks:[{type:'subagent',taskId:'first',afterIndex:0}]}))));expect(useStore.getState().pendingMessageLocate).toBeNull();
});
const parentHistory=(taskId:string,id='17')=>new Response(JSON.stringify({messages:[{id,role:'assistant',content:'Created task'}],blocks:[{type:'subagent',taskId,afterIndex:0}]}));
it('cancels the old lookup when selecting another child and does not clear its new pending state',async()=>{
 const pending:Array<(r:Response)=>void>=[];vi.mocked(hanaFetch).mockImplementation(()=>new Promise(resolve=>pending.push(resolve)));
 render(<SubagentPanel/>);fireEvent.click(screen.getByText('在父对话中定位'));
 const firstSignal=vi.mocked(hanaFetch).mock.calls[0][1]?.signal;
 fireEvent.change(screen.getByLabelText('选择子任务'),{target:{value:'second'}});
 expect(firstSignal?.aborted).toBe(true);
 fireEvent.click(screen.getByText('在父对话中定位'));
 await act(async()=>pending[0](parentHistory('first')));
 expect(useStore.getState().pendingMessageLocate).toBeNull();expect(screen.getByText('定位中…')).toBeDisabled();
 await act(async()=>pending[1](parentHistory('second','42')));
 expect(useStore.getState().pendingMessageLocate).toMatchObject({messageIndex:42});
});
it('does not apply a lookup from an earlier visit after leaving and returning to the same parent',async()=>{
 let resolve!:(r:Response)=>void;vi.mocked(hanaFetch).mockImplementation(()=>new Promise(r=>{resolve=r}));
 render(<SubagentPanel/>);fireEvent.click(screen.getByText('在父对话中定位'));
 act(()=>useStore.setState({currentSessionPath:'/another'}));act(()=>useStore.setState({currentSessionPath:'/parent'}));
 await act(async()=>resolve(parentHistory('first')));expect(useStore.getState().pendingMessageLocate).toBeNull();
});
it('discards lookup errors after the child selection changes',async()=>{
 let reject!:(e:Error)=>void;vi.mocked(hanaFetch).mockImplementation(()=>new Promise((_r,r)=>{reject=r}));
 render(<SubagentPanel/>);fireEvent.click(screen.getByText('在父对话中定位'));fireEvent.change(screen.getByLabelText('选择子任务'),{target:{value:'second'}});
 await act(async()=>reject(Error('old request failed')));expect(screen.queryByText('old request failed')).toBeNull();
});
it('discards a lookup from a prior server connection even when returning to it',async()=>{
 let resolve!:(r:Response)=>void;vi.mocked(hanaFetch).mockImplementation(()=>new Promise(r=>{resolve=r}));
 render(<SubagentPanel/>);fireEvent.click(screen.getByText('在父对话中定位'));
 act(()=>useStore.setState({activeServerConnectionId:'another'}));act(()=>useStore.setState({activeServerConnectionId:'local'}));
 await act(async()=>resolve(parentHistory('first')));expect(useStore.getState().pendingMessageLocate).toBeNull();
});
it('releases a pending lookup when the panel unmounts',async()=>{
 let resolve!:(r:Response)=>void;vi.mocked(hanaFetch).mockImplementation(()=>new Promise(r=>{resolve=r}));
 const view=render(<SubagentPanel/>);fireEvent.click(screen.getByText('在父对话中定位'));const signal=vi.mocked(hanaFetch).mock.calls[0][1]?.signal;
 view.unmount();expect(signal?.aborted).toBe(true);await act(async()=>resolve(parentHistory('first')));expect(useStore.getState().pendingMessageLocate).toBeNull();
});
it('explains the empty state without a nonfunctional task selector',()=>{useStore.setState({agentActivitiesBySession:{}});render(<SubagentPanel/>);expect(screen.getByText('本对话还没有协作助手任务。')).toBeVisible();expect(screen.queryByText('在父对话中定位')).toBeNull();});
