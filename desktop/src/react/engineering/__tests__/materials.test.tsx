// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MaterialsPanel, MaterialDocument } from '../Materials';
import { openEngineering, showRecordAction, useEngineering } from '../state';
import { useStore } from '../../stores';
vi.mock('../state', async load => ({ ...await load<typeof import('../state')>(), openEngineering: vi.fn(), showRecordAction: vi.fn() }));
const resource = { id: 'source-31', revision: 1, title: '接口迁移设计', createdAt: '2026-10-27T00:00:00Z', task: 'current-task', source: { kind: 'file', repo: 'api', file: 'DESIGN.md' } };
beforeEach(() => { vi.clearAllMocks(); useStore.setState({ sessionPermissionMode: 'ask' }); useEngineering.setState({ sessionPath: '/current', connectionId: 'one', snapshot: { state: { idle: true }, actions: ['material-refresh', 'material-remove', 'material-raw'].map(id => ({ id })) } }); });
afterEach(cleanup);
it('shows result limits and source freshness and does not mistake zero search matches for an empty project', () => {
  const { rerender } = render(<MaterialsPanel value={{ items: [{ ...resource, current: false }], totalMatches: 40, truncated: true }} />);
  expect(screen.getByText(/显示前 1 \/ 40/)).toBeVisible(); expect(screen.getByText('来源已变化，请更新资料')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /接口迁移设计/ })); expect(openEngineering).toHaveBeenCalledWith(expect.objectContaining({ resource: 'source-31' }));
  rerender(<MaterialsPanel value={{ items: [], query: '不存在', totalMatches: 0 }} />);
  expect(screen.getByText('没有找到匹配的资料')).toBeVisible(); expect(screen.queryByText('让背景资料跟着任务走')).toBeNull();
});
it('distinguishes the saved revision from the current source and pins direct actions to the selected record', () => {
  render(<MaterialDocument value={{ resource, current: false, content: '# Saved design' }} evidence={() => null} />);
  expect(screen.getByText(/刷新只重新读取本地记录/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '从来源更新资料' }));
  expect(showRecordAction).toHaveBeenCalledWith('material-refresh', { id: 'source-31' }, { id: '接口迁移设计' });
  fireEvent.click(screen.getByRole('button', { name: 'api / DESIGN.md' })); expect(openEngineering).toHaveBeenCalledWith(expect.objectContaining({ repo: 'api', file: 'DESIGN.md' }));
});
it('makes partial imports explicit and leaves read access available without offering forbidden writes', () => {
  useStore.setState({ sessionPermissionMode: 'read_only' });
  const imported = { ...resource, source: { kind: 'imported', uri: 'https://example.com/design', capture: { provider: 'lark', scope: 'outline' } } };
  const { rerender } = render(<MaterialDocument value={{ resource: imported, current: null, content: '## Outline' }} evidence={() => null} />);
  expect(screen.getByText(/不能视为完整文档/)).toBeVisible(); expect(screen.getByRole('button', { name: '从来源更新资料' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '查看原始获取记录' })).toBeEnabled();
  rerender(<MaterialDocument value={{ resource: { ...resource, source: { kind: 'note', author: 'user' } }, current: true, content: 'manual note' }} evidence={() => null} />);
  expect(screen.queryByRole('button', { name: '从来源更新资料' })).toBeNull(); expect(screen.getByText(/没有自动刷新的外部来源/)).toBeVisible();
});
