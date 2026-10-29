// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PlanPanel } from '../Plan';
import { engineeringRequest, showRecordAction, useEngineering } from '../state';
import { useStore } from '../../stores';
vi.mock('../state', async load => ({ ...await load<typeof import('../state')>(), engineeringRequest: vi.fn(), showRecordAction: vi.fn() }));
const plan = { plan: { id: 'plan-a', revision: 2, goal: '统一接口' }, completed: 1, total: 2, steps: [
  { id: 'opaque-a', repo: 'api', goal: '升级响应结构', phase: 'verified', state: 'verified', checks: ['api-check'] },
  { id: 'opaque-b', repo: 'sdk', goal: '更新消费者', phase: 'pending', state: 'ready', checks: [] },
] };
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  useEngineering.setState({ sessionPath: '/task', connectionId: 'one', snapshot: { state: { idle: true }, actions: [{ id: 'plan-step' }] } });
  useStore.setState({ sessionPermissionMode: 'ask' });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('replaces obsolete completion marks after refresh and explains blocked dependencies by their goals', async () => {
  const stale = { ...plan, completed: 0, steps: [
    { ...plan.steps[0], state: 'stale' }, { ...plan.steps[1], state: 'blocked', blockedBy: ['opaque-a'] },
  ] };
  vi.mocked(engineeringRequest).mockResolvedValueOnce(plan).mockResolvedValue(stale);
  await act(async () => { render(<PlanPanel initial={plan} evidence={() => null} />); });
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1'); expect(screen.getByText('✓')).toBeVisible();
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.queryByText('✓')).not.toBeInTheDocument(); expect(screen.getByText('需要重新验证')).toBeVisible();
  expect(screen.getByText('等待：升级响应结构')).toBeVisible(); expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  expect(screen.getByText(/尚未指定验收检查/)).toBeVisible();
});
it('shows a failed refresh as a historical record and prevents an update against unknown current state', async () => {
  vi.mocked(engineeringRequest).mockRejectedValue(new Error('offline'));
  await act(async () => { render(<PlanPanel initial={plan} evidence={() => null} />); });
  expect(screen.getByRole('status')).toHaveTextContent('最近记录');
  for (const button of screen.getAllByRole('button', { name: '更新此步骤' })) expect(button).toBeDisabled();
  vi.mocked(engineeringRequest).mockResolvedValue(plan);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重新读取计划' })); });
  fireEvent.click(screen.getAllByRole('button', { name: '更新此步骤' })[0]);
  expect(showRecordAction).toHaveBeenCalledWith('plan-step', expect.objectContaining({ plan: 'plan-a', revision: 2, step: 'opaque-a' }));
});
