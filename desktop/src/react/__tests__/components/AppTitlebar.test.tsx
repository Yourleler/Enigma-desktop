// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppTitlebar } from '../../components/app/AppTitlebar';
import { SidebarLayout, toggleSidebar, updateLayout } from '../../components/SidebarLayout';
import { useStore } from '../../stores';
import {dockScope,expandDock,useRightDock} from '../../stores/right-dock-store';

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
    const view = render(<AppTitlebar {...props} showChannelTabs centerTitle="正在工作"/>);
    const tabs = screen.getByTestId('channel-tabs');
    expect(tabs.closest('.tb-right-group')).not.toBeNull();
    view.rerender(<AppTitlebar {...props} showChannelTabs/>);
    expect(screen.getByTestId('channel-tabs')).toBe(tabs);
    expect(tabs.closest('.enigma-window-modes')?.parentElement).toHaveClass('tb-right-group');
    view.rerender(<AppTitlebar {...props} showChannelTabs centerTitle="回到聊天"/>);
    expect(screen.getByTestId('channel-tabs')).toBe(tabs);
  });

  it('keeps both panels open at 1280px even when measured animation frames are narrow',()=>{
    document.documentElement.removeAttribute('style');localStorage.clear();
    Object.defineProperty(window,'innerWidth',{configurable:true,value:1280});
    useRightDock.setState({views:{}});useStore.setState({sidebarOpen:false,sidebarAutoCollapsed:false,jianOpen:true,jianAutoCollapsed:false,layoutDrawer:null,layoutPriority:'workspace',currentTab:'chat'});
    document.body.innerHTML='<div class="app"><aside class="sidebar"><div class="sidebar-inner"></div></aside><main class="main-content"></main><aside class="jian-sidebar"><div class="jian-sidebar-inner"></div></aside></div>';
    const inner=document.querySelector('.sidebar-inner')!;
    toggleSidebar(true);
    for(const width of [0,42,115,201,240,238,240]){
      vi.spyOn(inner,'getBoundingClientRect').mockReturnValue({width} as DOMRect);
      updateLayout();
      expect(useStore.getState()).toMatchObject({sidebarOpen:true,jianOpen:true,layoutDrawer:null});
      expect(document.documentElement.style.getPropertyValue('--right-dock-width')).toBe('520px');
    }
    document.body.innerHTML='';
  });

  it('allows opening navigation while the reading panel is expanded',()=>{
    Object.defineProperty(window,'innerWidth',{configurable:true,value:1512});
    useStore.setState({sidebarOpen:false,sidebarAutoCollapsed:false,jianOpen:true,jianAutoCollapsed:false,layoutDrawer:null,layoutPriority:'workspace',currentTab:'chat'});
    expandDock(dockScope(useStore.getState()),true);toggleSidebar(true);
    expect(useStore.getState()).toMatchObject({sidebarOpen:true,jianOpen:true,layoutDrawer:null});
    expandDock(dockScope(useStore.getState()),false);updateLayout();
  });

  it('uses one right-side entry for files, previews, changes and browser',()=>{
    const toggle=vi.fn();render(<AppTitlebar sidebarOpen={false} jianOpen={true} previewOpen showPreviewToggle onToggleSidebar={vi.fn()} onToggleJian={toggle} onTogglePreview={vi.fn()}/>);
    expect(screen.queryByTitle('preview.toggle')).not.toBeInTheDocument();
    const button=screen.getByRole('button',{name:'工作面板'});expect(button).toHaveAttribute('aria-expanded','true');fireEvent.click(button);expect(toggle).toHaveBeenCalledTimes(1);
  });
});
