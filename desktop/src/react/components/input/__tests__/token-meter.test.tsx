// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TokenMeterPill } from '../TokenMeterPill';
import { useTokenMeterStore } from '../token-meter-store';
import { useStore } from '../../../stores';
import type {TokenMeterSnapshot} from '../../../../../../shared/token-meter-types';
const meter:TokenMeterSnapshot={state:'running',phase:'writing',runId:1,model:'gateway/model',startedAt:1000,endedAt:null,elapsedMs:1200,requests:2,up:{tokens:1234,estimated:false},down:{tokens:80,estimated:true},rate:40,cacheRead:100,cacheWrite:0,sampledAt:2200,firstOutputAt:1400};
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(2200);useStore.setState({currentSessionPath:'sp',activeServerConnectionId:'a',connected:true});useTokenMeterStore.setState({metersBySession:{}});});
afterEach(()=>{cleanup();vi.useRealTimers();});
it('labels input and output, explains scope/estimates, and retains completed usage',()=>{
  useTokenMeterStore.getState().applyTokenMeter('sp',meter,'a');render(<TokenMeterPill/>);
  expect(screen.getByText('↑ 输入')).toBeVisible();expect(screen.getByText('↓ 输出')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'查看本轮模型用量'}));expect(screen.getByRole('dialog',{name:'本轮模型用量'})).toHaveTextContent('一次发送内');
  act(()=>vi.advanceTimersByTime(20));expect(screen.getByRole('button',{name:'关闭用量明细'})).toHaveFocus();
  expect(screen.getByRole('dialog')).toHaveTextContent('估算 token');
  act(()=>useTokenMeterStore.getState().applyTokenMeter('sp',{...meter,state:'done',endedAt:2300,elapsedMs:1300},'a'));
  act(()=>vi.advanceTimersByTime(20000));expect(screen.getByTestId('token-meter')).toHaveTextContent('本轮结束');
});
it('does not show another server usage, and marks disconnected updates without claiming completion',()=>{
  useTokenMeterStore.getState().applyTokenMeter('sp',meter,'b');render(<TokenMeterPill/>);expect(screen.getByText('尚无用量')).toBeVisible();
  act(()=>useTokenMeterStore.getState().applyTokenMeter('sp',meter,'a'));act(()=>useStore.setState({connected:false}));
  expect(screen.getByText('用量更新中断')).toBeVisible();
});
it('ignores malformed and older snapshots',()=>{
  useTokenMeterStore.getState().applyTokenMeter('sp',meter,'a');useTokenMeterStore.getState().applyTokenMeter('sp',{...meter,startedAt:500},'a');
  useTokenMeterStore.getState().applyTokenMeter('bad',{} as any,'a');
  expect(Object.keys(useTokenMeterStore.getState().metersBySession)).toHaveLength(1);expect(Object.values(useTokenMeterStore.getState().metersBySession)[0].startedAt).toBe(1000);
});

it('labels post-response processing separately and preserves actual token totals',()=>{
 useTokenMeterStore.getState().applyTokenMeter('sp',{...meter,phase:'processing',rate:0},'a');render(<TokenMeterPill/>);expect(screen.getByText('后续处理中')).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'查看本轮模型用量'}));expect(screen.getByRole('dialog')).toHaveTextContent('这次模型响应已结束');expect(screen.getByRole('dialog')).toHaveTextContent('当前没有模型输出');expect(screen.getByRole('dialog')).toHaveTextContent('1,234');
});
