// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { EngineeringPanel } from '../Engineering';
import { useEngineering } from '../state';
import { useStore } from '../../stores';

beforeEach(() => {
  useStore.setState({ jianOpen: true, jianAutoCollapsed: false });
  useEngineering.setState({ sessionPath: 'navigation-test', paneOpen: true, active: 'group:plan', tabs: [{ id: 'group:plan', group: 'plan', title: '任务计划' }], snapshot: { connected: true, actions: [], kind: 'worker', state: {} }, data: null, results: {}, error: '', loading: false });
});
afterEach(() => { cleanup(); useEngineering.setState({ paneOpen: false, snapshot: null, tabs: [], active: '' }); });
it('collapsing engineering closes the whole right rail while retaining tabs', () => {
  render(<EngineeringPanel />);
  fireEvent.click(screen.getByRole('button', { name: '收起工程面板' }));
  expect(useStore.getState().jianOpen).toBe(false);
  expect(useEngineering.getState().paneOpen).toBe(false);
  expect(useEngineering.getState().tabs).toHaveLength(1);
});
it('closing the final tab does not expose the old desk underneath', () => {
  render(<EngineeringPanel />);
  fireEvent.click(screen.getByRole('button', { name: '关闭 任务计划' }));
  expect(useStore.getState().jianOpen).toBe(false);
  expect(useEngineering.getState().tabs).toHaveLength(0);
});
