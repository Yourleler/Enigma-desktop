// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationPanel } from '../../components/AutomationPanel';
import { hanaFetch } from '../../hooks/use-hana-fetch';
import { useStore } from '../../stores';

vi.mock('../../hooks/use-hana-fetch', () => ({
  hanaFetch: vi.fn(),
}));

const addToast = vi.fn();

describe('AutomationPanel', () => {
  beforeEach(() => {
    window.t = ((key: string) => key) as typeof window.t;
    addToast.mockReset();
    vi.mocked(hanaFetch).mockReset();
    vi.mocked(hanaFetch).mockImplementation(async (url) => {
      if (url === '/api/models') {
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
    });
    useStore.setState({
      activePanel: 'automation',
      agents: [{ id: 'hanako', name: 'Hanako', yuan: 'hanako', homeFolder: '/home/hanako', isPrimary: true }],
      currentAgentId: 'hanako',
      currentSessionId: 'session-main',
      currentSessionPath: '/sessions/main.jsonl',
      sessions: [{ sessionId: 'session-main', path: '/sessions/main.jsonl', cwd: '/workspace' }],
      deskBasePath: '/workspace',
      deskWorkspaceMountId: null,
      homeFolder: '/home/hanako',
      workspaceFolders: ['/workspace'],
      sessionAuthorizedFoldersByPath: { '/sessions/main.jsonl': [] },
      addToast,
    } as never);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('loads tasks even when the model catalog is temporarily unavailable',async()=>{
    vi.mocked(hanaFetch).mockImplementation(async url=>{
      if(url==='/api/models')throw Error('catalog offline');
      return new Response(JSON.stringify({jobs:[{id:'known-task',label:'Known task',prompt:'Check',enabled:false,type:'cron',schedule:'0 9 * * *',actorAgentId:'hanako'}]}));
    });
    render(<AutomationPanel/>);
    expect(await screen.findByText('Known task')).toBeInTheDocument();
  });

  it('rejects an HTTP-200 error reply when removing a task',async()=>{
    vi.mocked(hanaFetch).mockImplementation(async (url,options)=>{
      if(options?.method==='POST')return new Response(JSON.stringify({error:'not found'}));
      if(url==='/api/models')return new Response(JSON.stringify({models:[]}));
      if(url.includes('jobId='))return new Response(JSON.stringify({runs:[]}));
      return new Response(JSON.stringify({jobs:[{id:'known-task',label:'Known task',prompt:'Check',enabled:false,type:'cron',schedule:'0 9 * * *',actorAgentId:'hanako'}]}));
    });
    render(<AutomationPanel/>);
    fireEvent.click(await screen.findByRole('button',{name:/Known task/}));
    fireEvent.click(screen.getByRole('button',{name:'automation.delete'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('not found');
    expect(screen.getByText('Known task')).toBeInTheDocument();
  });
  it('ignores a late task list after switching connections',async()=>{
    useStore.setState({serverPort:'3100',activeServerConnection:null,activeServerConnectionId:null,serverConnections:{}});
    let finish!:(response:Response)=>void;let requests=0;
    vi.mocked(hanaFetch).mockImplementation(async url=>{
      if(url==='/api/models')return new Response(JSON.stringify({models:[]}));
      if(++requests===1)return new Promise(resolve=>{finish=resolve;});
      return new Response(JSON.stringify({jobs:[]}));
    });
    render(<AutomationPanel/>);await waitFor(()=>expect(finish).toBeTypeOf('function'));
    useStore.setState({serverPort:'3101'});
    await waitFor(()=>expect(requests).toBe(2));
    finish(new Response(JSON.stringify({jobs:[{id:'stale',label:'Old connection task'}]})));
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(screen.queryByText('Old connection task')).toBeNull();
  });

  it('shows the structured POST error and keeps the panel usable', async () => {
    render(<AutomationPanel />);
    await waitFor(() => expect(hanaFetch).toHaveBeenCalledWith('/api/desk/cron', {
      throwOnHttpError: false,
    }));
    vi.mocked(hanaFetch).mockImplementation(async (url, options) => {
      if (url === '/api/desk/cron' && options?.method === 'POST') {
        return new Response(JSON.stringify({
          error: {
            code: 'cron_store_corrupt',
            message: 'automation task storage is corrupt',
          },
        }), { status: 500 });
      }
      if (url === '/api/models') {
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
    });

    const addButton = screen.getByRole('button', { name: 'automation.add' });
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        'automation.createFailed: automation task storage is corrupt',
        'error',
      );
    });
    const postCall = vi.mocked(hanaFetch).mock.calls.find(([, options]) => options?.method === 'POST');
    expect(postCall?.[1]).toEqual(expect.objectContaining({ throwOnHttpError: false }));
    expect(addButton).toBeEnabled();
  });

  it('shows a structured GET error without presenting an empty task list or clearing the badge', async () => {
    useStore.setState({ automationCount: 7 } as never);
    vi.mocked(hanaFetch).mockImplementation(async (url) => {
      if (url === '/api/desk/cron') {
        return new Response(JSON.stringify({
          error: {
            code: 'cron_store_corrupt',
            message: 'automation task storage is corrupt',
          },
        }), { status: 500 });
      }
      return new Response(JSON.stringify({ models: [] }), { status: 200 });
    });

    render(<AutomationPanel />);

    expect(await screen.findByRole('alert')).toHaveTextContent('automation task storage is corrupt');
    expect(screen.queryByText('automation.emptyForAgent')).not.toBeInTheDocument();
    expect(screen.queryByText('automation.empty')).not.toBeInTheDocument();
    expect(useStore.getState().automationCount).toBe(7);
    expect(hanaFetch).toHaveBeenCalledWith('/api/desk/cron', { throwOnHttpError: false });
  });
});
