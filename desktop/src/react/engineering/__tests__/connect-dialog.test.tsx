// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConnectDialog } from '../Engineering';
import { useEngineering, engineeringRequest, openGroup } from '../state';
import { useStore } from '../../stores';
vi.mock('../state', async load => ({...await load<typeof import('../state')>(), engineeringRequest:vi.fn(), openGroup:vi.fn()}));
beforeEach(() => {
  vi.useFakeTimers();vi.clearAllMocks();
  window.hana = {} as typeof window.hana;
  window.platform = {selectFolder:vi.fn(async()=>'/workspace/chosen')} as unknown as typeof window.platform;
  useStore.setState({activeServerConnectionId:'local',serverConnections:{local:{connectionId:'local',kind:'local'}}} as never);
  useEngineering.setState({connectOpen:true,sessionPath:'/session',connectionId:'local',snapshot:{connected:false}});
});
afterEach(() => { cleanup();vi.useRealTimers();Reflect.deleteProperty(window,'hana'); });
it('wires the local desktop picker to the current session connection only after confirmation',async()=>{
  vi.mocked(engineeringRequest).mockResolvedValue({connected:true,root:'/workspace/chosen'});
  render(<ConnectDialog/>);await act(async()=>{vi.runOnlyPendingTimers();});
  expect(window.platform.selectFolder).toHaveBeenCalledOnce();expect(engineeringRequest).not.toHaveBeenCalled();
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'连接工作区'}));});
  expect(engineeringRequest).toHaveBeenCalledWith('/connect','/session',{root:'/workspace/chosen',memory:false});
  expect(openGroup).toHaveBeenCalledWith('project');expect(useEngineering.getState().connectOpen).toBe(false);
});
it('never sends a local picker path to a remote server',async()=>{
  useStore.setState({activeServerConnectionId:'remote',serverConnections:{remote:{connectionId:'remote',kind:'custom_remote'}}} as never);
  useEngineering.setState({connectionId:'remote'});
  render(<ConnectDialog/>);await act(async()=>{vi.runOnlyPendingTimers();});
  expect(window.platform.selectFolder).not.toHaveBeenCalled();expect(screen.getByText('服务端目录路径')).toBeVisible();
});
