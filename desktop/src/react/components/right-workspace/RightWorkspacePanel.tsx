import { deskNativeRootDir, loadDeskFiles } from '../../stores/desk-actions';
import { canUseNativeResourcePath } from '../../services/resource-access';
import { resolveServerConnection } from '../../services/server-connection';
import { isWebRuntime } from '../../utils/platform-runtime';
import { useChangesPanel } from '../../stores/changes-panel-store';
import { RepositoryChangesCard, RepositoryChangesPanel } from './RepositoryChangesCard';
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
    <section hidden={!open} className={styles.jianDrawer} data-open={open ? 'true' : 'false'} role="region" aria-label={label}>
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
  const nativeRoot = useStore(s => canUseNativeResourcePath({connection:resolveServerConnection(s)}) ? deskNativeRootDir(s) : null);
  const notesOpen = useStore(s => s.jianDrawerOpen);
  const nativeOpen = !isWebRuntime() && !!nativeRoot && typeof window.platform?.openFolder === 'function';
  const openDirectory = () => {
    if (nativeOpen) { window.platform?.openFolder?.(nativeRoot!); return; }
    useStore.getState().setRightWorkspaceTab('workspace'); void loadDeskFiles('');
  };

  return (
    <>
      <div className={styles.workspaceHeader}>
        <button type="button" className={styles.workspaceTitle} onClick={openDirectory} aria-label={nativeOpen?`在文件管理器打开 ${title}`:`打开目录文件 ${title}`} data-tooltip={`${nativeOpen?'在系统文件管理器中打开':'查看这个目录的文件'}\n${titlePath||''}`}><AppIcon name="project" size={18}/><span>{title}</span></button>
        <div className={styles.workspaceHeaderTools}>
          {titlePath && <details className={styles.workspacePath}>
            <summary>{t('desk.fullPath')}</summary>
            <code>{titlePath}</code>
          </details>}
          <button type="button" className={styles.directoryNotes} aria-label="目录巡检说明" aria-expanded={notesOpen} data-tooltip="给自动巡检填写处理要求；不会自动作为每轮聊天的共享背景" onClick={()=>useStore.getState().setJianDrawerOpen(!notesOpen)}><AppIcon name="file" size={14}/>巡检说明</button>
          <DeskCwdSkillsButton inline />
        </div>
      </div>
      <DeskCwdSkillsPanel inline />
    </>
  );
}

export function RightWorkspacePanel({ compact = false }: { compact?: boolean }) {
  const session = useStore(s => s.currentSessionPath);
  const connection = useStore(s => s.activeServerConnectionId || 'local');
  const changesOpen = useChangesPanel(s => s.open && s.session === session && s.connection === connection);
  const rightWorkspaceTab = useStore(s => s.rightWorkspaceTab);
  const engineeringVisible = useEngineering(s => !!s.snapshot?.connected && s.paneOpen && !!s.active);
  const setRightWorkspaceTab = useStore(s => s.setRightWorkspaceTab);
  const jianView = useStore(s => s.jianView);
  const jianDrawerOpen = useStore(s => s.jianDrawerOpen);
  const t = window.t ?? ((p: string) => p);

  if (changesOpen) return <RepositoryChangesPanel />;

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
        <JianDrawer />
        <RepositoryChangesCard />
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
                data-tooltip={tab.id==='workspace'?'浏览当前工作目录中的全部文件':'本对话上传和生成的文件'}
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
