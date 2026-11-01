// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {GuardianPanel} from '../Guardian';
import {engineeringRequest,useEngineering} from '../state';
vi.mock('../state',async load=>({...await load<typeof import('../state')>(),engineeringRequest:vi.fn()}));
beforeEach(()=>{useEngineering.setState({sessionPath:'/a',connectionId:'one'});vi.mocked(engineeringRequest).mockReset().mockImplementation(async()=>({phase:'watching',pid:123,events:[]}));});
afterEach(cleanup);
it('keeps stopping observation available while a separate diagnostic answer is pending',async()=>{
  let resolve!:(answer:any)=>void;vi.mocked(engineeringRequest).mockImplementation(async route=>route==='/guardian/diagnose'?await new Promise(r=>{resolve=r;}):{phase:'watching',pid:123,events:[]});
  render(<GuardianPanel/>);await screen.findByRole('button',{name:'停止独立观察'});
  fireEvent.change(screen.getByLabelText('想了解当前任务的什么情况？'),{target:{value:'在等什么'}});fireEvent.click(screen.getByRole('button',{name:'询问运行状态'}));
  expect(screen.getByRole('button',{name:'停止独立观察'})).toBeEnabled();
  fireEvent.click(screen.getByRole('button',{name:'停止独立观察'}));await waitFor(()=>expect(engineeringRequest).toHaveBeenCalledWith('/guardian/stop','/a',{}));
  await act(async()=>resolve({answer:'当前在等待工具返回',usedModel:false}));
  expect(screen.getByText(/诊断模型暂不可用/)).toBeVisible();expect(screen.getByText('问题：在等什么')).toBeVisible();
});
it('does not show another conversation diagnostic answer after navigation',async()=>{
  let resolve!:(answer:any)=>void;vi.mocked(engineeringRequest).mockImplementation(async route=>route==='/guardian/diagnose'?await new Promise(r=>{resolve=r;}):null);
  render(<GuardianPanel/>);fireEvent.change(screen.getByLabelText('想了解当前任务的什么情况？'),{target:{value:'原任务为什么慢'}});fireEvent.click(screen.getByRole('button',{name:'询问运行状态'}));
  act(()=>useEngineering.setState({sessionPath:'/b'}));await act(async()=>resolve({answer:'只属于原任务的回答',usedModel:true}));
  expect(screen.queryByText('只属于原任务的回答')).not.toBeInTheDocument();expect(screen.getByLabelText('想了解当前任务的什么情况？')).toHaveValue('');
});
it('allows a pending start approval to be cancelled through the separate stop request',async()=>{
  let reject!:(error:Error)=>void;vi.mocked(engineeringRequest).mockImplementation(async route=>route==='/guardian/start'?await new Promise((_resolve,r)=>{reject=r;}):null);
  render(<GuardianPanel/>);await waitFor(()=>expect(screen.getByRole('button',{name:'启动独立观察'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'启动独立观察'}));
  fireEvent.click(await screen.findByRole('button',{name:'取消启动观察'}));await waitFor(()=>expect(engineeringRequest).toHaveBeenCalledWith('/guardian/stop','/a',{}));
  await act(async()=>reject(new Error('启动已取消')));expect(screen.getByRole('alert')).toHaveTextContent('启动已取消');
});
it('shows a confirmed stop and retained events rather than an exited-process warning',async()=>{
 vi.mocked(engineeringRequest).mockResolvedValue({phase:'stopped',pid:123,processState:'gone',events:[{text:'Recorded observation'}]});
 render(<GuardianPanel/>);await screen.findByText('已停止观察');expect(screen.queryByText('观察进程已退出')).toBeNull();
 expect(screen.getByRole('button',{name:'启动独立观察'})).toBeEnabled();fireEvent.click(screen.getByText('观察与接管记录'));expect(screen.getByText('Recorded observation')).toBeVisible();
});
