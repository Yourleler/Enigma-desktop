import { AppIcon } from '../../ui/app-icons';
import { ChannelTabBar } from '../channels/ChannelTabBar';
import { WidgetButtons } from '../plugin/WidgetButtons';
import { WindowControls } from '../WindowControls';

interface AppTitlebarProps {
  sidebarOpen: boolean;
  jianOpen: boolean;
  onToggleSidebar: () => void;
  onToggleJian: () => void;
  onNewSession?: () => void;
  previewOpen?: boolean;
  onTogglePreview?: () => void;
  centerTitle?: string | null;
  showNewSessionButton?: boolean;
  showPreviewToggle?: boolean;
  showChannelTabs?: boolean;
  showWidgetButtons?: boolean;
}

export function AppTitlebar({
  sidebarOpen,
  jianOpen,
  onToggleSidebar,
  onToggleJian,
  onNewSession,
  previewOpen = false,
  onTogglePreview,
  centerTitle = null,
  showNewSessionButton = false,
  showPreviewToggle = false,
  showChannelTabs = true,
  showWidgetButtons = true,
}: AppTitlebarProps) {
  const t = window.t ?? ((p: string) => p);

  return (
    <div className="titlebar">
      <div className="tb-left-group">
        <button
          className={`tb-toggle tb-toggle-left${sidebarOpen ? ' active' : ''}`}
          id="tbToggleLeft"
          title={t('sidebar.toggle')}
          aria-label={t('sidebar.toggle')}
          aria-expanded={sidebarOpen}
          aria-controls="sidebar"
          data-tooltip={`${sidebarOpen ? '收起' : '展开'}对话列表 · ⌘ / Ctrl + Shift + S`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onToggleSidebar}
        >
          <AppIcon name="panelLeft" size={17}/>
        </button>
        {showNewSessionButton && onNewSession && (
          <button
            className="tb-toggle tb-new-session"
            type="button"
            title={t('sidebar.newChat')}
            aria-label={t('sidebar.newChat')}
            data-mobile-titlebar-action="new-session"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onNewSession}
          >
            <AppIcon name="add" size={17}/>
          </button>
        )}
      </div>
      {centerTitle && (
        <div className="tb-center-title" aria-label={t('titlebar.currentChatTitle')} title={centerTitle}>
          <span>{centerTitle}</span>
        </div>
      )}
      <div className="tb-right-group">
        {showChannelTabs && <div className="enigma-window-modes"><ChannelTabBar /></div>}
        {showWidgetButtons && <WidgetButtons />}
        {showPreviewToggle && onTogglePreview && (
          <button
            className={`tb-toggle tb-toggle-preview${previewOpen ? ' active' : ''}`}
            id="tbTogglePreview"
            title={t('preview.toggle')}
            aria-label={t('preview.toggle')}
            data-tooltip={previewOpen ? '收起文件预览' : '打开文件与产物预览'}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onTogglePreview}
          >
            <AppIcon name="file" size={17}/>
          </button>
        )}
        <button
          className={`tb-toggle tb-toggle-right${jianOpen ? ' active' : ''}`}
          id="tbToggleRight"
          title={t('sidebar.jian')}
          aria-label={t('sidebar.jian')}
          aria-expanded={jianOpen}
          aria-controls="jianSidebar"
          data-tooltip={jianOpen ? '收起右侧工作区' : '打开右侧工作区，继续查看工程内容'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onToggleJian}
        >
          <AppIcon name="panelRight" size={17}/>
        </button>
      </div>
      <WindowControls />
    </div>
  );
}
