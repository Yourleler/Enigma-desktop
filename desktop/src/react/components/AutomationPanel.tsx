import {createPortal} from 'react-dom';
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useStore } from '../stores';
import { usePanel } from '../hooks/use-panel';
import {capturePreviewContext,previewConnectionKey} from '../utils/preview-context';
import { hanaFetch } from '../hooks/use-hana-fetch';
import { AgentAvatar, resolveAgentDisplayInfo } from '../utils/agent-display';
import fp from './FloatingPanels.module.css';
import styles from './automation/AutomationPanel.module.css';
import { AutomationCard } from './automation/AutomationCard';
import { AgentTabScroller, type AgentTabScrollerItem } from './automation/AgentTabScroller';
import type { CronJob, ModelOption } from './automation/automation-types';
import { jobAgentId } from './automation/automation-utils';
import type { Agent } from '../types';
import { sessionScopedValue } from '../stores/session-slice';
import { normalizeSessionRouteError } from '../../../../shared/error-user-messages.ts';

const EMPTY_FOLDERS: string[] = [];

function updateBadge(jobs: CronJob[]) {
  useStore.setState({ automationCount: jobs.length });
}

function primaryAgentId(agents: Agent[], currentAgentId: string | null) {
  return currentAgentId || agents.find(a => a.isPrimary)?.id || agents[0]?.id || null;
}

function groupJobs(jobs: CronJob[], currentAgentId: string | null) {
  const groups = new Map<string, CronJob[]>();
  for (const job of jobs) {
    const agentId = jobAgentId(job, currentAgentId) || '__unknown__';
    const list = groups.get(agentId) || [];
    list.push(job);
    groups.set(agentId, list);
  }
  return groups;
}

function agentTabIds(agents: Agent[], groups: Map<string, CronJob[]>) {
  const ids = agents.map(agent => agent.id);
  for (const id of groups.keys()) {
    if (id !== '__unknown__' && !ids.includes(id)) ids.push(id);
  }
  if (groups.has('__unknown__')) ids.push('__unknown__');
  return ids;
}

