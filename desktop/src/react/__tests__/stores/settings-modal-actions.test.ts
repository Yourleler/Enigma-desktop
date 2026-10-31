import { beforeEach, describe, expect, it, vi } from 'vitest';
import {loadAgents} from '../../stores/agent-actions';
vi.mock('../../stores/agent-actions',()=>({loadAgents:vi.fn(async()=>{})}));
import { useStore } from '../../stores';
import {
  closeSettingsModal,
  openSettingsModal,
  setSettingsModalActiveTab,
} from '../../stores/settings-modal-actions';

describe('settings modal actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      settingsModal: { open: false, activeTab: 'agent' },
    } as never);
  });

  it('opens the settings modal on the agent tab by default', () => {
    openSettingsModal();

    expect(useStore.getState().settingsModal).toEqual({
      open: true,
      activeTab: 'agent',
    });
  });

  it('opens the settings modal on the requested tab', () => {
    openSettingsModal('work');

    expect(useStore.getState().settingsModal).toEqual({
      open: true,
      activeTab: 'work',
    });
  });

  it('closes the settings modal while preserving the last tab', () => {
    openSettingsModal('bridge');
    closeSettingsModal();

    expect(useStore.getState().settingsModal).toEqual({
      open: false,
      activeTab: 'bridge',
    });
    expect(loadAgents).toHaveBeenCalledOnce();
  });

  it('maps the removed Computer Use tab to experiments when reopening', () => {
    openSettingsModal('computer');
    closeSettingsModal();
    openSettingsModal();

    expect(useStore.getState().settingsModal).toEqual({
      open: true,
      activeTab: 'experiments',
    });
  });

  it('updates the remembered modal tab while it remains open', () => {
    openSettingsModal('agent');
    setSettingsModalActiveTab('security');

    expect(useStore.getState().settingsModal).toEqual({
      open: true,
      activeTab: 'security',
    });
  });
});
