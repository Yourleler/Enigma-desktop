// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityPanel } from '../../components/ActivityPanel';
import { useStore } from '../../stores';
import {fetchConfig} from '../../hooks/use-config';
import { hanaFetch } from '../../hooks/use-hana-fetch';

vi.mock('../../hooks/use-panel', () => ({
  usePanel: () => ({ visible: true, close: vi.fn() }),
}));

vi.mock('../../hooks/use-hana-fetch', () => ({
  hanaFetch: vi.fn(),
}));

vi.mock('../../hooks/use-config', () => ({
  fetchConfig: vi.fn(() => Promise.resolve({ desk: { heartbeat_master: true } })),
  invalidateConfigCache: vi.fn(),
}));

describe('ActivityPanel', () => {
  beforeEach(() => {
    window.t = ((key: string, vars?: Record<string, string>) => {
      if (key === 'activity.duration') return `耗时 ${vars?.text || ''}`;
      return key;
    }) as typeof window.t;
    vi.mocked(hanaFetch).mockImplementation((path: string) => {
      if (path === '/api/desk/activities/act_cover/session?agentId=agent-hana') {
        return Promise.resolve({
          json: () => Promise.resolve({
            messages: [{ role: 'assistant', content: 'cover 已经生成' }],
          }),
        } as Response);
      }
      return Promise.resolve({
        json: () => Promise.resolve({}),
      } as Response);
    });
    useStore.setState({
      activities: [{
        id: 'act_cover',
        type: 'beautify',
        label: 'Markdown cover',
        status: 'running',
        agentId: 'agent-hana',
        agentName: 'Hanako',
        summary: '正在为 傍晚.md 生成 cover',
        sessionFile: 'act_cover.jsonl',
        startedAt: Date.now(),
      }],
      agents: [{ id: 'agent-hana', name: 'Hanako', yuan: '', isPrimary: true }],
      currentAgentId: 'agent-hana',
      agentName: 'Hanako',
    } as never);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('retains the selected category when an unrelated activity is refreshed',async()=>{
    const rows=[{id:'cron',type:'cron',agentId:'agent-hana',summary:'Scheduled result'},{id:'patrol',type:'heartbeat',agentId:'agent-hana',summary:'Patrol result'}];
    useStore.setState({activities:rows as never});render(<ActivityPanel/>);
    fireEvent.click(screen.getByRole('tab',{name:/activity.patrolRuns/}));
    await act(async()=>useStore.setState({activities:rows.map(row=>({...row})) as never}));
    expect(screen.getByRole('tab',{name:/activity.patrolRuns/})).toHaveAttribute('aria-selected','true');
  });
  it('does not offer promotion while a background session is still running',()=>{
    render(<ActivityPanel/>);expect(screen.getByRole('button',{name:'activity.promote'})).toBeDisabled();
  });

  it('keeps a failed promotion visible and allows retry without hiding the source record',async()=>{
    useStore.setState({activities:[{...useStore.getState().activities[0],status:'done'}]});
    vi.mocked(hanaFetch).mockResolvedValue(new Response(JSON.stringify({error:'Existing conversation is protected'}),{status:409}));
    render(<ActivityPanel/>);fireEvent.click(screen.getByRole('button',{name:'activity.promote'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Existing conversation is protected');
    expect(useStore.getState().activities).toHaveLength(1);expect(screen.getByRole('button',{name:'activity.promote'})).toBeEnabled();
  });
  it('does not show an old transcript after switching server identity',async()=>{
    let finish!:(response:Response)=>void;vi.mocked(hanaFetch).mockReturnValue(new Promise(resolve=>{finish=resolve;}));
    useStore.setState({serverPort:'3010',activeServerConnection:null,activeServerConnectionId:null,serverConnections:{}});
    render(<ActivityPanel/>);fireEvent.click(screen.getByRole('button',{name:'activity.expand'}));
    await act(async()=>{useStore.setState({serverPort:'3011'});});
    await act(async()=>finish(new Response(JSON.stringify({messages:[{role:'assistant',content:'Old server content'}]}))));
    expect(screen.queryByText('Old server content')).toBeNull();expect(useStore.getState().activities).toEqual([]);
  });

  it('does not undo a confirmed patrol change when an older config read finishes late',async()=>{
    vi.mocked(hanaFetch).mockImplementation(async path=>new Response(JSON.stringify(path==='/api/desk/activities'?{activities:useStore.getState().activities}:{ok:true})));
    render(<ActivityPanel/>);fireEvent.click(screen.getByRole('button',{name:'刷新记录'}));
    await waitFor(()=>expect(screen.getByRole('switch',{name:'自动巡检'})).toBeEnabled());
    let finish!:(value:any)=>void;vi.mocked(fetchConfig).mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
    fireEvent.click(screen.getByRole('button',{name:'刷新记录'}));fireEvent.click(screen.getByRole('switch',{name:'自动巡检'}));
    await waitFor(()=>expect(screen.getByRole('switch',{name:'自动巡检'})).toHaveAttribute('aria-checked','false'));
    await act(async()=>finish({desk:{heartbeat_master:true}}));
    expect(screen.getByRole('switch',{name:'自动巡检'})).toHaveAttribute('aria-checked','false');
  });

  it('leaves loading state and renders the background session transcript after expansion', async () => {
    render(<ActivityPanel />);

    await screen.findByText('正在为 傍晚.md 生成 cover');
    fireEvent.click(screen.getByRole('button', { name: 'activity.expand' }));

    expect(screen.getByText('activity.loadingSession')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('cover 已经生成')).toBeInTheDocument();
    });
    expect(screen.queryByText('activity.loadingSession')).not.toBeInTheDocument();
  });
});
