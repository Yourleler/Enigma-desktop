import { useEffect, useMemo, useState, useRef } from 'react';
import {
  Collapse,
  ProviderGroupHeader,
  SelectWidget,
  selectWidgetStyles,
  type SelectOption,
} from '@/ui';
import { useStore } from '../../stores';
import { resolveAgentDisplayInfo } from '../../utils/agent-display';
import type { CronJob, ModelOption } from './automation-types';
import {
  automationExecutorLabel,
  jobAgentId,
  modelOptionsForJob,
  modelSelectValue,
  modelValueFromSelect,
} from './automation-utils';
import {AutomationRunHistory} from './AutomationRunHistory';
import { ScheduleEditor } from './ScheduleEditor';
import {
  intervalMinutesForApi,
  validateScheduleDraft,
  scheduleDraftFromStored,
  schedulePreviewFromDraft,
  storedScheduleFromDraft,
  type ScheduleDraft,
} from './schedule-draft';
import styles from './AutomationPanel.module.css';

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={styles.chevron} data-open={open} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function jobTitle(job: CronJob) {
  return job.label || job.prompt?.slice(0, 40) || job.id;
}

export function AutomationCard({
  job,
  availableModels,
  open,
  onToggleOpen,
  onRemove,
  onUpdate,
}: {
  job: CronJob;
  availableModels: ModelOption[];
  open: boolean;
  onToggleOpen: () => void;
  onToggleEnabled?: (id: string) => void;
  onRemove: (id: string) => Promise<void> | void;
  onUpdate: (id: string, fields: Record<string, unknown>) => Promise<CronJob | undefined | void> | void;
}) {
  const t = window.t ?? ((p: string) => p);
  const agents = useStore(s => s.agents);
  const currentAgentId = useStore(s => s.currentAgentId);
  const fallbackAgentName = useStore(s => s.agentName) || 'Enigma';
  const fallbackAgentYuan = useStore(s => s.agentYuan) || 'hanako';
  const baseline=useRef(job),busyRef=useRef(false),mounted=useRef(true);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const [label, setLabel] = useState(jobTitle(job));
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft>(() => scheduleDraftFromStored(job.type, job.schedule));
  const [scheduleDirty, setScheduleDirty] = useState(false);
  const [prompt, setPrompt] = useState(job.prompt || '');
  const [model, setModel] = useState(modelSelectValue(job.model));
  const isAgentSession = !job.executor || job.executor.kind === 'agent_session';
  const executorLabel = automationExecutorLabel(job);
  const modelOptions = useMemo(() => modelOptionsForJob(job, availableModels), [availableModels, job]);
  const agentInfo = resolveAgentDisplayInfo({
    id: jobAgentId(job, currentAgentId),
    agents,
    fallbackAgentName,
    fallbackAgentYuan,
  });

  const fingerprint=(value:CronJob)=>JSON.stringify([value.label,value.prompt,value.model,value.type,value.schedule,value.configRevision]);
  const jobFingerprint=fingerprint(job);
  useEffect(()=>setNotice(''),[job.lastRunAt]);
  const dirty=label!==jobTitle(baseline.current)||scheduleDirty||prompt!==(baseline.current.prompt||'')||model!==modelSelectValue(baseline.current.model);
  const dirtyRef=useRef(dirty);dirtyRef.current=dirty;
  const reset=(value:CronJob)=>{
    baseline.current=value;setLabel(jobTitle(value));setScheduleDraft(scheduleDraftFromStored(value.type,value.schedule));setScheduleDirty(false);setPrompt(value.prompt||'');setModel(modelSelectValue(value.model));setError('');
  };
  useEffect(()=>{if(!dirtyRef.current&&!busyRef.current)reset(job);},[job.id,jobFingerprint]);

  const updateScheduleDraft = (draft: ScheduleDraft) => {
    setScheduleDraft(draft);
    setScheduleDirty(true);
  };

  const updateFields = () => {
    const fields: Record<string, unknown> = {};
    if (label !== jobTitle(baseline.current)) fields.label = label;
    if (scheduleDirty) {
      validateScheduleDraft(scheduleDraft);
      const nextSchedule = storedScheduleFromDraft(scheduleDraft);
      fields.type = nextSchedule.type;
      fields.schedule = nextSchedule.type === 'every'
        ? intervalMinutesForApi(scheduleDraft) || nextSchedule.schedule
        : nextSchedule.schedule;
    }
    if (prompt !== (baseline.current.prompt || '')) fields.prompt = prompt;
    if (model !== modelSelectValue(baseline.current.model)) fields.model = modelValueFromSelect(model);
    return fields;
  };

  const execute=async(action:()=>Promise<CronJob|undefined|void>|void,success:string,resetDraft=false)=>{
    if(busyRef.current)return;
    busyRef.current=true;setBusy(true);setError('');setNotice('');
    try{
      const saved=await action();
      if(!mounted.current)return;
      if(resetDraft)reset(saved||{...job,label,prompt,model:modelValueFromSelect(model),...storedScheduleFromDraft(scheduleDraft)});
      setNotice(success);
    }catch(err){if(mounted.current)setError(err instanceof Error?err.message:'操作未确认，请重试。');}
    finally{busyRef.current=false;if(mounted.current)setBusy(false);}
  };
  const withRevision=(fields:Record<string,unknown>)=>({...fields,...(baseline.current.configRevision?{expectedConfigRevision:baseline.current.configRevision}:{})});
  const save=()=>execute(()=>onUpdate(job.id,withRevision(updateFields())),'已保存',true);
  const toggleEnabled=()=>{
    if(!job.enabled&&isAgentSession&&!prompt.trim()){setError(t('automation.promptRequired'));return;}
    return execute(()=>onUpdate(job.id,{...(!job.enabled?withRevision(updateFields()):{expectedConfigRevision:job.configRevision}),enabled:!job.enabled}),job.enabled?'已暂停；已开始的任务仍会继续。':'已开启',!job.enabled);
  };


  return (
    <div className={styles.card} aria-busy={busy}>
      <div className={styles.row}>
      <button type="button" className={`hana-toggle${job.enabled?' on':''}`} role="switch" aria-checked={job.enabled} aria-label={job.enabled?t('automation.disable'):t('automation.enable')} data-tooltip={job.enabled?t('automation.disable'):t('automation.enable')} disabled={busy} onClick={()=>void toggleEnabled()}/>
      <button type="button" className={styles.rowSummary} onClick={onToggleOpen} aria-expanded={open}>
        <span className={styles.rowMain}>
          <span className={styles.title} title={jobTitle(job)}>{jobTitle(job)}</span>
          <span className={styles.subline}>
            <span className={styles.meta}>{schedulePreviewFromDraft(scheduleDraftFromStored(job.type, job.schedule))}</span>
            {job.enabled && job.nextRunAt ? <span className={styles.meta}>下次 {new Date(job.nextRunAt).toLocaleString(undefined, { hour12: false })}</span> : null}
            <span className={styles.badge}>{executorLabel}</span>
          </span>
        </span>
        <span className={styles.meta}>{job.enabled ? t('common.on') : t('common.off')}</span>
        <Chevron open={open} />
      </button>
      </div>
      {error&&<div className={styles.feedback} role="alert">{error}</div>}
      {notice&&<div className={styles.feedback} role="status">{notice}</div>}
      <Collapse open={open}>
        <div className={styles.details}>
          {dirty && jobFingerprint!==fingerprint(baseline.current) && <div className={styles.feedback} role="status">任务配置已更新，你的草稿已保留。<button onClick={()=>reset(job)}>放弃草稿并读取最新配置</button></div>}
          <fieldset className={styles.form} disabled={busy}>
          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span>{t('automation.field.label')}</span>
              <input value={label} onChange={e => setLabel(e.target.value)} spellCheck={false} />
            </label>
          </div>
          <ScheduleEditor draft={scheduleDraft} onChange={updateScheduleDraft} />
          {isAgentSession ? (
            <label className={styles.field}>
              <span>{t('automation.field.prompt')}</span>
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder={t('automation.promptPlaceholder', { agent: agentInfo.displayName })}
                spellCheck={false}
              />
            </label>
          ) : null}
          {isAgentSession && availableModels.length > 0 ? (
            <label className={styles.field}>
              <span>{t('rightWorkspace.session.model')}</span>
              <SelectWidget
                options={[
                  { value: '', label: t('automation.defaultModel') } as SelectOption,
                  ...modelOptions.map((option): SelectOption => ({
                    value: `${option.provider}/${option.id}`,
                    label: option.name || option.id,
                    group: option.provider,
                  })),
                ]}
                value={model}
                onChange={setModel}
                renderGroupHeader={provider => <ProviderGroupHeader provider={provider} />}
                popupClassName={selectWidgetStyles.providerInset}
              />
            </label>
          ) : null}
          <div className={styles.actions}>
            <button className={styles.textButton} type="button" disabled={!dirty||busy} onClick={()=>void save()}>{busy?'正在处理…':t('common.confirm')}</button>
            <button className={`${styles.textButton} ${styles.dangerButton}`} type="button" disabled={busy} onClick={()=>void execute(()=>onRemove(job.id),'已删除')}>{t('automation.delete')}</button>
          </div>
          </fieldset>
          <AutomationRunHistory job={job} open={open}/>
        </div>
      </Collapse>
    </div>
  );
}
