import { EnigmaDesign } from './ui/EnigmaDesign';
/**
 * App.tsx — React 根组件（纯布局编排）
 *
 * 初始化逻辑在 app-init.ts，拖拽/主内容区在 MainContent.tsx。
 * 此文件只负责 titlebar + sidebar + 主区域 + overlays 的组装。
 */

import { useEffect, lazy, Suspense } from 'react';
import { useStore } from './stores';
import type { ActivePanel } from './types';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RegionalErrorBoundary } from './components/RegionalErrorBoundary';

const SkillViewerOverlay = lazy(() => import('./components/SkillViewerOverlay').then(m => ({ default: m.SkillViewerOverlay })));
import { ChannelsPanel } from './components/ChannelsPanel';
import { ChannelCreateOverlay } from './components/channels/ChannelCreateOverlay';
import { SidebarLayout, toggleSidebar } from './components/SidebarLayout';
import { InteractionHints } from './ui/InteractionHints';
import { useSidebarResize } from './hooks/use-sidebar-resize';
import { createNewSession } from './stores/session-actions';
import { toggleJianSidebar } from './stores/desk-actions';
import {togglePreviewPanel} from './stores/preview-actions';
import { ToastContainer } from './components/ToastContainer';
import { InputContextMenu } from './components/InputContextMenu';
import { StatusBar } from './components/StatusBar';
import { SelectionQuoteActionSurface } from './components/selection/SelectionQuoteActionSurface';
import { MediaViewer } from './components/shared/MediaViewer/MediaViewer';
import { SettingsModalShell } from './components/SettingsModalShell';
import { FileHistoryModal } from './components/file-history/FileHistoryModal';
import { initTheme, initDragPrevention } from './bootstrap';
import { initApp } from './app-init';
import { openSettingsModal } from './stores/settings-modal-actions';
import { AppTitlebar } from './components/app/AppTitlebar';
import { ChatSidebar } from './components/app/ChatSidebar';
import { AppPages } from './components/app/AppPages';

declare function t(key: string, vars?: Record<string, string | number>): string;

// ── 主题 + drag 阻止（import 时立即执行） ──
initTheme();
initDragPrevention();

// ── 面板切换 ──

function togglePanel(panel: ActivePanel) {
  const s = useStore.getState();
  s.setActivePanel(s.activePanel === panel ? null : panel);
}

function ConnectionStatus() {
  const connected = useStore(s => s.connected);
  const statusKey = useStore(s => s.statusKey);
  const statusVars = useStore(s => s.statusVars);
  return (
    <div className={`connection-status${connected ? ' connected' : ''}`}>
      <span className="status-dot"></span>
      <span className="status-text">{statusKey ? t(statusKey, statusVars) : ''}</span>
    </div>
  );
}

// ── App 根组件 ──

function App() {
  useSidebarResize();
  // 订阅 locale 变化，驱动整棵树重渲染
  useStore(s => s.locale);
  const sidebarOpen = useStore(s => s.sidebarOpen);
  const jianOpen = useStore(s => s.jianOpen);
  const previewOpen = useStore(s => s.previewOpen);
  const currentTab = useStore(s => s.currentTab);
  const currentTitle = useStore(s => {
    const session = s.sessions.find(item => item.path === s.currentSessionPath);
    return session?.title || session?.firstMessage || 'Enigma';
  });
  const isPluginTab = typeof currentTab === 'string' && currentTab.startsWith('plugin:');

  useEffect(() => {
    console.info('[hana-launch] init-start');
    initApp()
      .then(() => {
        console.info('[hana-launch] init-finished');
      })
      .catch((err: unknown) => {
        console.error('[init] 初始化异常:', err);
        console.error('[hana-launch] init-failed', err);
        console.info('[hana-launch] app-ready', JSON.stringify({ reason: 'init-failed' }));
        window.platform?.appReady?.();
      });
  }, []);

  return (
    <ErrorBoundary>
      {/* Headless behavior components */}
      <SidebarLayout />
      <EnigmaDesign />
      <InteractionHints />
      <ChannelsPanel />

      {/* ── App shell: titlebar 作为独立布局行（flex column 第一行），
           app body 占剩余高度。取代旧的 fixed overlay + 各内容区 padding-top 避让。 ── */}
      <div className="app-shell">
        {/* ── Titlebar ── */}
        <AppTitlebar
          centerTitle={currentTab === 'chat' ? currentTitle : undefined}
          sidebarOpen={sidebarOpen}
          jianOpen={jianOpen}
          previewOpen={previewOpen}
          showPreviewToggle
          onTogglePreview={() => togglePreviewPanel()}
          onToggleSidebar={() => toggleSidebar()}
          onToggleJian={() => toggleJianSidebar()}
        />

        {/* ── App body ── */}
        <div className="app">
          <ChatSidebar
            open={sidebarOpen && !isPluginTab}
            onNewSession={createNewSession}
            onCollapse={() => toggleSidebar()}
            onOpenSettings={() => openSettingsModal()}
            onTogglePanel={togglePanel}
          />

          <RegionalErrorBoundary region="app-pages" resetKeys={[currentTab]}>
            <AppPages />
          </RegionalErrorBoundary>
        </div>
      </div>

      {/* Connection status */}
      <ConnectionStatus />

      {/* Channel create overlay */}
      <ChannelCreateOverlay />

      {/* Skill viewer overlay */}
      <Suspense fallback={null}><SkillViewerOverlay /></Suspense>


      {/* Connection status bar */}
      <StatusBar />

      {/* Leaves shadow overlay */}

      {/* Media viewer overlay */}
      <MediaViewer />

      {/* In-window settings overlay */}
      <SettingsModalShell />

      {/* Workspace file history overlay */}
      <FileHistoryModal />

      {/* Input context menu (cut/copy/paste) */}
      <InputContextMenu />

      {/* Selection quote action */}
      <SelectionQuoteActionSurface />

      {/* Toast notifications */}
      <ToastContainer />

    </ErrorBoundary>
  );
}

export default App;
