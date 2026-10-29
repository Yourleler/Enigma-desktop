import { useEngineering } from '../../engineering/state';
import { EngineeringSidebar } from '../../engineering/Engineering';
import type { ActivePanel } from '../../types';
import { useStore } from '../../stores';
import { ChannelListSidebar } from '../channels/ChannelList';
import { RegionalErrorBoundary } from '../RegionalErrorBoundary';
import { SessionList } from '../SessionList';
import { SidebarNoticeSlot } from '../notices/SidebarNoticeSlot';
import {AppIcon} from '../../ui/app-icons';

interface ChatSidebarContentProps {
  showSettingsButton?: boolean;
  showActivityBars?: boolean;
  showCollapseButton?:boolean;
  onNewSession: () => void;
  onCollapse: () => void;
  onOpenSettings?: () => void;
  onTogglePanel?: (panel: ActivePanel) => void;
  region?: string;
}

interface ChatSidebarProps extends ChatSidebarContentProps {
  open: boolean;
  includeChannels?: boolean;
}

function AutomationBadge() {
  const count = useStore(s => s.automationCount);
  return <span className="automation-count-badge">{count > 0 ? String(count) : ''}</span>;
}

function BridgeDot() {
  const connected = useStore(s => s.bridgeDotConnected);
  return <span className={`sidebar-bridge-dot${connected ? ' connected' : ''}`}></span>;
}

export function ChatSidebarContent({
  showSettingsButton = true,
  showActivityBars = true,
  showCollapseButton = true,
  onNewSession,
  onCollapse,
  onOpenSettings,
  onTogglePanel,
  region = 'sidebar',
}: ChatSidebarContentProps) {
  const currentAgentId = useStore(s => s.currentAgentId);
  const engineering = useEngineering(s => !!s.snapshot?.connected);
  const t = window.t ?? ((p: string) => p);

  return (
    <>
      <div className="sidebar-header">
        <span className="sidebar-title">Enigma</span>
        <div className="sidebar-header-actions">
          {showSettingsButton && (
            <button className="sidebar-action-btn" title={t('settings.title')} onClick={onOpenSettings}>
              <AppIcon name="settings" size={18}/>
            </button>
          )}
          {showCollapseButton&&<button className="sidebar-action-btn" title={t('sidebar.collapse')} onClick={onCollapse}>
            <AppIcon name="chevronLeft" size={18}/>
          </button>}
        </div>
      </div>

      <button className="enigma-new-chat" data-tooltip="开始一个新的工作对话 · ⌘ / Ctrl + N" onClick={onNewSession}>
        <AppIcon name="newChat" size={18}/>
        {t('sidebar.newChat')}
      </button>

      {showActivityBars && !engineering && (
        <>
          <button className="sidebar-activity-bar sidebar-bridge-card" onClick={() => onTogglePanel?.('bridge')}>
            <AppIcon name="link" size={18}/>
            <span>{t('sidebar.bridgeShort')}</span>
            <BridgeDot />
          </button>
          <button className="sidebar-activity-bar" onClick={() => onTogglePanel?.('activity')}>
            <AppIcon name="activity" size={18}/>
            <span>{t('sidebar.activity')}</span>
          </button>
          <button className="sidebar-activity-bar" onClick={() => onTogglePanel?.('automation')}>
            <AppIcon name="clock" size={18}/>
            <span>{t('automation.title')}</span>
            <AutomationBadge />
          </button>
          <button className="sidebar-activity-bar" onClick={() => onTogglePanel?.('skills')}>
            <AppIcon name="skill" size={18}/>
            <span>{t('skills.panel.title')}</span>
          </button>
        </>
      )}

      <EngineeringSidebar />
      <div className="session-list">
        <RegionalErrorBoundary region={region} resetKeys={[currentAgentId]}>
          <SessionList />
        </RegionalErrorBoundary>
        <SidebarNoticeSlot />
      </div>
    </>
  );
}

export function ChatSidebar({
  open,
  includeChannels = true,
  ...contentProps
}: ChatSidebarProps) {
  const currentTab = useStore(s => s.currentTab);

  return (
    <aside className={`sidebar${open ? '' : ' collapsed'}`} id="sidebar" inert={!open} aria-hidden={!open}>
      <div className="sidebar-inner" data-liquid="sidebar">
        <div className={`sidebar-chat-content${currentTab === 'chat' ? '' : ' hidden'}`}>
          <ChatSidebarContent {...contentProps} showCollapseButton={false}/>
        </div>

        {includeChannels && (
          <div className={`sidebar-channel-content${currentTab === 'channels' ? '' : ' hidden'}`}>
            <ChannelListSidebar showCollapseButton={false} />
          </div>
        )}
      </div>
      <div className="resize-handle resize-handle-right" id="sidebarResizeHandle"></div>
    </aside>
  );
}
