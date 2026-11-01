// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {useLayoutEffect} from 'react';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {EngineeringToolbar,EngineeringSidebar,EngineeringPanel} from '../Engineering';
import {useEngineering,submitAction,previewCheckpoint,refreshEngineering} from '../state';
import {useStore} from '../../stores';
import {hanaFetch} from '../../hooks/use-hana-fetch';
import {switchSession} from '../../stores/session-actions';
vi.mock('../../stores/session-actions',()=>({switchSession:vi.fn()}));
vi.mock('../../hooks/use-hana-fetch',()=>({hanaFetch:vi.fn()}));
vi.mock('../state',async load=>({...await load<typeof import('../state')>(),refreshEngineering:vi.fn(async()=>{})}));
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();useStore.setState({currentSessionPath:'/old',activeServerConnectionId:'one',pendingSessionSwitchPath:null,currentSessionId:'old',sessionPermissionMode:'ask'});useEngineering.setState({sessionPath:'/old',connectionId:'one',tabs:[],active:'',snapshot:{connected:true,root:'/workspace',actions:[],state:{idle:true}},paneOpen:false,sections:{},form:undefined,results:{},operationTabs:{},error:'',refreshError:''});});
afterEach(cleanup);
it('returns a managed worker to its recorded manager without changing the running task',()=>{
 const view=render(<EngineeringToolbar compact/>);
 act(()=>useEngineering.setState({snapshot:{connected:true,sessionPath:'/old',managerSessionPath:'/manager',state:{idle:false}}}));
 fireEvent.click(screen.getByRole('button',{name:'返回任务管家'}));
 expect(switchSession).toHaveBeenCalledExactlyOnceWith('/manager');
 expect(hanaFetch).not.toHaveBeenCalled();
 act(()=>useStore.setState({pendingSessionSwitchPath:'/new'}));
 expect(screen.queryByRole('button',{name:'返回任务管家'})).toBeNull();
 view.unmount();
});
it('does not expose the manager link from a stale or self-referencing snapshot',()=>{
 const view=render(<EngineeringToolbar compact/>);
 act(()=>useEngineering.setState({snapshot:{connected:true,sessionPath:'/other',managerSessionPath:'/manager'}}));
 expect(screen.queryByRole('button',{name:'返回任务管家'})).toBeNull();
 act(()=>useEngineering.setState({snapshot:{connected:true,sessionPath:'/old',managerSessionPath:'/old'}}));
 expect(screen.queryByRole('button',{name:'返回任务管家'})).toBeNull();view.unmount();
});
it('binds the engineering state to the new conversation before layout effects can expose stale controls',async()=>{
 const observed:string[]=[];
 function Probe(){const current=useStore(s=>s.currentSessionPath);useLayoutEffect(()=>{observed.push(`${current}:${useEngineering.getState().sessionPath}`);},[current]);return null;}
 render(<><EngineeringToolbar/><Probe/></>);
 await act(async()=>useStore.setState({currentSessionPath:'/new',currentSessionId:'new'}));
 expect(observed).toContain('/new:/new');expect(observed).not.toContain('/new:/old');
});
it('hides old actions during switching and rejects submission or direct preview before the new scope is ready',async()=>{
 const action={id:'restore-preview',group:'timeline',title:'preview',description:'',fields:[{name:'target',label:'target'},{name:'expected',label:'expected'}]};
 useStore.setState({pendingSessionSwitchPath:'/new'});useEngineering.setState({snapshot:{connected:true,actions:[action],state:{idle:true}},form:action,formSession:'/old'});
 render(<EngineeringSidebar/>);expect(screen.queryByRole('button',{name:'记忆'})).toBeNull();
 await expect(submitAction(action,{target:'old',expected:'latest'})).rejects.toThrow('会话已切换');await expect(previewCheckpoint('old','latest')).rejects.toThrow('对话已切换');expect(hanaFetch).not.toHaveBeenCalled();
});
it('does not repeat an unrelated operation failure on every engineering tab',()=>{
 useEngineering.setState({paneOpen:true,active:'group:materials',tabs:[{id:'group:materials',group:'materials',title:'资料'}],data:{items:[]},snapshot:{connected:true,actions:[],state:{idle:true,operation:{id:'failed-op',state:'failed',error:'old recipe failure'}}},operationTabs:{'failed-op':'group:skills'}});
 const {rerender}=render(<EngineeringPanel/>);expect(screen.queryByText('old recipe failure')).toBeNull();
 useEngineering.setState({active:'group:skills',tabs:[{id:'group:skills',group:'skills',title:'技能'}],data:{catalog:{skills:[]},recipes:[]},results:{'group:skills':{state:'failed',error:'old recipe failure'}}});rerender(<EngineeringPanel/>);
 expect(screen.getAllByText('old recipe failure').filter(element=>!element.closest('details:not([open])'))).toHaveLength(1);
});
