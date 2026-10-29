/**
 * SidebarLayout — 侧边栏布局管理 React 组件
 *
 * 管理：sidebar 折叠/展开、responsive 自动收缩、
 * 键盘快捷键、按钮事件绑定。
 * 从 sidebar-shim.ts 的 initSidebar / updateLayout / toggleSidebar 迁移。
 */

import { useEffect } from 'react';
import { useStore } from '../stores';
import { createNewSession } from '../stores/session-actions';
import { closePreview } from '../stores/preview-actions';
import { CHAT_MIN_WIDTH } from '../layout-constants';
import { useEngineering } from '../engineering/state';

function getSidebarWidth(): number {
  return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width')) || 240;
}
function getJianWidth(): number {
  const actual = document.querySelector('.jian-sidebar-inner')?.getBoundingClientRect().width;
  if (actual && actual > 0) return actual;
  return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--jian-sidebar-width')) || 260;
}
function getChannelInspectorWidth(): number {
  return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--channel-inspector-width')) || 280;
}
function getPreviewWidth(): number {
  return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--preview-panel-width')) || 580;
}

// ══════════════════════════════════════════════════════
// 公开函数（bridge compat shim 也会调用）
// ══════════════════════════════════════════════════════

export function updateLayout(): void {
  const s = useStore.getState();
  const currentTab = s.currentTab;
  const w = window.innerWidth;
  const eng = useEngineering.getState();
  // 工程工作台在 <860px 是覆盖式抽屉（见 engineering.css），不参与聊天最小宽度计算；
  // 宽窗时它仍是右栏，正常计入布局。
  const engineeringDrawer = w <= 860
    && !!eng.snapshot?.connected
    && eng.paneOpen
    && !!eng.active;
  const leftW = s.sidebarOpen ? getSidebarWidth() : 0;
  const rightW = (s.jianOpen && !engineeringDrawer) ? getJianWidth() : 0;
  const previewW = currentTab === 'chat' && s.previewOpen ? getPreviewWidth() : 0;
  const channelInspectorW = currentTab === 'channels' && s.currentChannel ? getChannelInspectorWidth() : 0;
  const contentW = w - leftW - rightW - previewW - channelInspectorW;
  // Keep the content the user just opened. On medium windows reclaim the
  // conversation list before squeezing the reading/chat columns.
  const engineeringActive=!!eng.snapshot?.connected&&eng.paneOpen&&!!eng.active&&s.jianOpen;
  const minimumContentWidth=engineeringActive?480:CHAT_MIN_WIDTH;
  if(engineeringActive&&s.sidebarOpen&&contentW<minimumContentWidth){
    useStore.setState({sidebarOpen:false,sidebarAutoCollapsed:true});
    return;
  }

  if (contentW < minimumContentWidth) {
    if (s.jianOpen && !engineeringDrawer) {
      useStore.setState({ jianOpen: false, jianAutoCollapsed: true });

      const newContentW = w - (s.sidebarOpen ? getSidebarWidth() : 0) - previewW - channelInspectorW;
      if (newContentW < minimumContentWidth && s.sidebarOpen) {
        useStore.setState({ sidebarOpen: false, sidebarAutoCollapsed: true });
      }
    } else if (s.sidebarOpen) {
      useStore.setState({ sidebarOpen: false, sidebarAutoCollapsed: true });
    }
  } else {
    if (s.sidebarAutoCollapsed) {
      const neededForLeft = getSidebarWidth();
      if (w - rightW - previewW - channelInspectorW - neededForLeft >= minimumContentWidth) {
        const tab = s.currentTab || 'chat';
        const savedLeft = localStorage.getItem(`hana-sidebar-${tab}`);
        if (savedLeft !== 'closed') {
          useStore.setState({ sidebarOpen: true, sidebarAutoCollapsed: false });
        }
      }
    }
    const s2 = useStore.getState();
    if (s2.jianAutoCollapsed) {
      const leftW2 = s2.sidebarOpen ? getSidebarWidth() : 0;
      const neededForRight = getJianWidth();
      if (w - leftW2 - previewW - channelInspectorW - neededForRight >= minimumContentWidth) {
        const savedRight = localStorage.getItem('hana-jian');
        if (savedRight !== 'closed') {
          useStore.setState({ jianOpen: true, jianAutoCollapsed: false });
        }
      }
    }
  }
}

export function toggleSidebar(forceOpen?: boolean): void {
  const s = useStore.getState();
  const open = forceOpen !== undefined ? forceOpen : !s.sidebarOpen;
  useStore.setState({ sidebarOpen: open, sidebarAutoCollapsed: false });

  const tab = s.currentTab || 'chat';
  localStorage.setItem(`hana-sidebar-${tab}`, open ? 'open' : 'closed');

}

// ══════════════════════════════════════════════════════
// React 组件
// ══════════════════════════════════════════════════════

export function SidebarLayout() {
  useEffect(() => {
    // 迁移 localStorage
    const legacy = localStorage.getItem('hana-sidebar');
    if (legacy && !localStorage.getItem('hana-sidebar-chat')) {
      localStorage.setItem('hana-sidebar-chat', legacy);
    }
    const savedOpen = localStorage.getItem('hana-sidebar-chat');
    const sidebarOpen = savedOpen !== 'closed';

    useStore.setState({
      sidebarOpen,
      sidebarAutoCollapsed: false,
      jianAutoCollapsed: false,
    });

    // Resize
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        updateLayout();
        resizeTimer = null;
      }, 50);
    };
    window.addEventListener('resize', onResize);

    // 键盘快捷键
    const onKeydown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        toggleSidebar();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        createNewSession();
      }
      if (e.key === 'Escape' && useStore.getState().previewOpen) {
        closePreview();
      }
    };
    document.addEventListener('keydown', onKeydown);

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('keydown', onKeydown);
    };
  }, []);

  // 不渲染任何 DOM，只提供行为
  return null;
}
