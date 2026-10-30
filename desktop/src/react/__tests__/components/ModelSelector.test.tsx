// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hanaFetch } from '../../hooks/use-hana-fetch';
import {useModelSelectionStore} from '../../stores/model-selection-store';
import { ModelSelector } from '../../components/input/ModelSelector';

const addToast = vi.fn();

const storeState = {
  currentSessionPath: null as string | null,
  pendingNewSession: true,
  chatSessions: {} as Record<string, unknown>,
  sessionModelsByPath: {} as Record<string, unknown>,
  setModelSwitching: vi.fn(),
  updateSessionModel: vi.fn(),
  setThinkingLevel: vi.fn(),
  setPendingNewSessionThinkingLevel: vi.fn(),
  addToast,
};

vi.mock('../../stores', () => ({
  useStore: Object.assign((selector: (state:typeof storeState)=>unknown)=>selector(storeState),{
    getState: () => storeState,
    setState: vi.fn(),
  }),
}));

vi.mock('../../hooks/use-hana-fetch', () => ({
  hanaFetch: vi.fn(),
}));

vi.mock('../../hooks/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const models = [
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', provider: 'deepseek' },
  { id: 'mimo-v2-omni', name: 'MiMo V2 Omni', provider: 'mimo' },
];

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response;
}

