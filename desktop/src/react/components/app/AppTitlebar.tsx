import { AppearanceMenu } from '../../engineering/AppearanceMenu';
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
          <PanelToggleIcon side="left" open={sidebarOpen}/>
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
        <AppearanceMenu compact/>
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
          data-tooltip={jianOpen ? '收起文件与变更' : '打开目录文件、对话附件和代码变更'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onToggleJian}
        >
          <PanelToggleIcon side="right" open={jianOpen}/>
        </button>
      </div>
      <WindowControls />
    </div>
  );
}

function PanelToggleIcon({side,open}:{side:'left'|'right';open:boolean}) {
  return <svg className="enigma-panel-toggle-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <path d={side==='left'?'M9 3v18':'M15 3v18'}/>
    <path className="enigma-panel-toggle-fill" d={side==='left'?'M4 4h4v16H4z':'M16 4h4v16h-4z'} fill="currentColor" stroke="none" opacity={open ? 0.22 : 0}/>
    <path className="enigma-panel-toggle-arrow" d={side==='left'?'m13 9 3 3-3 3':'m11 9-3 3 3 3'} style={{transformOrigin:side==='left'?'14.5px 12px':'9.5px 12px',transform:`rotate(${open?180:0}deg)`}}/>
  </svg>;
}
