// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../stores';
import { ChatSidebar, ChatSidebarContent,AppNavigationRail } from '../../components/app/ChatSidebar';

vi.mock('../../components/channels/ChannelList', () => ({
  ChannelListSidebar: () => <section data-testid="channel-list-sidebar" />,
}));

vi.mock('../../components/RegionalErrorBoundary', () => ({
  RegionalErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../components/SessionList', () => ({
  SessionList: () => <section data-testid="session-list" />,
}));

vi.mock('../../components/notices/SidebarNoticeSlot', () => ({
  SidebarNoticeSlot: () => null,
}));

vi.mock('../../stores/browser-slice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../stores/browser-slice')>();
  return {
    ...actual,
    useAnyBrowserRunning: () => false,
  };
});

describe('ChatSidebarContent', () => {
  beforeEach(() => {
    window.t = ((key: string) => ({
      'sidebar.title': '对话',
      'sidebar.newChat': '新对话',
      'sidebar.collapse': '收起',
      'sidebar.bridgeShort': '桥接',
      'sidebar.activity': '助手活动',
      'automation.title': '任务计划',
      'skills.panel.title': 'Skills',
      'browser.background': '浏览器',
      'browser.backgroundHint': '浏览器',
      'settings.title': '设置',
    }[key] || key)) as typeof window.t;
    useStore.setState({
      automationCount: 0,
      bridgeDotConnected: false,
      currentAgentId: 'agent-a',
      currentTab: 'chat',
    } as never);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('opens side conversation as a drawer on narrow screens and beside chat on wide screens',()=>{
    vi.stubGlobal('innerWidth',550);
    useStore.setState({jianOpen:false,jianAutoCollapsed:false,sidebarOpen:false,sidebarAutoCollapsed:false,layoutDrawer:null});
    render(<AppNavigationRail/>);
    fireEvent.click(screen.getByRole('button',{name:'侧边对话'}));
    expect(useStore.getState()).toMatchObject({jianOpen:true,layoutDrawer:'workspace'});
    vi.stubGlobal('innerWidth',1200);
    fireEvent.click(screen.getByRole('button',{name:'侧边对话'}));
    expect(useStore.getState()).toMatchObject({jianOpen:true,layoutDrawer:null});
  });

  it('keeps the desktop collapse control in the titlebar and disables hidden sidebar content', () => {
    const props = { onNewSession: vi.fn(), onCollapse: vi.fn(), includeChannels: false };
    const { container, rerender } = render(<ChatSidebar open {...props} />);
    expect(screen.queryByRole('button', { name: '收起' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新对话' })).toBeInTheDocument();
    rerender(<ChatSidebar open={false} {...props} />);
    expect(container.querySelector('#sidebar')).toHaveAttribute('inert');
    expect(screen.queryByRole('button', { name: '新对话' })).not.toBeInTheDocument();
  });

  it('places settings at the bottom of the narrow application rail',()=>{const onOpenSettings=vi.fn();render(<ChatSidebarContent onNewSession={vi.fn()} onCollapse={vi.fn()} onOpenSettings={onOpenSettings}/>);const settings=screen.getByRole('button',{name:'设置'});expect(settings.closest('.enigma-sidebar-rail-bottom')).toBeTruthy();fireEvent.click(settings);expect(onOpenSettings).toHaveBeenCalledOnce();expect(screen.getByRole('button',{name:'搜索对话历史'})).toBeVisible();});

  it('keeps the outer navigation and settings accessible when the conversation list is collapsed',()=>{
    const open=vi.fn();render(<div className="app"><AppNavigationRail onOpenSettings={open}/><div className="enigma-workspace-frame"><ChatSidebar open={false} showNavigationRail={false} includeChannels={false} onNewSession={vi.fn()} onCollapse={vi.fn()}/></div></div>);
    const settings=screen.getByRole('button',{name:'设置'});expect(settings.closest('[inert]')).toBeNull();
    fireEvent.click(settings);expect(open).toHaveBeenCalledOnce();expect(screen.getAllByRole('navigation',{name:'应用导航'})).toHaveLength(1);
  });

  it('opens the skills panel from the activity bar below automation', () => {
    const onTogglePanel = vi.fn();

    render(
      <ChatSidebarContent
        showSettingsButton={false}
        onNewSession={vi.fn()}
        onCollapse={vi.fn()}
        onTogglePanel={onTogglePanel}
      />,
    );

    const skillsButton = screen.getByRole('button', { name: 'Skills' });
    expect(skillsButton.previousElementSibling).toHaveAttribute('aria-label','任务计划');

    fireEvent.click(skillsButton);

    expect(onTogglePanel).toHaveBeenCalledWith('skills');
  });
});
