/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const hanaFetchMock = vi.fn();

vi.mock('../../api', () => ({
  hanaFetch: (...args: unknown[]) => hanaFetchMock(...args),
}));

vi.mock('../../helpers', () => ({
  t: (key: string) => {
    if (key === 'settings.computerUse.experimentalWarning') {
      return 'Computer use 功能属于测试阶段，而且对模型性能要求较高，请在知晓所有风险后开启，目前已验证某些软件下不按预期工作，建议只是尝鲜。';
    }
    return key;
  },
}));

vi.mock('@/ui', () => ({
  Toggle: ({ on }: { on?: boolean }) => (
    <button type="button" data-testid={`computer-toggle-${on === undefined ? 'loading' : on ? 'on' : 'off'}`}>
      toggle
    </button>
  ),
}));

import { ComputerUseSection } from '../ComputerUseSection';
import { useSettingsStore } from '../../store';

afterEach(() => {
  cleanup();
  hanaFetchMock.mockReset();
  useSettingsStore.setState({
    toastMessage: '',
    toastType: '',
    toastVisible: false,
    settingsSnapshot: {
      key: null,
      status: 'idle',
      data: null,
      error: null,
      requestId: 0,
      updatedAt: null,
    },
  } as any);
});

function jsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

describe('ComputerUseSection', () => {
  it('hydrates the enabled switch from the unified settings snapshot before refresh completes', async () => {
    let resolveLoad: (response: Response) => void = () => {};
    hanaFetchMock.mockImplementation(() => new Promise<Response>((resolve) => {
      resolveLoad = resolve;
    }));
    useSettingsStore.setState({
      settingsSnapshot: {
        key: 'local:snapshot:agent-a',
        status: 'ready',
        error: null,
        requestId: 1,
        updatedAt: Date.now(),
        data: {
          preferences: {
            computerUse: {
              selectedProviderId: 'macos:cua',
              settings: { enabled: true, app_approvals: [] },
              status: {
                providers: [{ providerId: 'macos:cua', status: { available: true, permissions: [] } }],
                activeLease: null,
              },
            },
          },
        },
      },
    } as any);

    render(<ComputerUseSection />);

    expect(screen.getByTestId('computer-toggle-on')).toBeTruthy();
    expect(screen.queryByTestId('computer-toggle-loading')).toBeNull();

    resolveLoad(jsonResponse({
      selectedProviderId: 'macos:cua',
      settings: { enabled: true, app_approvals: [] },
      status: {
        providers: [{ providerId: 'macos:cua', status: { available: true, permissions: [] } }],
        activeLease: null,
      },
    }));
    await waitFor(() => expect(hanaFetchMock).toHaveBeenCalledWith('/api/preferences/computer-use'));
  });

  it('distinguishes a loaded plugin from allowing control and does not claim unchecked permissions are granted', async () => {
    hanaFetchMock.mockResolvedValue(jsonResponse({
      selectedProviderId: 'macos:cua',
      settings: { enabled: false, app_approvals: [] },
      status: {
        providers: [{ providerId: 'macos:cua', status: { available: true, permissions: [] } }],
        activeLease: null,
      },
    }));

    render(<ComputerUseSection />);

    await waitFor(() => expect(hanaFetchMock).toHaveBeenCalledWith('/api/preferences/computer-use'));
    expect(screen.getByRole('status').textContent).toBe('settings.computerUse.controlDisabled');
    expect(screen.getByText('settings.computerUse.permissionsEmpty')).toBeTruthy();
    expect(screen.queryByTestId('computer-use-experimental-warning')).toBeNull();
  });
  it('makes plugin disablement explicit even if the independent global preference is enabled',async()=>{
    hanaFetchMock.mockResolvedValue(jsonResponse({settings:{enabled:true,app_approvals:[]},status:{providers:[]}}));
    render(<ComputerUseSection pluginEnabled={false}/>);
    await waitFor(()=>expect(screen.getByRole('status').textContent).toBe('settings.computerUse.pluginDisabled'));
  });
  it('revokes only the selected application approval',async()=>{
    hanaFetchMock.mockResolvedValue(jsonResponse({settings:{enabled:true,app_approvals:[{providerId:'macos:cua',appId:'new.fixture',appName:'New fixture'}]},status:{providers:[]}}));
    render(<ComputerUseSection/>);
    fireEvent.click(await screen.findByText('settings.computerUse.revoke'));
    await waitFor(()=>expect(hanaFetchMock).toHaveBeenCalledWith('/api/preferences/computer-use/approvals',expect.objectContaining({method:'DELETE',body:JSON.stringify({providerId:'macos:cua',appId:'new.fixture',appName:'New fixture'})})));
  });

  it('shows a toast when requesting permissions fails', async () => {
    hanaFetchMock
      .mockResolvedValueOnce(jsonResponse({
        selectedProviderId: 'macos:cua',
        settings: { enabled: false, app_approvals: [] },
        status: {
          providers: [{ providerId: 'macos:cua', status: { available: false, reason: 'binary-not-found', permissions: [] } }],
          activeLease: null,
        },
      }))
      .mockRejectedValueOnce(new Error('hanaFetch /api/preferences/computer-use/request-permissions: 400 Bad Request'));

    render(<ComputerUseSection />);

    await waitFor(() => expect(hanaFetchMock).toHaveBeenCalledWith('/api/preferences/computer-use'));
    fireEvent.click(screen.getByText('settings.computerUse.requestPermissions'));

    await waitFor(() => {
      expect(useSettingsStore.getState().toastType).toBe('error');
      expect(useSettingsStore.getState().toastMessage).toContain('400 Bad Request');
    });
  });
});
