// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CollaborationPanel } from '../Collaboration';
import { OperationResult } from '../OperationResult';
import { engineeringRequest, showRecordAction, useEngineering } from '../state';
import { useStore } from '../../stores';
vi.mock('../state', async load => ({ ...await load<typeof import('../state')>(), engineeringRequest: vi.fn(), showRecordAction: vi.fn() }));
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  useEngineering.setState({ sessionPath: '/task', connectionId: 'one', snapshot: { state: { idle: true }, actions: ['delegate-start', 'delegate-preview', 'delegate-cancel', 'delegate-merge', 'restore', 'experiment-evaluate', 'experiment-select'].map(id => ({ id })) } });
  useStore.setState({ sessionPermissionMode: 'ask' });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('offers merge only for successful children and makes failed or budget-limited results readable', async () => {
  const value = { delegations: ['failed', 'cancelled', 'budget', 'unknown', 'completed', 'running'].map(status => ({ spec: { id: status, goal: status, target: 'pi', workspace: `/isolated/${status}` }, state: { answer: '部分结果' }, status, terminal: status !== 'running' })) };
  vi.mocked(engineeringRequest).mockResolvedValue(value);
  await act(async () => { render(<CollaborationPanel initial={value} evidence={() => null} />); });
  expect(screen.getAllByRole('button', { name: '预览合并结果' })).toHaveLength(1);
  expect(screen.getByText('调用额度已用完')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '预览合并结果' }));
  expect(showRecordAction).toHaveBeenCalledWith('delegate-preview', { id: 'completed' });
  fireEvent.click(screen.getByRole('button', { name: '取消此任务' }));
  expect(showRecordAction).toHaveBeenCalledWith('delegate-cancel', { id: 'running' });
});
it('exposes comparison results and allows only currently verified candidates to be selected', async () => {
  const value = { experiments: [{ experiment: { id: 'comparison', goal: '选择兼容方案' }, report: {}, criteriaCurrent: true, candidates: [
    { id: 'a', status: 'passed', selectable: true,actual:{results:[{check:'compatibility',status:'passed',output:'COMPATIBLE'}]} }, { id: 'b', status: 'passed', selectable: false },
  ] }] };
  vi.mocked(engineeringRequest).mockResolvedValue(value);
  await act(async () => { render(<CollaborationPanel initial={value} evidence={() => null} />); });
  expect(screen.getByText('原验收通过，当前已失效')).toBeVisible(); expect(screen.queryByRole('button', { name: '预览采用 b' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '预览采用 a' }));
  expect(showRecordAction).toHaveBeenCalledWith('experiment-select', { id: 'comparison', candidate: 'a' });
  fireEvent.click(screen.getByText('查看检查输出 · 1 项'));expect(screen.getByText('COMPATIBLE')).toBeVisible();
});
it('routes direct and experiment merge previews to child integration rather than time-machine restore', () => {
  const preview = { id: 'merge-id', delegation: 'child-id', expected: 'baseline', proposed: 'proposal', applyAllowed: true, conflicts: [], changes: [{ repo: 'api', file: 'index.js', state: 'apply', patch: '-old\n+new' }] };
  const { rerender } = render(<OperationResult value={preview} details={null} />);
  expect(screen.getByRole('region', { name: '子任务合并预览' })).toBeVisible();
  expect(screen.queryByRole('button', { name: '继续确认恢复' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '继续确认合并' })); expect(showRecordAction).toHaveBeenCalledWith('delegate-merge', { id: 'merge-id' });
  rerender(<OperationResult value={{ decision: { candidate: 'a' }, preview }} details={null} />);
  expect(screen.getByRole('button', { name: '继续确认合并' })).toBeEnabled();
  rerender(<OperationResult value={{ ...preview, applyAllowed: false, conflicts: ['external edits'] }} details={null} />);
  expect(screen.getByRole('button', { name: '继续确认合并' })).toBeDisabled();
});
it('distinguishes applied code from successful project acceptance in merge receipts',()=>{
 const value={delegation:'child',preview:'merge',verification:{status:'failed',results:[{check:'joint',status:'failed',output:'consumer mismatch'}]}};
 const {rerender}=render(<OperationResult value={value} details={null}/>);
 expect(screen.getByRole('status')).toHaveTextContent('子任务已合并，项目检查尚未通过');
 expect(screen.queryByRole('button',{name:'继续确认合并'})).toBeNull();
 rerender(<OperationResult value={{...value,verification:{status:'verified',results:[]}}} details={null}/>);
 expect(screen.getByRole('status')).toHaveTextContent('子任务已合并，项目检查通过');
});
