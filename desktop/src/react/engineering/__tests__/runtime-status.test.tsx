// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RuntimeStatus } from '../RuntimeStatus';
import { engineeringRequest, useEngineering } from '../state';
vi.mock('../state',async load=>({...await load<typeof import('../state')>(),engineeringRequest:vi.fn()}));
beforeEach(()=>{vi.useFakeTimers();useEngineering.setState({sessionPath:'/task-a',connectionId:'a'});vi.mocked(engineeringRequest).mockReset();});
afterEach(()=>{cleanup();vi.useRealTimers();});
it('updates runtime facts without requiring a tab reopen and marks an interrupted poll as stale',async()=>{
  vi.mocked(engineeringRequest).mockResolvedValueOnce({available:true,answer:'验证正在运行'}).mockResolvedValueOnce({available:true,answer:'验证已经结束'}).mockRejectedValueOnce(new Error('离线'));
  await act(async()=>{render(<RuntimeStatus evidence={()=>null}/>);});expect(screen.getByText('验证正在运行')).toBeVisible();
  await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});expect(screen.getByText('验证已经结束')).toBeVisible();
  await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});expect(screen.getByRole('status')).toHaveTextContent('状态更新失败');expect(screen.getByText('验证已经结束')).toBeVisible();
  expect(vi.mocked(engineeringRequest).mock.calls.every(call=>call[0]==='/data/observer'&&call[2]===undefined)).toBe(true);
});
it('does not display late facts from another conversation',async()=>{
  let resolve!:(value:any)=>void;vi.mocked(engineeringRequest).mockImplementationOnce(()=>new Promise(r=>{resolve=r;})).mockResolvedValue({available:true,answer:'新任务状态'});
  render(<RuntimeStatus evidence={()=>null}/>);await act(async()=>{useEngineering.setState({sessionPath:'/task-b'});});
  await act(async()=>{resolve({available:true,answer:'旧任务状态'});});expect(screen.queryByText('旧任务状态')).not.toBeInTheDocument();expect(screen.getByText('新任务状态')).toBeVisible();
});
