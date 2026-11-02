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
const ready=()=>waitFor(()=>expect(screen.getByRole('button',{name:'保存模型分工'})).toBeEnabled());
beforeEach(()=>{
  vi.mocked(hanaFetch).mockReset().mockImplementation(async()=>new Response(JSON.stringify({connected:false,policy:null})));
  useStore.setState({currentSessionPath:'/current',pendingNewSession:false,pendingDraftId:null,pendingNewSessionModelPolicy:undefined,activeServerConnectionId:'local',models:[{provider:'test',id:'fast',name:'Fast',isCurrent:true},{provider:'test',id:'planner',name:'Planner'}] as any});
  useEngineering.setState({sessionPath:'/current',connectionId:'local',snapshot:{connected:false}});
});
afterEach(cleanup);
it('sets an ordinary current conversation without requiring an engineering connection or changing defaults',async()=>{
  const close=vi.fn();render(<ModelPolicyDialog close={close}/>);await ready();
  expect(screen.getByRole('button',{name:'应用范围'})).toHaveTextContent('仅当前对话');
  fireEvent.click(screen.getByRole('button',{name:'保存模型分工'}));await waitFor(()=>expect(close).toHaveBeenCalled());
  expect(writes().some(([url])=>url.includes('/model-policy?'))).toBe(true);
  expect(writes().some(([url])=>url.includes('/model-policy-default'))).toBe(false);
});
it('offers a per-draft scope and main/child roles without creating or sending a conversation',async()=>{
  useStore.setState({currentSessionPath:null,pendingNewSession:true,pendingDraftId:'new-one'});useEngineering.setState({sessionPath:'',snapshot:null});
  const close=vi.fn();render(<ModelPolicyDialog close={close}/>);await ready();
  expect(screen.getByRole('button',{name:'应用范围'})).toHaveTextContent('本次新对话');
  choose('执行方式','主 Agent + 子 Agent');choose('子 Agent模型','Planner');
  fireEvent.click(screen.getByRole('button',{name:'保存模型分工'}));await waitFor(()=>expect(close).toHaveBeenCalled());
  expect(writes()).toHaveLength(0);expect(useStore.getState().pendingNewSessionModelPolicy).toMatchObject({mode:'delegated',execution:{id:'fast'},worker:{id:'planner'}});
  expect(useStore.getState().currentSessionPath).toBeNull();
});
it('keeps edited role drafts separate between current and future scopes',async()=>{
  vi.mocked(hanaFetch).mockImplementation(async url=>new Response(JSON.stringify({policy:url.includes('default')?{mode:'plan-execute',execution:{provider:'test',id:'fast',thinking:'low'},planning:{provider:'test',id:'planner',thinking:'high'},review:{provider:'test',id:'fast',thinking:'off'},maxRequests:12}:null})));
  render(<ModelPolicyDialog close={vi.fn()}/>);await ready();choose('应用范围','以后新建的对话');await ready();
  expect(screen.getByRole('button',{name:'规划模型'})).toHaveTextContent('Planner');
  for(const role of ['规划','执行','复核']){
    const group=screen.getByRole('group',{name:role});expect(within(group).getByRole('button',{name:role+'模型'})).toBeInTheDocument();
    expect(within(group).getByRole('button',{name:role+'思考力度'})).toBeInTheDocument();
  }
  expect(screen.getByLabelText('模型请求上限（可选）')).toHaveValue(12);
  choose('执行模型','Planner');choose('应用范围','仅当前对话');expect(screen.getByRole('button',{name:'执行模型'})).toHaveTextContent('Fast');
  choose('应用范围','以后新建的对话');expect(screen.getByRole('button',{name:'执行模型'})).toHaveTextContent('Planner');
});
it('retains the dialog when Escape closes a dropdown and closes on the next Escape',async()=>{
  const close=vi.fn();render(<ModelPolicyDialog close={close}/>);await ready();fireEvent.click(screen.getByRole('button',{name:'执行方式'}));
  expect(screen.getByRole('listbox')).toHaveStyle({zIndex:10020});fireEvent.keyDown(document,{key:'Escape'});expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(document,{key:'Escape'});expect(close).toHaveBeenCalledTimes(1);
});
it('does not overwrite unknown settings after a failed read and supports retry',async()=>{
  vi.mocked(hanaFetch).mockResolvedValueOnce(new Response(JSON.stringify({error:'暂时无法读取'}),{status:503}));
  render(<ModelPolicyDialog close={vi.fn()}/>);await screen.findByText('暂时无法读取');expect(screen.getByRole('button',{name:'保存模型分工'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'重新读取'}));await ready();expect(writes()).toHaveLength(0);
});
it('omits unsupported thinking choices and submits off for that role',async()=>{
  useStore.setState({models:[{provider:'test',id:'fast',name:'Fast',reasoning:false,isCurrent:true}] as any});render(<ModelPolicyDialog close={vi.fn()}/>);await ready();
  expect(screen.queryByRole('button',{name:'执行思考力度'})).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'保存模型分工'}));
  await waitFor(()=>expect(writes().length).toBeGreaterThan(0));expect(JSON.parse(String(writes()[0][1]?.body)).policy.execution.thinking).toBe('off');
});
it('cannot apply an open form to a replacement conversation',async()=>{
  render(<ModelPolicyDialog close={vi.fn()}/>);await ready();act(()=>useStore.setState({currentSessionPath:'/different'}));
  expect(screen.getByRole('alert')).toHaveTextContent('对话或服务连接已切换');expect(screen.getByRole('button',{name:'保存模型分工'})).toBeDisabled();expect(writes()).toHaveLength(0);
});
