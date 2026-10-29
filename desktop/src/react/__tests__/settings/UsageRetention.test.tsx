// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { UsageRetention } from '../../settings/tabs/UsageRetention';
import { hanaFetch } from '../../settings/api';
vi.mock('../../settings/api', () => ({ hanaFetch: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('previews removals, prevents invalid saves and updates only after a successful response', async () => {
  vi.mocked(hanaFetch).mockResolvedValueOnce(new Response(JSON.stringify({ maximum: 5000, retained: 125 })));
  const saved = vi.fn(); render(<UsageRetention connection="local" onSaved={saved}/>); await act(async () => {});
  const input = screen.getByLabelText('最多保留的请求数');
  fireEvent.change(input, { target: { value: '99' } }); expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
  fireEvent.change(input, { target: { value: '100' } }); expect(screen.getByText(/移除最早的 25 条/)).toBeVisible();
  vi.mocked(hanaFetch).mockRejectedValueOnce(new Error('未能保存保留条数，原记录未改动'));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存' })); });
  expect(screen.getByText(/当前保留 125 条/)).toBeVisible(); expect(saved).not.toHaveBeenCalled();
  vi.mocked(hanaFetch).mockResolvedValueOnce(new Response(JSON.stringify({ maximum: 100, retained: 100 })));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存' })); });
  expect(screen.getByText(/当前保留 100 条/)).toBeVisible(); expect(saved).toHaveBeenCalledOnce();
});

it('does not display the previous server retention when the connection changes', async () => {
  vi.mocked(hanaFetch).mockResolvedValueOnce(new Response(JSON.stringify({ maximum: 10000, retained: 500 })));
  const view = render(<UsageRetention connection="one" onSaved={() => {}}/>); await act(async () => {});
  vi.mocked(hanaFetch).mockImplementationOnce(() => new Promise(() => {}));
  view.rerender(<UsageRetention connection="two" onSaved={() => {}}/>);
  expect(screen.getByLabelText('最多保留的请求数')).toBeDisabled(); expect(screen.queryByText(/当前保留 500 条/)).not.toBeInTheDocument();
});
