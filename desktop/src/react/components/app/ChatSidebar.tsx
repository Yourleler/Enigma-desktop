import './ChatSidebar.css';
import {ArchivedSessionsModal} from '../ArchivedSessionsModal';
import {useState} from 'react';
import { useEngineering } from '../../engineering/state';
import { EngineeringSidebar } from '../../engineering/Engineering';
import type { ActivePanel } from '../../types';
import { useStore } from '../../stores';
import { ChannelListSidebar } from '../channels/ChannelList';
import { RegionalErrorBoundary } from '../RegionalErrorBoundary';
import { SessionList } from '../SessionList';
import { SidebarNoticeSlot } from '../notices/SidebarNoticeSlot';
import {AppIcon} from '../../ui/app-icons';
import {ChannelTabBar} from '../channels/ChannelTabBar';

interface ChatSidebarContentProps {
  showSettingsButton?: boolean;
  showActivityBars?: boolean;
  showCollapseButton?:boolean;
  showNavigationRail?:boolean;
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

export function AppNavigationRail({showSettingsButton=true,showActivityBars=true,onOpenSettings,onTogglePanel,includeChannels=false}:Pick<ChatSidebarContentProps,'showSettingsButton'|'showActivityBars'|'onOpenSettings'|'onTogglePanel'>&{includeChannels?:boolean}) {
  const [archivesOpen,setArchivesOpen]=useState(false);
  const engineering=useEngineering(s=>!!s.snapshot?.connected);
  const t=window.t??((p:string)=>p);
  return <>
      <nav className="enigma-sidebar-rail" aria-label="应用导航">
        {includeChannels?<ChannelTabBar rail/>:<button aria-label="聊天" data-tooltip="返回聊天" onClick={()=>useStore.getState().setActivePanel(null)}><AppIcon name="newChat" size={19}/></button>}
        {showActivityBars&&!engineering&&<>
          <button aria-label={t('sidebar.bridgeShort')} data-tooltip="消息连接" onClick={()=>onTogglePanel?.('bridge')}><AppIcon name="link" size={18}/><BridgeDot/></button>
          <button aria-label={t('sidebar.activity')} data-tooltip="运行记录" onClick={()=>onTogglePanel?.('activity')}><AppIcon name="activity" size={18}/></button>
          <button aria-label={t('automation.title')} data-tooltip="任务计划" onClick={()=>onTogglePanel?.('automation')}><AppIcon name="clock" size={18}/></button>
          <button aria-label={t('skills.panel.title')} data-tooltip="技能" onClick={()=>onTogglePanel?.('skills')}><AppIcon name="skill" size={18}/></button>
        </>}
        <EngineeringSidebar compact/>
        <div className="enigma-sidebar-rail-bottom">
          <button aria-label="已归档对话" data-tooltip="查看与恢复已归档对话" onClick={()=>setArchivesOpen(true)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 7h16v14H4zM3 3h18v4H3zM9 11h6"/></svg></button>
          {showSettingsButton&&<button aria-label={t('settings.title')} data-tooltip={t('settings.title')} onClick={onOpenSettings}><AppIcon name="settings" size={18}/></button>}
        </div>
      </nav>
    {archivesOpen&&<ArchivedSessionsModal open onClose={()=>setArchivesOpen(false)}/>}
  </>;
}

export function ChatSidebarContent({
  showSettingsButton = true,
  showActivityBars = true,
  showCollapseButton = true,
  showNavigationRail = true,
  onNewSession,
  onCollapse,
  onOpenSettings,
  onTogglePanel,
  region = 'sidebar',
}: ChatSidebarContentProps) {
  const currentAgentId = useStore(s => s.currentAgentId);
  const t = window.t ?? ((p: string) => p);

  return (
    <div className="enigma-sidebar-layout">
      {showNavigationRail&&<AppNavigationRail showSettingsButton={showSettingsButton} showActivityBars={showActivityBars} onOpenSettings={onOpenSettings} onTogglePanel={onTogglePanel}/>}
      <div className="enigma-sidebar-list-column">
        <div className="sidebar-header"><span className="sidebar-title">Enigma</span><div className="sidebar-header-actions"><button className="sidebar-action-btn" aria-label="搜索对话历史" data-tooltip="搜索历史对话 · 标题、正文与高级筛选" onClick={()=>window.dispatchEvent(new Event('enigma-open-history-search'))}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/></svg></button>{showCollapseButton&&<button className="sidebar-action-btn" title={t('sidebar.collapse')} onClick={onCollapse}><AppIcon name="chevronLeft" size={18}/></button>}</div></div>
        <button className="enigma-new-chat" data-tooltip="新建独立对话 · ⌘ / Ctrl + N" onClick={onNewSession}><AppIcon name="newChat" size={17}/>{t('sidebar.newChat')}</button>
        <div className="session-list enigma-compact-session-list"><RegionalErrorBoundary region={region} resetKeys={[currentAgentId]}><SessionList/></RegionalErrorBoundary><SidebarNoticeSlot/></div>
      </div>

    </div>
  );
}

export function ChatSidebar({
  open,
  includeChannels = true,
  ...contentProps
}: ChatSidebarProps) {
  const currentTab = useStore(s => s.currentTab);
  const autoCollapsed = useStore(s => s.sidebarAutoCollapsed);
  const layoutDrawer = useStore(s => s.layoutDrawer);

  return (
    <aside className={`sidebar${open ? '' : ' collapsed'}`} id="sidebar" data-layout-managed="" data-auto-collapsed={autoCollapsed || undefined} inert={!open || layoutDrawer === 'workspace'} aria-hidden={!open}>
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
