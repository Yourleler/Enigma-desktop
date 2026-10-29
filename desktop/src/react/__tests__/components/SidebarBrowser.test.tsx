// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SidebarBrowser } from '../../components/preview/SidebarBrowser';
import { browserDockVisible } from '../../hooks/use-browser-dock';
import type { SidebarBrowserState } from '../../types';

const dock = vi.fn(), release = vi.fn(async () => true), command = vi.fn();
let update: (state: SidebarBrowserState) => void;
let state: SidebarBrowserState;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  state = {surfaceId: '', sessionPath: 'alpha', activeTabId: 'a', url: 'https://example.com/form', tabs: [{tabId: 'a', title: 'New form'}]};
  dock.mockClear(); release.mockClear(); command.mockReset();
  command.mockImplementation(async () => state);
  window.platform = {
    sidebarBrowserBind: vi.fn(async ({surfaceId}) => {state = {...state, surfaceId}; return state;}),
    sidebarBrowserLayout: dock, sidebarBrowserRelease: release, sidebarBrowserCommand: command,
    onSidebarBrowserUpdate: (callback: (state: SidebarBrowserState) => void) => {update = callback; return vi.fn();},
  } as unknown as Window['platform'];
});
afterEach(() => {cleanup(); vi.unstubAllGlobals();});

it('attaches existing form without navigating and releases without closing tabs', async () => {
  const view = render(<SidebarBrowser sessionPath="alpha"/>);
  await screen.findByDisplayValue('https://example.com/form');
  expect(command).not.toHaveBeenCalled();
  const owner = state.surfaceId;
  view.unmount();
  expect(release).toHaveBeenCalledWith(owner);
  expect(command).not.toHaveBeenCalled();
});

it('uses current tab identity, rejects executable URLs and reports command failure', async () => {
  render(<SidebarBrowser sessionPath="alpha"/>);
  const address = await screen.findByDisplayValue('https://example.com/form');
  fireEvent.change(address, {target: {value: 'javascript:alert(1)'}});
  fireEvent.submit(address.closest('form')!);
  expect(command).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('http');
  command.mockRejectedValueOnce(new Error('当前标签页已变化'));
  fireEvent.change(address, {target: {value: 'http://127.0.0.1:4444/new'}});
  fireEvent.submit(address.closest('form')!);
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('当前标签页已变化'));
  expect(command).toHaveBeenCalledWith({surfaceId: state.surfaceId, action: 'navigate', tabId: 'a', url: 'http://127.0.0.1:4444/new'});
});

it('ignores another panel update and exposes stopping a load separately from emergency stop', async () => {
  render(<SidebarBrowser sessionPath="alpha"/>);
  await screen.findByDisplayValue('https://example.com/form');
  act(() => update({...state, surfaceId: 'stale-owner', url: 'https://wrong.example'}));
  expect(screen.getByDisplayValue('https://example.com/form')).toBeTruthy();
  act(() => update({...state, loading: true}));
  fireEvent.click(screen.getByRole('button', {name: '停止加载'}));
  await waitFor(() => expect(command).toHaveBeenCalledWith(expect.objectContaining({action: 'stop'})));
  fireEvent.click(screen.getByRole('button', {name: '急停'}));
  await waitFor(() => expect(command).toHaveBeenCalledWith(expect.objectContaining({action: 'emergencyStop'})));
});

it('detects only visible overlapping menus and settings as occlusion', () => {
  const element = document.createElement('div'); document.body.append(element);
  element.getBoundingClientRect = () => ({x: 600, y: 100, left: 600, top: 100, right: 950, bottom: 680, width: 350, height: 580}) as DOMRect;
  expect(browserDockVisible(element)).toBe(true);
  const overlay = document.createElement('div'); overlay.setAttribute('role', 'dialog'); document.body.append(overlay);
  overlay.getBoundingClientRect = () => ({left: 500, top: 50, right: 800, bottom: 500, width: 300, height: 450}) as DOMRect;
  expect(browserDockVisible(element)).toBe(false);
  overlay.style.visibility = 'hidden'; expect(browserDockVisible(element)).toBe(true);
  overlay.remove(); element.remove();
});

it('shows download status and scopes cancel/reveal to the current browser panel',async()=>{
  state={...state,downloads:[{id:'pending',filename:'large.pdf',state:'progress',receivedBytes:1024,totalBytes:8192},{id:'done',filename:'new.txt',state:'completed',receivedBytes:57,totalBytes:57,filePath:'/new-test/new.txt'}]};
  render(<SidebarBrowser/>);
  await screen.findByText('large.pdf');
  expect(screen.getByText('已完成')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'取消'}));
  await waitFor(()=>expect(command).toHaveBeenCalledWith(expect.objectContaining({surfaceId:state.surfaceId,action:'cancelDownload',downloadId:'pending'})));
  fireEvent.click(screen.getByRole('button',{name:'位置'}));
  await waitFor(()=>expect(command).toHaveBeenCalledWith(expect.objectContaining({surfaceId:state.surfaceId,action:'revealDownload',downloadId:'done'})));
});
