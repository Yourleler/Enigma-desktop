// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ReviewPanel} from '../Review';
import {engineeringRequest,openEngineering,useEngineering} from '../state';
import {useStore} from '../../stores';
vi.mock('../state',async load=>({...await load<typeof import('../state')>(),engineeringRequest:vi.fn(),openEngineering:vi.fn()}));
const report={id:'review-a',goal:'保留兼容性',status:'completed',recordedStatus:'completed',sourceCurrent:true,environmentCurrent:true,scope:'current-task',text:'## 具体问题\n消费者仍依赖旧字段。',createdAt:'2026-10-27T00:00:00Z',model:'reviewer',requests:2,evidence:[],changes:[{repo:'api',file:'index.ts',change:'modified',patch:'-old\n+new'},{repo:'api',file:'removed.txt',change:'deleted'}],coverage:{files:2,inlineDiffFiles:2,additionalFiles:0}};
beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();useStore.setState({sessionPermissionMode:'ask'});useEngineering.setState({sessionPath:'/task',connectionId:'a',snapshot:{state:{idle:true},actions:[{id:'review-run'}]}});});afterEach(()=>{cleanup();vi.useRealTimers();});
it('shows report prose and revalidates its applicability on refresh without changing historical outcome',async()=>{
 vi.mocked(engineeringRequest).mockResolvedValueOnce({items:[report]}).mockResolvedValue({items:[{...report,status:'stale',sourceCurrent:false}]});
 await act(async()=>{render(<ReviewPanel initial={{items:[report]}} evidence={()=>null}/>);});expect(screen.getByRole('heading',{name:'具体问题'})).toBeVisible();expect(screen.getByText('源码与报告版本一致。')).toBeVisible();
 await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});expect(screen.getByText('源码已变化，请重新审查当前改动。')).toBeVisible();expect(screen.getByText(/原审查已过期/)).toBeVisible();expect(screen.getByText('消费者仍依赖旧字段。')).toBeVisible();
});
it('distinguishes frozen and current source and uses the baseline for deleted files',async()=>{
 vi.mocked(engineeringRequest).mockImplementation(async route=>route==='/data/review'?{items:[report]}:{content:'frozen original',line:1,endLine:1,totalLines:1});
 await act(async()=>{render(<ReviewPanel initial={{items:[report]}} evidence={()=>null}/>);});
 fireEvent.click(screen.getByText(/核对本次冻结的差异/));fireEvent.click(screen.getByText('api / removed.txt · 删除'));
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'查看删除前源码'}));});expect(screen.getByText('frozen original')).toBeVisible();
 expect(vi.mocked(engineeringRequest).mock.calls.some(([route])=>route.includes('side=baseline')&&route.includes('review=review-a'))).toBe(true);
  fireEvent.change(screen.getByRole('spinbutton',{name:'冻结源码起始行'}),{target:{value:'2'}});fireEvent.change(screen.getByRole('spinbutton',{name:'冻结源码读取行数'}),{target:{value:'1'}});
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'查看行范围'}));});expect(vi.mocked(engineeringRequest).mock.calls.some(([route])=>route.includes('start=2&end=2'))).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'关闭冻结源码'}));fireEvent.click(screen.getByText('api / index.ts · 修改'));fireEvent.click(screen.getByRole('button',{name:'查看当前文件'}));
 expect(openEngineering).toHaveBeenCalledWith(expect.objectContaining({repo:'api',file:'index.ts'}));
});
it('does not present stale query results as current and labels workspace history and partial coverage',async()=>{
 vi.mocked(engineeringRequest).mockRejectedValue(new Error('offline'));useStore.setState({sessionPermissionMode:'read_only'});
 await act(async()=>{render(<ReviewPanel initial={{items:[{...report,scope:'legacy-workspace',coverage:{files:90,inlineDiffFiles:80,additionalFiles:10}}]}} evidence={()=>null}/>);});
 expect(screen.getByRole('status')).toHaveTextContent('报告状态未更新');expect(screen.queryByText('源码与报告版本一致。')).toBeNull();expect(screen.getByText(/不能据此声称全部已审查/)).toBeVisible();expect(screen.getByRole('button',{name:'发起独立审查'})).toBeDisabled();
});
