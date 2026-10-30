// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceChooser } from '../WorkspaceChooser';

const picker = vi.fn();
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); window.platform = {selectFolder:picker} as unknown as typeof window.platform; });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const props = () => ({initialRoot:'',initialMemory:false,nativePicker:true,busy:false,error:'',canConnect:true,onConnect:vi.fn(),onCancel:vi.fn()});

it('opens the native chooser once under StrictMode, shows the selected folder, then connects with exact values', async () => {
  const p=props(); picker.mockResolvedValue('/workspace/project with spaces');
  render(<StrictMode><WorkspaceChooser {...p}/></StrictMode>);
  await act(async () => { vi.runOnlyPendingTimers(); });
  expect(picker).toHaveBeenCalledTimes(1);
  expect(screen.getByText('project with spaces')).toBeVisible();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('switch',{name:'工程记忆'}));
  fireEvent.click(screen.getByRole('button',{name:'连接工作区'}));
  expect(p.onConnect).toHaveBeenCalledWith('/workspace/project with spaces',true);
});
it('reuses the existing directory without automatically opening a native chooser', async () => {
  const p={...props(),initialRoot:'/existing'}; picker.mockResolvedValue(null);
  render(<WorkspaceChooser {...p}/>); await act(async () => { vi.runOnlyPendingTimers(); });
  expect(picker).not.toHaveBeenCalled(); expect(p.onCancel).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'连接工作区'}));
  expect(p.onConnect).toHaveBeenCalledWith('/existing',false);
});
it('keeps the chosen path if the user cancels a replacement picker', async () => {
  const p=props(); picker.mockResolvedValueOnce('/chosen').mockResolvedValueOnce(null);
  render(<WorkspaceChooser {...p}/>); await act(async () => { vi.runOnlyPendingTimers(); });
  await act(async () => { fireEvent.click(screen.getByRole('button',{name:'更换文件夹'})); });
  expect(screen.getByText('/chosen')).toBeVisible(); expect(p.onCancel).not.toHaveBeenCalled();
});
it('keeps manual fallback for web/remote sessions and prevents native browser validation bubbles', () => {
  const p={...props(),nativePicker:false}; const view=render(<WorkspaceChooser {...p}/>);
  expect(picker).not.toHaveBeenCalled(); expect(view.container.querySelector('form')).toHaveAttribute('novalidate');
  expect(screen.getByRole('button',{name:'连接工作区'})).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'   '}});
  fireEvent.submit(view.container.querySelector('form')!); expect(p.onConnect).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox'),{target:{value:' /remote/project '}});
  fireEvent.click(screen.getByRole('button',{name:'连接工作区'}));
  expect(p.onConnect).toHaveBeenCalledWith('/remote/project',false);
});
it('offers an inline error and manual fallback if the native chooser fails', async () => {
  picker.mockRejectedValue(new Error('native error'));
  render(<WorkspaceChooser {...props()}/>); await act(async () => { vi.runOnlyPendingTimers(); });
  expect(screen.getByRole('alert')).toHaveTextContent('无法打开系统文件夹窗口');
  fireEvent.click(screen.getByRole('button',{name:'手动输入路径'}));
  expect(screen.getByRole('textbox')).toBeVisible();
});
it('ignores a picker response after the dialog has been closed or the conversation changed', async () => {
  let finish!:(value:string)=>void; picker.mockImplementationOnce(()=>new Promise<string>(resolve=>{finish=resolve;}));
  const p=props();const view=render(<WorkspaceChooser {...p}/>);await act(async()=>{vi.runOnlyPendingTimers();});view.unmount();
  await act(async()=>finish('/late'));expect(p.onConnect).not.toHaveBeenCalled();expect(p.onCancel).not.toHaveBeenCalled();
});