describe('ModelSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hanaFetch).mockReset();
    vi.mocked(hanaFetch).mockResolvedValue(jsonResponse({selection:null}));
    useModelSelectionStore.setState({items:{}});
    storeState.currentSessionPath = null;
    storeState.pendingNewSession = true;
    storeState.chatSessions = {};
    storeState.sessionModelsByPath = {};
  });

  afterEach(() => {
    cleanup();
  });

  it('shows an explicit unselected state when models exist but none is current', () => {
    render(<ModelSelector models={models} />);

    expect(screen.getByRole('button', { name: /model.notSelected/ })).toBeTruthy();
  });

  it('shows the selected model provider icon in the closed trigger', () => {
    const { container } = render(
      <ModelSelector
        models={[
          { id: 'glm-5.2', name: 'GLM-5.2', provider: 'zhipu-coding', isCurrent: true },
        ]}
      />,
    );

    const trigger = screen.getByRole('button', { name: /GLM-5.2/ });
    expect(trigger.querySelector('svg')).toBeTruthy();
    expect(container.textContent).toContain('GLM-5.2');
  });

  it('opens the model menu while a response is streaming', () => {
    render(<ModelSelector models={[{...models[0],isCurrent:true},models[1]]} isStreaming/>);
    fireEvent.click(screen.getByRole('button',{name:/DeepSeek V4 Flash/}));
    expect(screen.getByRole('option',{name:/MiMo V2 Omni/})).toBeTruthy();
    expect(addToast).not.toHaveBeenCalled();
  });

  it('marks the session model unavailable when its provider/id is no longer in the model list', () => {
    render(
      <ModelSelector
        models={models}
        sessionModel={{
          id: 'removed-model',
          name: 'Removed Model',
          provider: 'deepseek',
        }}
      />,
    );

    expect(screen.getByRole('button', { name: /model.unavailable/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Removed Model/ })).toBeNull();
  });

  it('shows a reliable removal reason and allows explicitly re-selecting the same restored model', async () => {
    storeState.currentSessionPath = '/sessions/a.jsonl';
    storeState.pendingNewSession = false;
    storeState.chatSessions = {
      '/sessions/a.jsonl': { items: [{ type: 'message' }] },
    };
    const blockedModel = {
      ...models[0],
      available: false,
      unavailableReason: 'model_removed' as const,
    };
    storeState.sessionModelsByPath = {
      '/sessions/a.jsonl': blockedModel,
    };
    vi.mocked(hanaFetch).mockImplementation(async(url)=>String(url).startsWith('/api/models/selection?')?jsonResponse({selection:null}):jsonResponse({ok:true,model:{...models[0],available:true,unavailableReason:null}}));

    render(<ModelSelector models={models} sessionModel={blockedModel} />);

    fireEvent.click(screen.getByRole('button', { name: /model.removed/ }));
    fireEvent.click(screen.getByRole('option', { name: /DeepSeek V4 Flash/ }));

    await waitFor(() => {
      expect(hanaFetch).toHaveBeenCalledWith('/api/models/switch', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          sessionPath: '/sessions/a.jsonl',
          modelId: 'deepseek-v4-flash',
          provider: 'deepseek',
        }),
      }));
    });
    expect(storeState.updateSessionModel).toHaveBeenCalledWith(
      '/sessions/a.jsonl',
      expect.objectContaining({ available: true }),
    );
  });

  it('shows a pending selection without replacing the current response model', async () => {
    storeState.currentSessionPath='/sessions/a.jsonl';storeState.pendingNewSession=false;
    storeState.sessionModelsByPath={'/sessions/a.jsonl':models[0]};
    vi.mocked(hanaFetch).mockImplementation(async(url)=>String(url).startsWith('/api/models/selection?')?jsonResponse({selection:null}):jsonResponse({ok:true,model:models[0],selection:{id:models[1].id,provider:models[1].provider,revision:1,state:'pending'},effectiveAt:'next-request'}));
    render(<ModelSelector models={models} sessionModel={models[0]} isStreaming/>);
    fireEvent.click(screen.getByRole('button',{name:/DeepSeek V4 Flash/}));fireEvent.click(screen.getByRole('option',{name:/MiMo V2 Omni/}));
    await screen.findByText(/下一请求：MiMo/);
    expect(screen.getByRole('button',{name:/DeepSeek V4 Flash/})).toBeTruthy();
    expect(screen.getByRole('button',{name:'取消待切换模型'})).toBeTruthy();
    expect(addToast).not.toHaveBeenCalled();
  });

  it('shows a failed cancellation inline and retains the pending selection',async()=>{
    storeState.currentSessionPath='/sessions/a.jsonl';storeState.pendingNewSession=false;
    const selection={id:models[1].id,provider:models[1].provider,revision:1,state:'pending'};
    vi.mocked(hanaFetch).mockImplementation(async url=>String(url).startsWith('/api/models/selection?')?jsonResponse({selection}):jsonResponse({error:'模型已进入切换阶段'},false));
    render(<ModelSelector models={models} sessionModel={models[0]} isStreaming/>);
    fireEvent.click(await screen.findByRole('button',{name:'取消待切换模型'}));
    await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('模型已进入切换阶段'));
    expect(screen.getByRole('status').textContent).toContain('下一请求');
  });

  it('applies the selected model thinking default while preparing a new session', async () => {
    vi.mocked(hanaFetch)
      .mockResolvedValueOnce(jsonResponse({ ok: true, thinkingLevel: 'high' }))
      .mockResolvedValueOnce(jsonResponse({ models: [{ ...models[1], isCurrent: true }] }));

    render(<ModelSelector models={[{ ...models[0], isCurrent: true }, models[1]]} />);
    fireEvent.click(screen.getByRole('button', { name: /DeepSeek V4 Flash/ }));
    fireEvent.click(screen.getByRole('option', { name: /MiMo V2 Omni/ }));

    await waitFor(() => {
      expect(storeState.setThinkingLevel).toHaveBeenCalledWith('high');
    });
    expect(storeState.setPendingNewSessionThinkingLevel).toHaveBeenCalledWith('high');
    expect(hanaFetch).toHaveBeenCalledWith('/api/models/set', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ modelId: 'mimo-v2-omni', provider: 'mimo' }),
    }));
  });

  it('surfaces the model-switch response body when the server rejects an unavailable provider model', async () => {
    storeState.currentSessionPath = '/sessions/a.jsonl';
    storeState.pendingNewSession = false;
    storeState.chatSessions = {
      '/sessions/a.jsonl': { items: [{ type: 'message' }] },
    };
    storeState.sessionModelsByPath = {
      '/sessions/a.jsonl': {
        id: 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        provider: 'deepseek',
      },
    };
    vi.mocked(hanaFetch).mockImplementation(async(url)=>String(url).startsWith('/api/models/selection?')?jsonResponse({selection:null}):jsonResponse({code:'MODEL_NOT_FOUND',error:'Model not found: minimax-token-plan/MiniMax-M2.7'},false));

    render(
      <ModelSelector
        models={[
          ...models,
          { id: 'MiniMax-M2.7', name: 'MiniMax M2.7', provider: 'minimax-token-plan' },
        ]}
        sessionModel={storeState.sessionModelsByPath['/sessions/a.jsonl'] as any}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /DeepSeek V4 Flash/ }));
    fireEvent.click(screen.getByRole('option', { name: /MiniMax M2.7/ }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('Model not found: minimax-token-plan/MiniMax-M2.7', 'error');
    });
    expect(hanaFetch).toHaveBeenCalledWith('/api/models/switch', expect.objectContaining({
      throwOnHttpError: false,
    }));
  });
});
