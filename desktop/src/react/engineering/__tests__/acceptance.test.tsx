// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {AcceptancePanel} from '../Acceptance';
import {engineeringRequest,openGroup,useEngineering} from '../state';
vi.mock('../state',async load=>({...await load<typeof import('../state')>(),engineeringRequest:vi.fn(),openGroup:vi.fn()}));
vi.mock('../compose-task',()=>({composeTaskRequest:vi.fn(),assistedOperations:[{prompt:'核对原要求'}]}));
import {composeTaskRequest} from '../compose-task';
const ready={requirements:[{id:'one',text:'保留接口兼容性',current:true,resolution:{assessment:'addressed',reason:'检查通过'},problems:[]}],assumptions:[],gaps:[],readyForReview:true};
beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();useEngineering.setState({sessionPath:'/task',connectionId:'one'});});afterEach(()=>{cleanup();vi.useRealTimers();});
it('updates stale original checks and routes actionable blockers without presenting stale success',async()=>{
 const stale={...ready,readyForReview:false,requirements:[{...ready.requirements[0],current:false,problems:['Evidence unavailable: old-proof']}],verificationIssue:'原验收记录不可用',gaps:['original-checks:not-currently-verified','operation:unknown','wait:external','plan:unfinished']};
 vi.mocked(engineeringRequest).mockResolvedValueOnce(ready).mockResolvedValue(stale);
 await act(async()=>{render(<AcceptancePanel initial={ready} evidence={()=>null}/>);});expect(screen.getByText(/可以进行最终复核/)).toBeVisible();
 await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});expect(screen.queryByText(/可以进行最终复核/)).toBeNull();expect(screen.getByText('原验收记录不可用')).toBeVisible();expect(screen.getByText(/验收证据暂不可用/)).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'查看项目检查'}));expect(openGroup).toHaveBeenCalledWith('project');fireEvent.click(screen.getByRole('button',{name:'核对运行记录'}));expect(openGroup).toHaveBeenCalledWith('timeline');
});
it('marks failed refresh as historical and labels explicit not-applicable assessments',async()=>{
 vi.mocked(engineeringRequest).mockRejectedValue(new Error('offline'));
 await act(async()=>{render(<AcceptancePanel initial={{...ready,requirements:[{...ready.requirements[0],resolution:{assessment:'not-applicable',reason:'用户已取消这个要求'}}]}} evidence={()=>null}/>);});
 expect(screen.getByRole('status')).toHaveTextContent('不能据此确认完成');expect(screen.queryByText(/可以进行最终复核/)).toBeNull();expect(screen.getByText('助手判断不适用，需核对理由')).toBeVisible();
});
it('keeps successful button actions out of the goal count while failures expose a review draft',async()=>{
 const value={requirements:[],assumptions:[],gaps:['requirements:no-task-goal','workbench:failed'],readyForReview:false,operationRequests:[{id:'ok',title:'查看代码',text:'app click',operation:'op-ok',state:'completed',current:true,assessment:'operation-receipt'},{id:'failed',title:'运行检查',text:'app check',operation:'op-failed',state:'failed',current:false,assessment:'requires-review',error:'check failed'}]};
 vi.mocked(engineeringRequest).mockResolvedValue(value);await act(async()=>{render(<AcceptancePanel initial={value} evidence={()=>null}/>);});
 expect(screen.getByText(/当前只有工作台操作记录/)).toBeVisible();expect(screen.getByText('0 / 0')).toBeVisible();expect(screen.getByText(/工作台操作 · 1 \/ 2/)).toBeVisible();expect(screen.getByText('已有执行回执')).not.toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'让助手核对这项操作'}));expect(composeTaskRequest).toHaveBeenCalledWith(expect.stringContaining('op-failed'));expect(composeTaskRequest).toHaveBeenCalledWith(expect.stringContaining('不要直接重放'));
});
