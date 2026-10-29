// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {HandoffResult} from '../HandoffResult';
import {readRecordAction,useEngineering} from '../state';
import {presentAction} from '../interaction-copy';
vi.mock('../state',async load=>({...await load<typeof import('../state')>(),readRecordAction:vi.fn()}));
const manifest={goal:'继续API改造',mode:'continue',createdAt:'2026-10-27T00:00:00Z',notes:[],repos:[{id:'api'}],evidence:[],memories:[]};
beforeEach(()=>{vi.clearAllMocks();useEngineering.setState({sessionPath:'/task',connectionId:'local'});});afterEach(cleanup);
it('shows inspection conflicts before any technical record, and rechecks the selected handoff directly',async()=>{
 render(<HandoffResult value={{manifest,path:'/handoff',document:'# Original',safeToContinue:false,code:[{repo:'api',state:'changed'}],evidence:[],memories:[],warnings:['Code context changed or is unavailable; no historical acceptance is activated.']}} details={<p>RAW</p>}/>);
 expect(screen.getByText('交接需要重新核对当前状态')).toBeVisible();expect(screen.getByText(/代码已变化，请重新阅读和验证/)).toBeVisible();expect(screen.queryByText('RAW')).not.toBeInTheDocument();
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'重新核对这份交接'}));});expect(readRecordAction).toHaveBeenCalledWith('handoff-inspect',{directory:'/handoff'});
});
it('copies exact exported text and makes omitted base context explicit',async()=>{
 const copy=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:copy}});
 render(<HandoffResult value={{manifest,directory:'/delta',document:'# Exact handoff\n',delta:{omittedUnchangedBackground:2}}} details={null}/>);
 expect(screen.getByText(/接收方若没看过上一份交接/)).toBeVisible();await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'复制交接正文'}));});expect(copy).toHaveBeenCalledWith('# Exact handoff\n');expect(screen.getByText('已复制交接正文')).toBeVisible();
});
it('explains background handoff as a new goal instead of a background process',()=>{
 const action=presentAction({id:'handoff-export',title:'Export',description:'',group:'handoff',fields:[{name:'mode',label:'模式',options:['background','continue','alternative']}]});expect(action.fields[0].items?.[0]).toEqual({value:'background',label:'沿用背景，开始新目标'});
});
