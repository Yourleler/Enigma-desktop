import { GlassSelection } from '../ui/GlassSelection';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useStore } from '../stores';
import {capturePreviewContext,previewConnectionKey} from '../utils/preview-context';
import {normalizeSessionRouteError} from '../../../../shared/error-user-messages.ts';
import type {ActivityTranscriptMessage} from '../../../../shared/activity-transcript.ts';
import { usePanel } from '../hooks/use-panel';
import { hanaFetch } from '../hooks/use-hana-fetch';
import { fetchConfig, invalidateConfigCache } from '../hooks/use-config';
import { loadSessions, switchSession } from '../stores/session-actions';
import { formatSessionDate, injectCopyButtons, parseMoodFromContent } from '../utils/format';
import { formatElapsed } from '../utils/format-duration';
import { AgentAvatar, resolveAgentDisplayInfo } from '../utils/agent-display';
import { getMd } from '../utils/markdown';
import { useMermaidDiagrams } from '../hooks/use-mermaid-diagrams';
import { Collapse } from '../ui';
import fp from './FloatingPanels.module.css';
import chatStyles from './chat/Chat.module.css';
import { ChatResourceCard, type ChatResourceCardStatusTone } from './chat/ChatResourceCard';
import automationStyles from './automation/AutomationPanel.module.css';
import { AgentTabScroller, type AgentTabScrollerItem } from './automation/AgentTabScroller';
import type { Activity, Agent } from '../types';

interface ActivityItem extends Activity {
  summary?: string;
  label?: string;
  status?: string;
  agentId?: string;
  agentName?: string;
  sessionFile?: string;
  promotedSessionFile?: string;
  startedAt?: number;
  finishedAt?: number;
}

type DetailMessage=ActivityTranscriptMessage;

const FLEX_COLUMN_STYLE: React.CSSProperties = { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 };
const ACTIVITY_BUCKETS = ['automation', 'patrol', 'other'] as const;
type ActivityBucket = typeof ACTIVITY_BUCKETS[number];

function activityBucket(type: string): ActivityBucket {
  if (type === 'heartbeat') return 'patrol';
  if (type === 'cron') return 'automation';
  return 'other';
}

function bucketLabel(bucket: ActivityBucket, t: (k: string) => string) {
  if (bucket === 'automation') return t('activity.automationRuns');
  if (bucket === 'patrol') return t('activity.patrolRuns');
  return t('activity.otherRuns');
}

function activityAgentId(activity: ActivityItem, fallback: string | null) {
  return activity.agentId || fallback || '__unknown__';
}

function groupActivities(activities: ActivityItem[], currentAgentId: string | null) {
  const grouped = new Map<string, Map<ActivityBucket, ActivityItem[]>>();
  for (const activity of activities) {
    const agentId = activityAgentId(activity, currentAgentId);
    const bucket = activityBucket(activity.type);
    const byBucket = grouped.get(agentId) || new Map<ActivityBucket, ActivityItem[]>();
    const list = byBucket.get(bucket) || [];
    list.push(activity);
    byBucket.set(bucket, list);
    grouped.set(agentId, byBucket);
  }
  return grouped;
}

function activityAgentTabIds(agents: Agent[], grouped: Map<string, Map<ActivityBucket, ActivityItem[]>>) {
  const ids = agents.map(agent => agent.id);
  for (const id of grouped.keys()) {
    if (id !== '__unknown__' && !ids.includes(id)) ids.push(id);
  }
  if (grouped.has('__unknown__')) ids.push('__unknown__');
  return ids;
}

function firstNonEmptyBucket(buckets: Map<ActivityBucket, ActivityItem[]> | undefined): ActivityBucket {
  return ACTIVITY_BUCKETS.find(bucket => (buckets?.get(bucket)?.length || 0) > 0) || 'automation';
}

