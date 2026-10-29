// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimeMachine, RestorePreview } from '../TimeMachine';
import {OperationResult} from '../OperationResult';
import { checkpointChoice, checkpointLabel, presentAction } from '../interaction-copy';
import { useEngineering, showAction,showRecordAction, previewCheckpoint } from '../state';
import { composeTaskRequest } from '../compose-task';
import { useStore } from '../../stores';
vi.mock('../state', async importOriginal => ({ ...await importOriginal<typeof import('../state')>(), showAction: vi.fn(),showRecordAction:vi.fn(), previewCheckpoint: vi.fn() }));
vi.mock('../compose-task', async importOriginal => ({ ...await importOriginal<typeof import('../compose-task')>(), composeTaskRequest: vi.fn() }));
const actions = [
  {id:'checkpoint',fields:[{name:'label',label:'标签'}]},
  {id:'restore-preview',fields:[{name:'target',label:'目标'},{name:'expected',label:'基准'}]},
  {id:'restore',fields:[{name:'target',label:'目标'},{name:'expected',label:'基准'},{name:'context',label:'上下文',kind:'boolean'}]},
  {id:'code-fork',fields:[{name:'checkpoint',label:'快照'},{name:'destination',label:'目录'}]},
].map(a=>({...a,title:a.id,description:'',group:'timeline'}));
const points = [
  {id:'old-point',label:'session baseline',createdAt:'2026-10-26T01:00:00Z',session:'current',repos:[{repo:{id:'api'}}]},
  {id:'latest-point',label:'turn settled',createdAt:'2026-10-26T02:00:00Z',session:'current',repos:[{repo:{id:'api'}}]},
];
beforeEach(()=>{vi.clearAllMocks();vi.mocked(previewCheckpoint).mockResolvedValue(undefined);useStore.setState({currentSessionId:'current',sessionPermissionMode:'ask'});useEngineering.setState({sessionPath:'/current',connectionId:'a',snapshot:{state:{idle:true},actions},data:{checkpoints:points}});});
afterEach(cleanup);
describe('Time machine guidance',()=>{
  it('shows separate completed outcomes for saved snapshots, restored code and independent workspaces',()=>{
    const {rerender}=render(<OperationResult value={{schema:1,id:'point',label:'原始代码',repos:[],createdAt:'2026-10-27T00:00:00Z'}} details={null}/>);
    expect(screen.getByRole('status')).toHaveTextContent('代码快照已保存');
    rerender(<OperationResult value={{codeRestored:true,targetLabel:'原始代码',contextSwitched:false}} details={null}/>);
    expect(screen.getByRole('status')).toHaveTextContent('代码已恢复');expect(screen.getByRole('status')).toHaveTextContent('对话位置保持不变');
    rerender(<OperationResult value={{codeForked:true,targetLabel:'原始代码',destination:'/isolated/alternative'}} details={null}/>);
    expect(screen.getByRole('status')).toHaveTextContent('独立代码方案已创建');expect(screen.getByRole('status')).toHaveTextContent('/isolated/alternative');
    rerender(<OperationResult value={{codeForked:true,targetLabel:'原始代码',destination:'/isolated/alternative',createdSession:{sessionPath:'/new-session'}}} details={null}/>);
    expect(screen.getByRole('button',{name:'打开方案对话'})).toBeVisible();
  });
  it('brings interrupted work forward and keeps raw history folded until explicitly opened',()=>{
    useEngineering.setState({snapshot:{state:{idle:true},actions:[...actions,{id:'recover'},{id:'acknowledge'}]}});
    const before={repo:{id:'api'},files:{'old.ts':{hash:'old',mode:420}}},operation={id:'operation-a',repo:'api',operation:'command',status:'unknown',createdAt:'2026-10-27T00:00:00Z',before};
    const {rerender}=render(<TimeMachine value={{operations:[operation],checkpoints:[]}} details={<p>RAW_HISTORY</p>}/>);
    expect(screen.getByRole('button',{name:'核对中断运行'})).toBeVisible();expect(screen.getByText('RAW_HISTORY')).not.toBeVisible();expect(screen.getByRole('button',{name:'记录这一项的核对结果'})).toBeDisabled();
    rerender(<TimeMachine value={{operations:[{...operation,after:{...before,files:{'new.ts':{hash:'new',mode:420}}}}],checkpoints:[]}} details={<p>RAW_HISTORY</p>}/>);
    fireEvent.click(screen.getByText('已记录的文件变化 · 2 个文件'));expect(screen.getByText('删除 · api / old.ts')).toBeVisible();expect(screen.getByText('新增 · api / new.ts')).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'记录这一项的核对结果'}));expect(showRecordAction).toHaveBeenCalledWith('acknowledge',{id:'operation-a'},{id:expect.stringContaining('api · 命令执行')});
  });
  it('recognizes current conversation snapshots when the host ID differs from the native Pi session ID',()=>{
    useStore.setState({currentSessionId:'host-session-id'});useEngineering.setState({snapshot:{state:{idle:true,chat:{session:'current'}},actions}});
    render(<TimeMachine value={{checkpoints:points}} details={null}/>);expect(screen.getAllByText('当前对话')).toHaveLength(2);expect(screen.queryByText('其他对话')).toBeNull();
  });
  it('separates reasoning from file restore and previews the selected snapshot without a redundant form',async()=>{
    render(<TimeMachine value={{checkpoints:points,contextCheckpoints:[],modelRewinds:[]}} details={<p>technical</p>}/>);
    fireEvent.click(screen.getByText('该用哪一种？'));
    expect(screen.getByText('助手反复走错路线 → 纠正思路')).toBeVisible();
    expect(screen.getByText('本轮结束时')).toBeVisible();
    expect(screen.getByText('对话开始时')).toBeVisible();
    fireEvent.click(screen.getAllByRole('button',{name:'查看恢复预览'})[1]);
    expect(previewCheckpoint).toHaveBeenCalledWith('old-point','latest-point');
    expect(showAction).not.toHaveBeenCalled();
    await waitFor(()=>expect(screen.getAllByRole('button',{name:'查看恢复预览'})).toHaveLength(2));
  });
  it('reports failed preview and leaves the selected snapshot available for retry',async()=>{
    vi.mocked(previewCheckpoint).mockRejectedValueOnce(new Error('连接中断'));
    render(<TimeMachine value={{checkpoints:points}} details={null}/>);
    fireEvent.click(screen.getAllByRole('button',{name:'查看恢复预览'})[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent('连接中断');
    expect(screen.getAllByRole('button',{name:'查看恢复预览'})[0]).toBeEnabled();
    expect(showAction).not.toHaveBeenCalled();
  });
  it('offers an editable reasoning request without executing a restore',()=>{
    render(<TimeMachine value={{checkpoints:points,modelRewinds:[]}} details={null}/>);
    fireEvent.click(screen.getByRole('tab',{name:'助手纠偏 0'}));
    fireEvent.click(screen.getByRole('button',{name:'让助手检查当前路线'}));
    expect(composeTaskRequest).toHaveBeenCalledWith(expect.stringContaining('保留所有最新用户要求和当前文件'));
    expect(showAction).not.toHaveBeenCalled(); expect(previewCheckpoint).not.toHaveBeenCalled();
  });
  it('keeps previews available in read-only mode but disables file writes',()=>{
    useStore.setState({sessionPermissionMode:'read_only'});
    render(<><TimeMachine value={{checkpoints:points}} details={null}/><RestorePreview value={{target:'old-point',expected:'latest-point',applyAllowed:true,conflicts:[],changes:[{repo:'api',file:'a.ts',change:'modified'}]}} details={null}/></>);
    expect(screen.getByRole('button',{name:'保存快照'})).toBeDisabled();
    expect(screen.getAllByRole('button',{name:'另开方案'})[0]).toBeDisabled();
    expect(screen.getAllByRole('button',{name:'查看恢复预览'})[0]).toBeEnabled();
    expect(screen.getByRole('button',{name:'继续确认恢复'})).toBeDisabled();
  });
  it('disables mutations during execution while allowing users to inspect history',()=>{
    useEngineering.setState({snapshot:{state:{idle:false},actions}});
    render(<TimeMachine value={{checkpoints:points}} details={null}/>);
    expect(screen.getByRole('button',{name:'保存快照'})).toBeDisabled();
    expect(screen.getAllByRole('button',{name:'查看恢复预览'})[0]).toBeDisabled();
    expect(screen.getByText(/任务正在运行/)).toBeVisible();
  });
  it('switches between code recovery and reasoning history with keyboard navigation',()=>{
    render(<TimeMachine value={{checkpoints:points,modelRewinds:[]}} details={null}/>);
    const code=screen.getByRole('tab',{name:'恢复代码 2'});
    fireEvent.keyDown(code,{key:'ArrowRight'});
    expect(screen.getByRole('tab',{name:'助手纠偏 0'})).toHaveFocus();
    expect(screen.queryByRole('button',{name:'保存快照'})).toBeNull();
    expect(screen.getByText('还没有发生主动纠偏。这不代表代码快照不可用。')).toBeVisible();
    fireEvent.keyDown(screen.getByRole('tab',{name:'助手纠偏 0'}),{key:'Home'});
    expect(screen.getByRole('button',{name:'保存快照'})).toBeVisible();
  });
  it('explains an empty history without offering a broken restore',()=>{
    render(<TimeMachine value={{checkpoints:[]}} details={null}/>);
    expect(screen.getByText('先保存一个可以回来的位置')).toBeVisible();
    expect(screen.queryByRole('button',{name:'查看恢复预览'})).toBeNull();
  });
  it('requires a nonempty, conflict-free preview before offering the confirmation form',()=>{
    const value={target:'old-point',expected:'latest-point',applyAllowed:true,conflicts:[],changes:[{repo:'api',file:'src.ts',change:'modified',patch:'-new\n+old'}]};
    const {rerender}=render(<RestorePreview value={value} details={null}/>);
    fireEvent.click(screen.getByRole('button',{name:'继续确认恢复'}));
    expect(showAction).toHaveBeenCalledWith(expect.objectContaining({id:'restore',fields:expect.arrayContaining([expect.objectContaining({name:'context',value:false})])}));
    rerender(<RestorePreview value={{...value,changes:[]}} details={null}/>);
    expect(screen.getByRole('button',{name:'继续确认恢复'})).toBeDisabled();
    rerender(<RestorePreview value={{...value,applyAllowed:false,conflicts:['api: external edits differ from expected state']}} details={null}/>);
    expect(screen.getByRole('button',{name:'继续确认恢复'})).toBeDisabled();
    expect(screen.getByText(/已阻止覆盖/)).toBeVisible();
    expect(screen.getByRole('button',{name:'改为另开代码方案'})).toBeEnabled();
  });
  it('preserves user snapshot names and disambiguates equal default names with timestamps and IDs',()=>{
    expect(checkpointLabel('我的工作版本')).toBe('我的工作版本');
    expect(checkpointLabel('restored:session baseline')).toBe('恢复后 · 对话开始时');
    expect(checkpointLabel('before child merge')).toBe('预览子任务合并时');
    expect(checkpointLabel('task package')).toBe('导出代码任务包时');
    expect(checkpointLabel('restored:merge:delegation-123456')).toBe('恢复后 · 合入独立子任务 · 123456');
    expect(checkpointChoice(points[0])).not.toBe(checkpointChoice(points[1]));
    expect(presentAction(actions[2]).fields.find(f=>f.name==='expected')?.help).toContain('阻止恢复');
  });
});