export function AutomationPanel() {
  const agentAvatarUrl = useStore(s => s.agentAvatarUrl);
  const agentName = useStore(s => s.agentName);
  const agentYuan = useStore(s => s.agentYuan);
  const currentAgentId = useStore(s => s.currentAgentId);
  const currentSessionId = useStore(s => s.currentSessionId);
  const currentSessionPath = useStore(s => s.currentSessionPath);
  const currentSessionProjection = useStore(s => s.currentSessionPath
    ? s.sessions.find(session => session.path === s.currentSessionPath)
    : null);
  const deskBasePath = useStore(s => s.deskBasePath);
  const deskWorkspaceMountId = useStore(s => s.deskWorkspaceMountId);
  const homeFolder = useStore(s => s.homeFolder);
  const currentWorkspaceFolders = useStore(s => s.workspaceFolders);
  const currentAuthorizedFolders = useStore(s => s.currentSessionPath
    ? (sessionScopedValue(s, s.sessionAuthorizedFoldersByPath, s.currentSessionPath) || EMPTY_FOLDERS)
    : EMPTY_FOLDERS);
  const agents = useStore(s => s.agents);
  const addToast = useStore(s => s.addToast);
  const t = window.t ?? ((p: string) => p);

  const connectionKey=useStore(previewConnectionKey);
  const loadSerial=useRef(0),mounted=useRef(true),addingRef=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;loadSerial.current++;};},[]);
  useEffect(()=>{loadSerial.current++;setJobs([]);setAvailableModels([]);setOpenJobs({});setLoadError(null);addingRef.current=false;setAddingManualJob(false);},[connectionKey]);
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(currentAgentId);
  const [openJobs, setOpenJobs] = useState<Record<string, boolean>>({});
  const [addingManualJob, setAddingManualJob] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const serial=++loadSerial.current,owns=capturePreviewContext();
    const current=()=>mounted.current&&owns()&&serial===loadSerial.current;
    try {
      void hanaFetch('/api/models').then(async response=>{
        const data=await response.json();
        if(current())setAvailableModels((data.models||[]).filter((model:ModelOption)=>model.id&&model.provider));
      }).catch(()=>{});
      const cronRes=await hanaFetch('/api/desk/cron',{throwOnHttpError:false});
      if(!current())return;
      if (!cronRes.ok) {
        const body = await cronRes.json().catch(() => ({}));
        const detail = normalizeSessionRouteError(body).message;
        if(!current())return;
        setLoadError(detail || (window.t ?? ((key: string) => key))('error.code.unexpected'));
        return;
      }
      const cronData = await cronRes.json();
      if(!current())return;
      if(!Array.isArray(cronData.jobs))throw Error('Invalid task list');
      const nextJobs = cronData.jobs || [];
      setJobs(nextJobs);
      setLoadError(null);
      updateBadge(nextJobs);
    } catch (err) {
      if(!current())return;
      console.error('[automation] load failed:', err);
      setLoadError((window.t ?? ((key: string) => key))('error.code.unexpected'));
    }
  }, []);

  const { visible, close } = usePanel('automation', loadData, [currentAgentId,connectionKey]);

  const mutateJob = useCallback(async (body:Record<string,unknown>) => {
    const owns=capturePreviewContext();
    const response=await hanaFetch('/api/desk/cron',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),throwOnHttpError:false});
    const data=await response.json().catch(()=>null);
    if(!owns()||!mounted.current)throw Error('连接已经切换，请回到原连接核对任务。');
    if(!response.ok||data?.ok!==true)throw Error(normalizeSessionRouteError(data||{}).message||'操作未确认，请刷新后核对。');
    loadSerial.current++;
    if(body.action==='remove')setJobs(previous=>{const next=previous.filter(job=>job.id!==body.id);updateBadge(next);return next;});
    else if(data.job?.id)setJobs(previous=>{const next=previous.map(job=>job.id===data.job.id?data.job:job);updateBadge(next);return next;});
    else await loadData();
    return data.job as CronJob|undefined;
  },[loadData]);
  const removeJob=useCallback((id:string)=>mutateJob({action:'remove',id}).then(()=>{}),[mutateJob]);
  const updateJob=useCallback((id:string,fields:Record<string,unknown>)=>mutateJob({action:'update',id,...fields}),[mutateJob]);

  const addManualJob = useCallback(async () => {
    if (addingRef.current) return;
    const owns=capturePreviewContext();
    const tr = window.t ?? ((p: string) => p);
    const tabAgentId = selectedAgentId && selectedAgentId !== '__unknown__' ? selectedAgentId : null;
    const actorAgentId = tabAgentId || primaryAgentId(agents, currentAgentId);
    if (!actorAgentId) {
      addToast(tr('automation.agentRequired'), 'error');
      return;
    }
    const actor = agents.find(agent => agent.id === actorAgentId) || null;
    const keepsSourceSession = actorAgentId === currentAgentId && !!currentSessionId;
    const sourceCwd = deskWorkspaceMountId
      ? (currentSessionProjection?.cwd || null)
      : (deskBasePath || homeFolder || null);
    const cwd = keepsSourceSession
      ? sourceCwd
      : (actor?.homeFolder || null);
    const workspaceFolders = keepsSourceSession
      ? (currentWorkspaceFolders.length > 0 ? currentWorkspaceFolders : (cwd ? [cwd] : []))
      : (cwd ? [cwd] : []);
    addingRef.current=true;setAddingManualJob(true);
    try {
      const res = await hanaFetch('/api/desk/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add',
          scheduleType: 'cron',
          schedule: '0 9 * * *',
          label: tr('automation.newAutomation'),
          prompt: '',
          enabled: false,
          actorAgentId,
          executionContext: {
            kind: 'ui_manual',
            cwd,
            workspaceFolders,
            authorizedFolders: keepsSourceSession ? currentAuthorizedFolders : [],
            sourceSessionId: keepsSourceSession ? currentSessionId : null,
            sourceBridgeSessionKey: null,
            sourceSessionPath: keepsSourceSession ? currentSessionPath : null,
            createdByAgentId: actorAgentId,
          },
          createdBy: { kind: 'user' },
        }),
        throwOnHttpError: false,
      });
      if(!owns()||!mounted.current)return;
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const detail = normalizeSessionRouteError(data).message;
        const prefix = tr('automation.createFailed');
        addToast(detail ? `${prefix}: ${detail}` : prefix, 'error');
        return;
      }
      const data = await res.json();
      if(data.ok!==true)throw Error('任务创建未确认');
      await loadData();
      if(!owns()||!mounted.current)return;
      if (data.job?.id) setOpenJobs(prev => ({ ...prev, [data.job.id]: true }));
    } catch {
      if(owns()&&mounted.current)addToast(tr('automation.createFailed'), 'error');
    } finally {
      if(owns()&&mounted.current){addingRef.current=false;setAddingManualJob(false);}
    }
  }, [addToast, addingManualJob, agents, currentAgentId, currentAuthorizedFolders, currentSessionId, currentSessionPath, currentSessionProjection?.cwd, currentWorkspaceFolders, deskBasePath, deskWorkspaceMountId, homeFolder, loadData, selectedAgentId]);

  const groups = useMemo(() => groupJobs(jobs, currentAgentId), [currentAgentId, jobs]);
  const tabs = useMemo(() => agentTabIds(agents, groups), [agents, groups]);
  const activeAgentId = selectedAgentId && tabs.includes(selectedAgentId)
    ? selectedAgentId
    : tabs[0] || null;
  const activeJobs = activeAgentId ? groups.get(activeAgentId) || [] : [];
  const agentTabItems = useMemo<AgentTabScrollerItem[]>(() => tabs.map(agentId => {
    const info = resolveAgentDisplayInfo({
      id: agentId === '__unknown__' ? null : agentId,
      agents,
      fallbackAgentName: agentName,
      fallbackAgentYuan: agentYuan,
      fallbackAgentAvatarUrl: agentAvatarUrl,
    });
    return {
      id: agentId,
      label: info.displayName,
      avatar: <AgentAvatar info={info} className={styles.agentTabAvatar} />,
    };
  }), [agentAvatarUrl, agentName, agentYuan, agents, tabs]);

  useEffect(() => {
    if (activeAgentId && activeAgentId !== selectedAgentId) {
      setSelectedAgentId(activeAgentId);
    }
  }, [activeAgentId, selectedAgentId]);

  if (!visible) return null;

  return createPortal(
    <div className={fp.floatingPanel} id="automationPanel">
      <div className={`${fp.floatingPanelInner} ${styles.panel}`} data-glass-frame="panel" data-native-browser-occluder="">
        <div className={fp.floatingPanelHeader}>
          <h2 className={fp.floatingPanelTitle}>{t('automation.title')}</h2>
          <button className={fp.floatingPanelClose} onClick={close} aria-label="关闭任务计划" data-tooltip="关闭任务计划">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className={fp.floatingPanelBody}>
          <div className={styles.toolbar}>
            <span className={styles.help}>应用运行时自动执行；休眠或退出期间不会执行。</span>
            <button className={styles.textButton} onClick={()=>void loadData()}>刷新列表</button>
            <button className={styles.iconButton} type="button" onClick={addManualJob} title={t('automation.add')} aria-label={t('automation.add')} disabled={addingManualJob} aria-busy={addingManualJob}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>
          <div className={fp.automationList} id="automationList">
            {loadError && (
              <div className={fp.automationEmpty} role="alert">{loadError}</div>
            )}
            {tabs.length === 0 ? (!loadError && (
              <div className={fp.automationEmpty}>{t('automation.empty')}</div>
            )) : (
              <>
                <AgentTabScroller
                  items={agentTabItems}
                  activeId={activeAgentId}
                  ariaLabel={t('automation.agentTabs')}
                  previousLabel={t('automation.previousAgent')}
                  nextLabel={t('automation.nextAgent')}
                  onSelect={setSelectedAgentId}
                />
                <div className={styles.groupList}>
                  {activeJobs.length === 0 ? (!loadError && (
                    <div className={fp.automationEmpty}>{t('automation.emptyForAgent')}</div>
                  )) : activeJobs.map(job => (
                    <AutomationCard
                      key={`${connectionKey}:${job.id}`}
                      job={job}
                      availableModels={availableModels}
                      open={openJobs[job.id] === true}
                      onToggleOpen={() => setOpenJobs(prev => ({ ...prev, [job.id]: prev[job.id] !== true }))}
                      onRemove={removeJob}
                      onUpdate={updateJob}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