export function ActivityPanel() {
  const activities = useStore(s => s.activities) as ActivityItem[];
  const agents = useStore(s => s.agents);
  const currentAgentId = useStore(s => s.currentAgentId);
  const agentName = useStore(s => s.agentName);
  const setActivities = useStore(s => s.setActivities);

  const connectionKey=useStore(previewConnectionKey);
  const [hbEnabled, setHbEnabled] = useState<boolean|null>(null);
  const [loadError,setLoadError]=useState(''),[heartbeatError,setHeartbeatError]=useState(''),[heartbeatBusy,setHeartbeatBusy]=useState(false);
  const selectedBuckets=useRef<Record<string,ActivityBucket>>({}),loadSerial=useRef(0),hbRevision=useRef(0),hbBusy=useRef(false),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;loadSerial.current++;};},[]);
  const previousConnection=useRef(connectionKey);
  useEffect(()=>{if(previousConnection.current===connectionKey)return;previousConnection.current=connectionKey;loadSerial.current++;setActivities([]);setHbEnabled(null);setLoadError('');setHeartbeatError('');hbBusy.current=false;setHeartbeatBusy(false);selectedBuckets.current={};},[connectionKey,setActivities]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(currentAgentId);
  const [selectedBucket, setSelectedBucket] = useState<ActivityBucket>('automation');
  const t = window.t ?? ((p: string) => p);
  const groupedActivities = useMemo(() => groupActivities(activities, currentAgentId), [activities, currentAgentId]);
  const agentTabs = useMemo(() => activityAgentTabIds(agents, groupedActivities), [agents, groupedActivities]);
  const activeAgentId = selectedAgentId && agentTabs.includes(selectedAgentId)
    ? selectedAgentId
    : currentAgentId && agentTabs.includes(currentAgentId)
      ? currentAgentId
      : agentTabs[0] || null;
  const activeBuckets = activeAgentId ? groupedActivities.get(activeAgentId) : undefined;
  const activeActivities = activeBuckets?.get(selectedBucket) || [];
  const agentTabItems = useMemo<AgentTabScrollerItem[]>(() => agentTabs.map(agentId => {
    const buckets = groupedActivities.get(agentId);
    const firstActivity = ACTIVITY_BUCKETS
      .flatMap(bucket => buckets?.get(bucket) || [])
      .find(Boolean);
    const info = resolveAgentDisplayInfo({
      id: agentId === '__unknown__' ? null : agentId,
      agents,
      fallbackAgentName: firstActivity?.agentName || agentName,
    });
    return {
      id: agentId,
      label: info.displayName,
      avatar: <AgentAvatar info={info} className={automationStyles.agentTabAvatar} />,
    };
  }), [agentName, agentTabs, agents, groupedActivities]);

  useEffect(() => {
    if (activeAgentId && activeAgentId !== selectedAgentId) {
      setSelectedAgentId(activeAgentId);
    }
  }, [activeAgentId, selectedAgentId]);

  useEffect(() => {
    setSelectedBucket(activeAgentId&&selectedBuckets.current[activeAgentId]||firstNonEmptyBucket(activeBuckets));
  }, [activeAgentId, activeBuckets]);

  const loadData=useCallback(()=>{
    const serial=++loadSerial.current,configRevision=hbRevision.current,owns=capturePreviewContext(),before=useStore.getState().activities;
    const current=()=>owns()&&mounted.current&&serial===loadSerial.current;
    void hanaFetch('/api/desk/activities',{throwOnHttpError:false}).then(async response=>{
      const data=await response.json();if(!current())return;
      if(response.ok===false||!Array.isArray(data.activities))throw Error(normalizeSessionRouteError(data).message||'运行记录暂不可读取。');
      const changed=useStore.getState().activities.filter(row=>!before.includes(row));
      const ids=new Set(changed.map(row=>row.agentId+':'+row.id));
      setActivities([...changed,...data.activities.filter((row:Activity)=>!ids.has(row.agentId+':'+row.id))]);setLoadError('');
    }).catch(()=>{if(current())setLoadError('运行记录加载失败，已有内容已保留。');});
    void fetchConfig({cacheKey:connectionKey,force:true}).then(data=>{if(current()&&!hbBusy.current&&configRevision===hbRevision.current)setHbEnabled(data.desk?.heartbeat_master!==false);}).catch(()=>{if(current())setHeartbeatError('巡检设置暂不可读取，请刷新后重试。');});
  },[setActivities,connectionKey]);
  const {visible,close:closePanel}=usePanel('activity',loadData,[currentAgentId,connectionKey]);
  const close=useCallback(()=>closePanel(),[closePanel]);
  const toggleHeartbeat=useCallback(async()=>{
    if(hbBusy.current||hbEnabled===null)return;
    const owns=capturePreviewContext(),next=!hbEnabled;hbRevision.current++;hbBusy.current=true;setHeartbeatBusy(true);setHeartbeatError('');
    try{
      const response=await hanaFetch('/api/config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({desk:{heartbeat_master:next}}),throwOnHttpError:false});
      const data=await response.json();if(!owns()||!mounted.current)return;
      if(response.ok===false||data.error)throw Error('未能保存巡检设置，请重试。');
      setHbEnabled(next);invalidateConfigCache();
    }catch{if(owns()&&mounted.current)setHeartbeatError('巡检开关未修改，请检查连接后重试。');}
    finally{if(owns()&&mounted.current){hbBusy.current=false;setHeartbeatBusy(false);}}
  },[hbEnabled]);

  const promoteActivity=useCallback(async(activity:ActivityItem)=>{
    const owns=capturePreviewContext(),origin=useStore.getState().currentSessionPath;
    const response=await hanaFetch('/api/desk/activities/'+encodeURIComponent(activity.id)+'/promote?agentId='+encodeURIComponent(activity.agentId||currentAgentId||''),{method:'POST',throwOnHttpError:false});
    const data=await response.json();if(!owns()||!mounted.current)return;
    if(response.ok===false||data.error||!data.sessionPath)throw Error(normalizeSessionRouteError(data).message||'转为对话未确认。');
    if(data.activity)useStore.setState(state=>({activities:state.activities.map(row=>row.id===activity.id&&row.agentId===activity.agentId?{...row,...data.activity,agentId:activity.agentId}:row)}));
    await loadSessions();
    if(!owns()||!mounted.current)return;
    if(useStore.getState().currentSessionPath!==origin&&useStore.getState().currentSessionPath!==data.sessionPath)return;
    await switchSession(data.sessionPath);
    if(owns()&&useStore.getState().currentSessionPath===data.sessionPath)closePanel();
    else if(owns())throw Error('对话已经保留，打开未完成。请在对话列表中重试。');
  },[currentAgentId,closePanel]);

  if (!visible) return null;

  return (
    <div className={fp.floatingPanel} id="activityPanel">
      <div className={`${fp.floatingPanelInner} ${automationStyles.panel}`} data-glass-frame="panel">
        <div id="activityListView" style={FLEX_COLUMN_STYLE}>
          <div className={fp.floatingPanelHeader}>
              <h2 className={fp.floatingPanelTitle}>运行记录</h2>
              <div className={fp.activityHbToggle}>
                <span className="hana-toggle-label">{t('activity.heartbeat')}</span>
                <button
                  className={'hana-toggle' + (hbEnabled ? ' on' : '')}
                  role="switch" aria-checked={hbEnabled===true} aria-label="自动巡检" disabled={hbEnabled===null||heartbeatBusy} data-tooltip="自动巡检开关；不影响计划任务"
                  onClick={toggleHeartbeat}
                />
              </div>
            <button className={fp.floatingPanelClose} onClick={close} aria-label="关闭运行记录" data-tooltip="关闭运行记录">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className={fp.floatingPanelBody}>
            <div className={automationStyles.toolbar}><button className={automationStyles.textButton} onClick={loadData}>刷新记录</button></div>
            {(loadError||heartbeatError)&&<p role="alert" className={automationStyles.feedback}>{loadError||heartbeatError}</p>}
            <div className={fp.activityCards} id="activityCards">
              {agentTabs.length === 0 ? (
                !loadError&&<div className={fp.activityEmpty}>{t('activity.empty')}</div>
              ) : (
                <>
                  <AgentTabScroller
                    items={agentTabItems}
                    activeId={activeAgentId}
                    ariaLabel={t('activity.agentTabs')}
                    previousLabel={t('activity.previousAgent')}
                    nextLabel={t('activity.nextAgent')}
                    onSelect={agentId => {
                      setSelectedAgentId(agentId);
                      setSelectedBucket(firstNonEmptyBucket(groupedActivities.get(agentId)));
                    }}
                  />
                  <div className={automationStyles.categoryTabs} role="tablist" aria-label={t('activity.categoryTabs')} data-glass-segmented=""><GlassSelection selection={selectedBucket}/>
                    {ACTIVITY_BUCKETS.map(bucket => {
                      const count = activeBuckets?.get(bucket)?.length || 0;
                      const active = bucket === selectedBucket;
                      return (
                        <button
                          key={bucket}
                          className={automationStyles.categoryTab}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          data-active={active}
                          onClick={() => {if(activeAgentId)selectedBuckets.current[activeAgentId]=bucket;setSelectedBucket(bucket);}}
                        >
                          <span>{bucketLabel(bucket, t)}</span>
                          <span className={automationStyles.categoryTabCount}>{count}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className={automationStyles.groupList}>
                    {activeActivities.length === 0 ? (
                      !loadError&&<div className={fp.activityEmpty}>{t('activity.emptyForCategory')}</div>
                    ) : activeActivities.map(a => (
                      <ActivityCard
                        key={`${connectionKey}:${a.agentId}:${a.id}`}
                        activity={a}
                        agents={agents}
                        currentAgentId={currentAgentId}
                        agentName={agentName}
                        onPromote={promoteActivity}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActivityCard({
  activity: a,
  agents,
  currentAgentId,
  agentName,
  onPromote,
}: {
  activity: ActivityItem;
  agents: Agent[];
  currentAgentId: string | null;
  agentName: string;
  onPromote: (activity: ActivityItem) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [promoting,setPromoting]=useState(false),[promoteError,setPromoteError]=useState('');
  const promoteBusy=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const [messages, setMessages] = useState<DetailMessage[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const agentId = a.agentId || currentAgentId;
  const displayInfo = resolveAgentDisplayInfo({
    id: agentId,
    agents,
    fallbackAgentName: a.agentName || agentName,
  });

  const t = window.t ?? ((p: string) => p);
  const typeText = a.type === 'heartbeat' ? t('activity.heartbeat')
    : a.type === 'subagent' ? t('activity.subagent')
    : (a.label || t('activity.cron'));
  const canUseSession=!!(a.sessionFile||a.promotedSessionFile);
  const promoteLabel=a.promotedSessionFile?'打开对话':t('activity.promote');
  const promote=async()=>{if(promoteBusy.current)return;promoteBusy.current=true;setPromoting(true);setPromoteError('');try{await onPromote(a);}catch(error){if(alive.current)setPromoteError(error instanceof Error?error.message:'转为对话失败，请重试。');}finally{promoteBusy.current=false;if(alive.current)setPromoting(false);}};

  let durationText = '';
  if (a.finishedAt && a.startedAt) {
    durationText = t('activity.duration', { text: formatElapsed(a.finishedAt - a.startedAt) });
  }
  const timeText = a.startedAt ? formatSessionDate(new Date(a.startedAt).toISOString()) : '';
  const subtitle = a.summary || (a.type === 'heartbeat' ? t('activity.patrolDone') : t('activity.cronDone'));
  const statusLabel = a.status === 'error'
    ? t('activity.error')
    : a.status === 'running'
      ? t('common.executing')
      : durationText || timeText;
  const statusTone: ChatResourceCardStatusTone = a.status === 'error'
    ? 'danger'
    : a.status === 'running'
      ? 'accent'
      : 'muted';

  useEffect(() => {
    if (!open || !canUseSession || messages !== null || loadError) return;
    let cancelled = false;
    const owns=capturePreviewContext();
    setLoading(true);
    setLoadError(false);

    void hanaFetch('/api/desk/activities/'+encodeURIComponent(a.id)+'/session?agentId='+encodeURIComponent(agentId||''))
      .then(res => res.json())
      .then(data => {
        if (cancelled||!owns()) return;
        if (data.error) throw new Error(data.error);
        setMessages(Array.isArray(data.messages) ? data.messages : []);
      })
      .catch(() => {
        if (!cancelled&&owns()) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled&&owns()) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [a.id, canUseSession, loadError, messages, open]);

  useEffect(()=>{setMessages(null);setLoadError(false);},[a.id,a.sessionFile,a.promotedSessionFile,a.finishedAt]);

  const toggleOpen = () => {
    if (!canUseSession) return;
    if (!open && loadError) setLoadError(false);
    setOpen(v => !v);
  };

  return (
    <div className={fp.activitySessionItem} data-open={open || undefined}>
      <ChatResourceCard
        className={`${fp.activitySessionCard}${a.status === 'error' ? ` ${fp.activitySessionCardError}` : ''}`}
        icon={<AgentAvatar info={displayInfo} className={fp.activitySessionAvatar} alt={displayInfo.displayName} />}
        title={displayInfo.displayName}
        titleMeta={`· ${typeText}`}
        subtitle={subtitle}
        statusLabel={statusLabel}
        statusTone={statusTone}
        actionSlot={(
          <>
            <button
              type="button"
              className={fp.activitySessionAction}
              data-active={open || undefined}
              onClick={toggleOpen}
              disabled={!canUseSession}
              title={open ? t('activity.collapse') : t('activity.expand')}
              aria-label={open ? t('activity.collapse') : t('activity.expand')}
              aria-expanded={open}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <button
              type="button"
              className={fp.activitySessionAction}
              onClick={()=>void promote()}
              disabled={!canUseSession||a.status==='running'||promoting}
              title={a.status==='running'?'任务仍在运行，结束后可转为对话':promoteLabel}
              aria-label={promoting?'正在打开对话…':promoteLabel}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="17 11 12 6 7 11" />
                <line x1="12" y1="6" x2="12" y2="18" />
              </svg>
            </button>
          </>
        )}
      />
      {promoteError&&<p role="alert" className={automationStyles.feedback}>{promoteError}</p>}
      <Collapse open={open}>
        <ActivityInlineTranscript
          messages={messages || []}
          loading={loading}
          error={loadError}
          onRetry={()=>setLoadError(false)}
        />
      </Collapse>
    </div>
  );
}

function ActivityInlineTranscript({ messages, loading, error,onRetry }: {
  messages: DetailMessage[];
  loading: boolean;
  error: boolean;
  onRetry:()=>void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const t = window.t ?? ((p: string) => p);
  const mdInstance = getMd();

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.querySelectorAll<HTMLElement>('.md-content').forEach(node=>injectCopyButtons(node));
    }
  }, [messages]);
  useMermaidDiagrams(bodyRef, [messages]);

  if (loading) {
    return <div className={fp.activityInlineTranscript}>{t('activity.loadingSession')}</div>;
  }
  if (error) {
    return <div role="alert" className={fp.activityInlineTranscript}>{t('activity.sessionLoadFailed')}<button onClick={onRetry}>重新读取过程</button></div>;
  }
  if (messages.length === 0) {
    return <div className={fp.activityInlineTranscript}>{t('activity.noSessionMessages')}</div>;
  }

  return (
    <div className={fp.activityInlineTranscript} ref={bodyRef}>
      {messages.map((m, i) => {
        if(m.role==='tool')return <details key={'tool-'+i} className={automationStyles.activityTool}>
          <summary>{m.phase==='call'?'调用':'结果'} · {m.toolName}{m.phase==='result'?m.status==='failed'?' · 失败':m.status==='succeeded'?' · 完成':' · 未知':''}{m.timestamp?<time>{new Date(m.timestamp).toLocaleTimeString(undefined,{hour12:false})}</time>:null}</summary>
          <pre>{m.content}</pre>{m.truncated&&<p>内容较长，此处显示前 12,000 字符；可打开对话查看完整记录。</p>}
        </details>;
        if (m.role === 'assistant') {
          const { mood, text } = parseMoodFromContent(m.content);
          return (
            <div key={`msg-${i}`} className={`${fp.activityDetailMsg} ${fp.activityDetailMsgAssistant}`}>
              <div className={fp.activityDetailBubble}>
                {mood && (
                  <details className={chatStyles.moodWrapper}>
                    <summary className={chatStyles.moodSummary}>{t('mood.label')}</summary>
                    <div className={chatStyles.moodBlock}>{mood}</div>
                  </details>
                )}
                {text && (
                  <div
                    className="md-content"
                    dangerouslySetInnerHTML={{
                      __html: mdInstance
                        ? mdInstance.render(text.replace(/<tool_code>[\s\S]*?<\/tool_code>\s*/g, ''))
                        : text,
                    }}
                  />
                )}
              </div>
            </div>
          );
        }
        return (
          <div key={`msg-${i}`} className={`${fp.activityDetailMsg} ${fp.activityDetailMsgUser}`}>
            <div className={fp.activityDetailBubble}>{m.content}</div>
          </div>
        );
      })}
    </div>
  );
}
