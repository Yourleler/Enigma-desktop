// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ModelPolicyDialog} from '../ModelPolicy';
import {useStore} from '../../stores';
import {useEngineering} from '../state';
import {hanaFetch} from '../../hooks/use-hana-fetch';
vi.mock('../../hooks/use-hana-fetch',()=>({hanaFetch:vi.fn()}));
const choose=(label:string,option:string)=>{fireEvent.click(screen.getByRole('button',{name:label}));fireEvent.click(screen.getByRole('option',{name:option}));};
const writes=()=>vi.mocked(hanaFetch).mock.calls.filter(([,options])=>options?.method==='POST');
beforeEach(()=>{
  vi.mocked(hanaFetch).mockReset().mockImplementation(async()=>new Response(JSON.stringify({connected:true,policy:null})));
  useStore.setState({models:[{provider:'test',id:'fast',name:'Fast',isCurrent:true},{provider:'test',id:'planner',name:'Planner'}] as any});
  useEngineering.setState({sessionPath:'/current',connectionId:'local',snapshot:{connected:true}});
});
afterEach(cleanup);
it('defaults to the current conversation and does not overwrite future-task settings',async()=>{
  const close=vi.fn();render(<ModelPolicyDialog close={close}/>);
  expect(screen.getByRole('button',{name:'应用范围'})).toHaveTextContent('仅当前会话');
  fireEvent.click(screen.getByRole('button',{name:'保存模型分工'}));await waitFor(()=>expect(close).toHaveBeenCalled());
  expect(writes().some(([url])=>url.includes('/model-policy?'))).toBe(true);
  expect(writes().some(([url])=>url.includes('/model-policy-default'))).toBe(false);
});
it('uses a fixed scope explanation instead of a one-option dropdown before an engineering conversation exists',async()=>{
  useEngineering.setState({sessionPath:'',snapshot:null});const close=vi.fn();render(<ModelPolicyDialog close={close}/>);
  expect(screen.queryByRole('button',{name:'应用范围'})).not.toBeInTheDocument();
  expect(screen.getByText(/目前没有已连接工程工作区的对话/)).toBeInTheDocument();
  await waitFor(()=>expect(screen.getByRole('button',{name:'保存模型分工'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'保存模型分工'}));await waitFor(()=>expect(close).toHaveBeenCalled());
  expect(writes().map(([url])=>url)).toEqual(['/api/enigma/model-policy-default']);
});
it('loads saved future defaults, pairs each role with its thinking control and preserves drafts between scopes',async()=>{
  vi.mocked(hanaFetch).mockImplementation(async()=>new Response(JSON.stringify({policy:{mode:'plan-execute',execution:{provider:'test',id:'fast',thinking:'low'},planning:{provider:'test',id:'planner',thinking:'high'},review:{provider:'test',id:'fast',thinking:'off'},maxRequests:12}})));
  render(<ModelPolicyDialog close={vi.fn()}/>);choose('应用范围','以后新建的工程任务');
  await waitFor(()=>expect(screen.getByRole('button',{name:'规划模型'})).toHaveTextContent('Planner'));
  for(const role of ['规划','执行','复核']){
    const group=screen.getByRole('group',{name:role});
    expect(within(group).getByRole('button',{name:role+'模型'})).toBeInTheDocument();
    expect(within(group).getByRole('button',{name:role+'思考力度'})).toBeInTheDocument();
  }
  expect(screen.getByLabelText('模型请求上限（可选）')).toHaveValue(12);
  choose('执行模型','Planner');choose('应用范围','仅当前会话');expect(screen.getByRole('button',{name:'执行模型'})).toHaveTextContent('Fast');
  choose('应用范围','以后新建的工程任务');expect(screen.getByRole('button',{name:'执行模型'})).toHaveTextContent('Planner');
  expect(hanaFetch).toHaveBeenCalledTimes(1);
});
it('retains the dialog when Escape closes a dropdown, then closes the dialog on a second Escape',()=>{
  const close=vi.fn();render(<ModelPolicyDialog close={close}/>);fireEvent.click(screen.getByRole('button',{name:'执行方式'}));
  expect(screen.getByRole('listbox')).toHaveStyle({zIndex:10020});
  fireEvent.keyDown(document,{key:'Escape'});expect(close).not.toHaveBeenCalled();expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  fireEvent.keyDown(document,{key:'Escape'});expect(close).toHaveBeenCalledTimes(1);
});
it('keeps save disabled when future defaults cannot be read, and supports retry',async()=>{
  useEngineering.setState({snapshot:null,sessionPath:''});vi.mocked(hanaFetch).mockResolvedValueOnce(new Response(JSON.stringify({error:'暂时无法读取'}),{status:503}));
  render(<ModelPolicyDialog close={vi.fn()}/>);await screen.findByText('暂时无法读取');expect(screen.getByRole('button',{name:'保存模型分工'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'重新读取'}));await waitFor(()=>expect(screen.getByRole('button',{name:'保存模型分工'})).toBeEnabled());expect(writes()).toHaveLength(0);
});
it('does not expose irrelevant thinking choices for a model without controllable thinking',()=>{
  useStore.setState({models:[{provider:'test',id:'fast',name:'Fast',reasoning:false,isCurrent:true}] as any});
  render(<ModelPolicyDialog close={vi.fn()}/>);expect(screen.queryByRole('button',{name:'执行思考力度'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'保存模型分工'}));
  expect(JSON.parse(String(writes()[0][1]?.body)).policy.execution.thinking).toBe('off');
});
it('does not apply an open form to a different conversation or server',()=>{
  render(<ModelPolicyDialog close={vi.fn()}/>);act(()=>useEngineering.setState({sessionPath:'/different'}));
  expect(screen.getByRole('alert')).toHaveTextContent('会话或服务连接已切换');expect(screen.getByRole('button',{name:'保存模型分工'})).toBeDisabled();expect(writes()).toHaveLength(0);
});
