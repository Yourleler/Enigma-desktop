import { EngineeringPanel } from '../../engineering/Engineering';
import { useEngineering } from '../../engineering/state';
import { useId } from 'react';
import { GlassSelection } from '../../ui/GlassSelection';
import { AppIcon } from '../../ui/app-icons';
import { useStore } from '../../stores';
import type { RightWorkspaceTab } from '../../types';
import { DeskSection } from '../DeskSection';
import { DeskCwdSkillsButton, DeskCwdSkillsPanel } from '../desk/DeskCwdSkills';
import { JianEditor } from '../desk/DeskEditor';
import { PluginWidgetView } from '../plugin/PluginWidgetView';
import { SessionRegistryFilesPanel } from './SessionRegistryFilesPanel';
import { SessionTodoCard } from './SessionTodoCard';
import { WorkflowCard } from './WorkflowCard';
import { AgentActivityCard } from './AgentActivityCard';
import { SessionStatusCard } from './SessionStatusCard';
import styles from './RightWorkspacePanel.module.css';
import { workspaceDisplayName } from '../../../../../shared/workspace-history.ts';

interface RightWorkspaceTabDef {
  id: RightWorkspaceTab;
  labelKey: string;
}

const BASE_TABS: RightWorkspaceTabDef[] = [
  { id: 'session-files', labelKey: 'rightWorkspace.tabs.sessionFiles' },
  { id: 'workspace', labelKey: 'rightWorkspace.tabs.workspace' },
];

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {open ? <polyline points="6 9 12 15 18 9" /> : <polyline points="18 15 12 9 6 15" />}
    </svg>
  );
}

function JianDrawer() {
  const open = useStore(s => s.jianDrawerOpen);
  const setOpen = useStore(s => s.setJianDrawerOpen);
  const t = window.t ?? ((p: string) => p);
  const label = t('desk.jianLabel');
  const bodyId = useId();
  return (
    <section className={styles.jianDrawer} data-open={open ? 'true' : 'false'} role="region" aria-label={label}>
      <button className={styles.jianHeader} type="button" aria-expanded={open} aria-controls={bodyId}
        aria-label={open ? t('rightWorkspace.jian.collapse') : t('rightWorkspace.jian.expand')}
        onClick={() => setOpen(!open)}>
        <span className={styles.jianTitle}>{label}</span>
        <Chevron open={open} />
      </button>
      <div id={bodyId} className={styles.jianBody} inert={!open} aria-hidden={!open}>
        <p className={styles.jianHint}>{t('desk.jianHint')}</p>
        <JianEditor showHeader={false} />
      </div>
    </section>
  );
}

function TabContent({ activeTab }: { activeTab: RightWorkspaceTab }) {
  if (activeTab === 'session-files') return <SessionRegistryFilesPanel />;
  return <DeskSection framed={false} showHeader={false} rightWorkspaceLayout />;
}

function WorkspaceHeader() {
  const deskBasePath = useStore(s => s.deskBasePath);
  const deskWorkspaceMountId = useStore(s => s.deskWorkspaceMountId);
  const deskWorkspaceLabel = useStore(s => s.deskWorkspaceLabel);
  const selectedFolder = useStore(s => s.selectedFolder);
  const homeFolder = useStore(s => s.homeFolder);
  const t = window.t ?? ((p: string) => p);
  const title = deskWorkspaceMountId
    ? (deskWorkspaceLabel || deskWorkspaceMountId)
    : workspaceDisplayName(deskBasePath || selectedFolder || homeFolder, t('desk.title'));
  const titlePath = deskWorkspaceMountId ? title : (deskBasePath || selectedFolder || homeFolder || undefined);

  return (
    <>
      <div className={styles.workspaceHeader}>
        <div className={styles.workspaceTitle} title={titlePath}><AppIcon name="project" size={18}/><span>{title}</span></div>
        <div className={styles.workspaceHeaderTools}>
          {titlePath && <details className={styles.workspacePath}>
            <summary>{t('desk.fullPath')}</summary>
            <code>{titlePath}</code>
          </details>}
          <DeskCwdSkillsButton inline />
        </div>
      </div>
      <DeskCwdSkillsPanel inline />
    </>
  );
}

export function RightWorkspacePanel({ compact = false }: { compact?: boolean }) {
  const rightWorkspaceTab = useStore(s => s.rightWorkspaceTab);
  const engineeringVisible = useEngineering(s => !!s.snapshot?.connected && s.paneOpen && !!s.active);
  const setRightWorkspaceTab = useStore(s => s.setRightWorkspaceTab);
  const jianView = useStore(s => s.jianView);
  const jianDrawerOpen = useStore(s => s.jianDrawerOpen);
  const t = window.t ?? ((p: string) => p);

  if (engineeringVisible) return <EngineeringPanel />;

  if (jianView.startsWith('widget:')) {
    return (
      <div className={styles.shell}>
        <PluginWidgetView pluginId={jianView.slice(7)} />
      </div>
    );
  }

  const activeTab = BASE_TABS.some(tab => tab.id === rightWorkspaceTab)
    ? rightWorkspaceTab
    : 'workspace';

  return (
    <div className={`${styles.shell} enigma-workspace-shell`} data-liquid="sidebar">
      {!compact && <SessionTodoCard />}
      <div
        className={`universal-card ${styles.workspaceCard}`}
        data-right-workspace-card=""
        data-jian-open={jianDrawerOpen ? 'true' : 'false'}
      >
        <WorkspaceHeader />
        <div className={styles.tabs} role="tablist" aria-label={t('rightWorkspace.tabs.label')} data-glass-segmented="">
          <GlassSelection selection={activeTab}/>
          {BASE_TABS.map(tab => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                className={`${styles.tab}${selected ? ` ${styles.tabActive}` : ''}`}
                role="tab"
                aria-selected={selected}
                onClick={() => setRightWorkspaceTab(tab.id)}
              >
                {t(tab.labelKey)}
              </button>
            );
          })}
        </div>
        <div className={styles.content} role="tabpanel">
          <TabContent activeTab={activeTab} />
        </div>
        <JianDrawer />
      </div>
      {!compact && (
        <>
          <WorkflowCard />
          <AgentActivityCard />
          <SessionStatusCard />
        </>
      )}
    </div>
  );
}
