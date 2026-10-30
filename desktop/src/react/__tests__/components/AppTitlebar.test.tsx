// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppTitlebar } from '../../components/app/AppTitlebar';
import { SidebarLayout, toggleSidebar } from '../../components/SidebarLayout';
import { useStore } from '../../stores';

vi.mock('../../components/channels/ChannelTabBar', () => ({
  ChannelTabBar: () => <div data-testid="channel-tabs" />,
}));

vi.mock('../../components/plugin/WidgetButtons', () => ({
  WidgetButtons: () => <div data-testid="widget-buttons" />,
}));

vi.mock('../../components/WindowControls', () => ({
  WindowControls: () => <div data-testid="window-controls" />,
}));

describe('AppTitlebar', () => {
  beforeEach(() => {
    window.t = ((key: string) => key) as typeof window.t;
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('uses the same button to open and close, without opening on hover', () => {
    useStore.setState({ sidebarOpen: false, sidebarAutoCollapsed: false, currentTab: 'chat' });
    function Titlebar() {
      const open = useStore(s => s.sidebarOpen);
      return <AppTitlebar sidebarOpen={open} jianOpen={false} onToggleSidebar={() => toggleSidebar()} onToggleJian={vi.fn()} />;
    }
    render(<Titlebar />);
    const button = screen.getByRole('button', { name: 'sidebar.toggle' });
    fireEvent.mouseEnter(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(localStorage.getItem('hana-sidebar-chat')).toBe('open');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'sidebar.toggle' })).toBe(button);
    expect(localStorage.getItem('hana-sidebar-chat')).toBe('closed');
  });

  it('keeps the sidebar shortcut working after StrictMode effect cleanup', () => {
    Object.defineProperty(window,'innerWidth',{configurable:true,value:1600});
    useStore.setState({jianOpen:true,jianAutoCollapsed:false,layoutDrawer:null});
    render(<React.StrictMode><SidebarLayout /></React.StrictMode>);
    expect(useStore.getState().sidebarOpen).toBe(true);
    fireEvent.keyDown(document, { key: 's', ctrlKey: true, shiftKey: true });
    expect(useStore.getState().sidebarOpen).toBe(false);
  });

  it('does not render the file preview toggle by default on desktop', () => {
    render(
      <AppTitlebar
        sidebarOpen={false}
        jianOpen={false}
        onToggleSidebar={vi.fn()}
        onToggleJian={vi.fn()}
      />,
    );

    expect(screen.queryByTitle('preview.toggle')).not.toBeInTheDocument();
    expect(screen.getByTitle('工作面板')).toBeInTheDocument();
  });

  it('retains the same right-side page switcher when the conversation title disappears', () => {
    const props = { sidebarOpen:true, jianOpen:true, onToggleSidebar:vi.fn(), onToggleJian:vi.fn() };
    const view = render(<AppTitlebar {...props} centerTitle="正在工作"/>);
    const tabs = screen.getByTestId('channel-tabs');
    expect(tabs.closest('.tb-right-group')).not.toBeNull();
    view.rerender(<AppTitlebar {...props}/>);
    expect(screen.getByTestId('channel-tabs')).toBe(tabs);
    expect(tabs.closest('.enigma-window-modes')?.parentElement).toHaveClass('tb-right-group');
    view.rerender(<AppTitlebar {...props} centerTitle="回到聊天"/>);
    expect(screen.getByTestId('channel-tabs')).toBe(tabs);
  });

  it('uses one right-side entry for files, previews, changes and browser',()=>{
    const toggle=vi.fn();render(<AppTitlebar sidebarOpen={false} jianOpen={true} previewOpen showPreviewToggle onToggleSidebar={vi.fn()} onToggleJian={toggle} onTogglePreview={vi.fn()}/>);
    expect(screen.queryByTitle('preview.toggle')).not.toBeInTheDocument();
    const button=screen.getByRole('button',{name:'工作面板'});expect(button).toHaveAttribute('aria-expanded','true');fireEvent.click(button);expect(toggle).toHaveBeenCalledTimes(1);
  });
});
