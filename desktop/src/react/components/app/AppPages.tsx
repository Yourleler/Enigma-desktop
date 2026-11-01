import {useState,type ReactNode} from 'react';
import {Overlay} from '../../ui/Overlay';
import {AppIcon} from '../../ui/app-icons';
import { useStore } from '../../stores';
import { ActivityPanel } from '../ActivityPanel';
import { AutomationPanel } from '../AutomationPanel';
import { BridgePanel } from '../BridgePanel';
import { SkillsPanel } from '../SkillsPanel';
import { PluginPageView } from '../plugin/PluginPageView';
import { ChannelMessages, ChannelMembers, ChannelInput, ChannelReadonly, ChannelAgentActivityPanel, ChannelAgentSettingsPanel, ChannelExportPanel } from '../ChannelsPanel';
import { ChannelHeader } from '../channels/ChannelHeader';
import { MainContent } from '../../MainContent';
import { ChatPage } from './ChatPage';
import { WorkspaceCompanionRail } from './WorkspaceCompanionRail';

const tr = (key: string, vars?: Record<string, string | number>) => window.t?.(key, vars) ?? key;

function ChannelInputArea() {
  const currentChannel = useStore(s => s.currentChannel);
  const isDM = useStore(s => s.channelIsDM);

  if (!currentChannel) return null;

  if (isDM) {
    return (
      <div className="channel-readonly-notice">
        <ChannelReadonly />
      </div>
    );
  }

  return (
    <div className="channel-input-area">
      <ChannelInput />
    </div>
  );
}

function ChannelInspectorShell({ children }: { children: ReactNode }) {
  return (
    <div className="enigma-channel-details-content">
      {children}
    </div>
  );
}

function ChannelInspectorPanel() {
  const channelInfoName = useStore(s => s.channelInfoName);
  const isDM = useStore(s => s.channelIsDM);
  const currentChannel = useStore(s => s.currentChannel);

  if (!currentChannel) return null;

  if (isDM) {
    return (
      <ChannelInspectorShell>
        <div className="channel-info-stack">
          <div className="universal-card">
            <div className="channel-info-section">
              <div className="channel-info-label">{tr('channel.dmLabel')}</div>
              <div className="channel-members-list">
                <ChannelMembers />
              </div>
            </div>
          </div>
          <ChannelAgentSettingsPanel />
          <ChannelAgentActivityPanel />
          <ChannelExportPanel />
        </div>
      </ChannelInspectorShell>
    );
  }

  return (
    <ChannelInspectorShell>
      <div className="channel-info-stack">
        <div className="universal-card">
          <div className="channel-info-section">
            <div className="channel-info-label">{tr('channel.info')}</div>
            <div className="channel-info-name">{channelInfoName}</div>
          </div>
          <div className="channel-info-section">
            <div className="channel-info-label">{tr('channel.members')}</div>
            <div className="channel-members-list">
              <ChannelMembers />
            </div>
          </div>
        </div>
        <ChannelAgentSettingsPanel />
        <ChannelAgentActivityPanel />
        <ChannelExportPanel />
      </div>
    </ChannelInspectorShell>
  );
}

function ChannelPage() {
  const [detailsOpen,setDetailsOpen]=useState(false);
  const currentChannel = useStore(s => s.currentChannel);

  return (
    <div className="channel-page">
      <div className="channel-view active">
        {currentChannel ? (
          <>
            <ChannelHeader onDetails={()=>setDetailsOpen(true)} detailsOpen={detailsOpen}/>
            <div className="channel-messages">
              <ChannelMessages />
            </div>
            <ChannelInputArea />
          </>
        ) : (
          <div className="channel-select-empty">
            {tr('channel.selectHint')}
          </div>
        )}
      </div>
      <Overlay open={detailsOpen&&!!currentChannel} scope="window" onClose={()=>setDetailsOpen(false)} className="enigma-channel-details" contentProps={{role:'dialog','aria-modal':true,'aria-label':'群聊设置与动态'}}>
        <header><strong>群聊设置与动态</strong><button aria-label="关闭群聊设置" onClick={()=>setDetailsOpen(false)}><AppIcon name="close" size={16}/></button></header>
        <ChannelInspectorPanel />
      </Overlay>
    </div>
  );
}

function PluginPage({ pluginId }: { pluginId: string }) {
  return (
    <div className="plugin-page-shell">
      <PluginPageView pluginId={pluginId} />
    </div>
  );
}

export function AppPages() {
  const currentTab = useStore(s => s.currentTab);
  const isPluginTab = typeof currentTab === 'string' && currentTab.startsWith('plugin:');

  return (
    <>
      <MainContent>
        {currentTab === 'chat' && <ChatPage />}
        {currentTab === 'channels' && <ChannelPage />}
        {isPluginTab && <PluginPage pluginId={currentTab.slice(7)} />}
        <ActivityPanel />
        <AutomationPanel />
        <SkillsPanel />
        <BridgePanel />
      </MainContent>

      <WorkspaceCompanionRail />
    </>
  );
}
