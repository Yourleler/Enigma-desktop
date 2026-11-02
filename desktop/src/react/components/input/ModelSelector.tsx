import { useCallback, useMemo, useState, useEffect } from 'react';
import { useStore } from '../../stores';
import { sessionScopedValue } from '../../stores/session-slice';
import { hanaFetch } from '../../hooks/use-hana-fetch';
import { useI18n } from '../../hooks/use-i18n';
import type { Model } from '../../types';
import type { SessionModel } from '../../stores/chat-types';
import { SelectWidget, ProviderIcon, ProviderGroupHeader, selectWidgetStyles, type SelectOption } from '@/ui';
import styles from './InputArea.module.css';
import {modelSelectionKey,receiveModelSelection,useModelSelectionStore} from '../../stores/model-selection-store';
import {AppIcon} from '../../ui/app-icons';
import {useComposerModelPolicy} from '../../engineering/use-model-policy';
import {ModelPolicyDialog} from '../../engineering/ModelPolicy';
import {modelForPhase} from '../../../../../plugins/enigma/model-policy';

export function ModelSelector({ models, sessionModel: suppliedSessionModel, isStreaming = false }: {
  models: Model[];
  sessionModel?: SessionModel;
  isStreaming?: boolean;
}) {
  const { t } = useI18n();
  const [switching, setLoading] = useState(false);
  const path=useStore(s=>s.currentSessionPath)||'',connection=useStore(s=>s.activeServerConnectionId);
  const {policy,error:policyError}=useComposerModelPolicy();
  const [rolesOpen,setRolesOpen]=useState(false);
  const pendingRole=!path&&policy?modelForPhase(policy):undefined;
  const sessionModel=suppliedSessionModel||(pendingRole?{...pendingRole,name:models.find(m=>m.id===pendingRole.id&&m.provider===pendingRole.provider)?.name||pendingRole.id}:undefined);
  const configuredRoles=policy?(policy.mode==='delegated'?[['主 Agent',policy.execution],['子 Agent',policy.worker]]:policy.mode==='single'?[]:[['规划',policy.planning],['执行',policy.execution],['复核',policy.review],['子 Agent',policy.worker]]).filter((entry:any)=>entry[1]).map(([name,role]:any)=>`${name}：${models.find(m=>m.id===role.id&&m.provider===role.provider)?.name||role.id}`):[];
  const [cancelError,setCancelError]=useState('');
  const selection=useModelSelectionStore(s=>s.items[modelSelectionKey(connection,path)]);
  const loading=switching;
  useEffect(()=>setCancelError(''),[path,connection,selection?.revision,selection?.state]);
  const cancelSelection=async()=>{
    const selectedPath=path,selectedConnection=connection;setCancelError('');
    try{const response=await hanaFetch('/api/models/selection/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionPath:selectedPath}),throwOnHttpError:false});const data=await response.json();if(!response.ok)throw new Error(data.error||'取消未成功，请重试');receiveModelSelection(selectedConnection,selectedPath,data.selection);}
    catch(error){if(useStore.getState().currentSessionPath===selectedPath&&useStore.getState().activeServerConnectionId===selectedConnection)setCancelError(error instanceof Error?error.message:String(error));}
  };
  useEffect(()=>{
    if(!path)return;let active=true;
    const read=()=>hanaFetch(`/api/models/selection?sessionPath=${encodeURIComponent(path)}`).then(r=>r.json()).then(data=>{if(active)receiveModelSelection(connection,path,data.selection||null);}).catch(()=>{});
    void read();const timer=isStreaming?setInterval(()=>{if(!document.hidden)void read();},1500):null;
    return()=>{active=false;if(timer)clearInterval(timer);};
  },[path,connection,isStreaming]);

  const matchedSessionModel = sessionModel
    ? models.find(m => m.id === sessionModel.id && m.provider === sessionModel.provider)
    : undefined;
  const current = sessionModel
    ? (matchedSessionModel ? { ...matchedSessionModel, ...sessionModel } : sessionModel)
    : models.find(m => m.isCurrent);
  const inferredUnavailable = !!(
    sessionModel?.id
    && sessionModel.provider
    && models.length > 0
    && !matchedSessionModel
  );
  const sessionModelUnavailable = sessionModel?.available === false || inferredUnavailable;
  const label = (() => {

    if (sessionModelUnavailable) {
      if (sessionModel?.unavailableReason === 'model_removed') return t('model.removed') || '...';
      if (sessionModel?.unavailableReason === 'provider_not_configured') {
        return t('model.providerNotConfigured') || '...';
      }
      return t('model.unavailable') || '...';
    }
    if (current?.name) return current.name;
    if (models.length > 0) return t('model.notSelected') || t('model.unknown') || '...';
    return t('model.noneConfigured') || t('model.unknown') || '...';
  })();

  const switchModel = useCallback(async (modelId: string, provider?: string) => {
    try {
      const state = useStore.getState();
      const { currentSessionPath, pendingNewSession, chatSessions, sessionModelsByPath } = state;
      const sessionHasMessages = !!(currentSessionPath && sessionScopedValue(state, chatSessions, currentSessionPath)?.items?.length);

      if (currentSessionPath && !pendingNewSession) {
        // Same-model guard：严格复合键比较。sm 缺 provider 时视为不可比，走 global 当前。
        const sm = sessionScopedValue(state, sessionModelsByPath, currentSessionPath);
        const useSession = !!(sm?.id && sm?.provider);
        const cur = useSession ? sm : models.find(m => m.isCurrent);
        // A blocked historical model must be explicitly re-selected after its
        // provider/model becomes usable again. Do not let the same-model guard
        // turn that recovery action into a no-op.
        if (cur && modelId === cur.id && provider === cur.provider && sm?.available !== false && selection?.state!=='pending') return;

        // Per-session switch
        setLoading(true);
        useStore.getState().setModelSwitching(true);
        const res = await hanaFetch('/api/models/switch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionPath: currentSessionPath, modelId, provider }),
          throwOnHttpError: false,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'switch failed');

        receiveModelSelection(state.activeServerConnectionId,currentSessionPath,data.selection||null);
        if (data.model) {
          useStore.getState().updateSessionModel(currentSessionPath, {
            ...data.model,
            available: true,
            unavailableReason: null,
          });
        }
        if (data.thinkingLevel) {
          useStore.getState().setThinkingLevel(data.thinkingLevel);
        }

        if (data.adaptations?.length) {
          const msgs: Record<string, string> = {
            compacted: t('model.adaptation.compacted'),
            truncated: t('model.adaptation.truncated'),
          };
          const text = data.adaptations.map((a: string) => msgs[a] || a).join('；');
          useStore.getState().addToast(text, 'info');
        }

        setLoading(false);
        useStore.getState().setModelSwitching(false);
      } else {
        // New session path: persist the model selection and mirror its thinking default into the draft.
        const draftPolicy=state.pendingNewSessionModelPolicy===undefined&&state.pendingDraftId
          ? (await(await hanaFetch('/api/enigma/model-policy-default')).json()).policy||null
          : state.pendingNewSessionModelPolicy;
        const setRes = await hanaFetch('/api/models/set', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modelId, provider }),
        });
        const setData = await setRes.json().catch(() => ({}));
        const latest=useStore.getState();
        if(state.pendingDraftId&&latest.pendingDraftId===state.pendingDraftId&&latest.activeServerConnectionId===state.activeServerConnectionId&&latest.pendingNewSessionModelPolicy===state.pendingNewSessionModelPolicy){
          const role=draftPolicy?.phase==='planning'?'planning':draftPolicy?.phase==='review'?'review':'execution';
          useStore.setState({pendingNewSessionModelPolicy:draftPolicy?{...draftPolicy,[role]:{...draftPolicy[role],id:modelId,provider}}:null});
        }
        if (setData.thinkingLevel) {
          useStore.getState().setThinkingLevel(setData.thinkingLevel);
          useStore.getState().setPendingNewSessionThinkingLevel(setData.thinkingLevel);
        }
        if (currentSessionPath && !pendingNewSession) {
          const { createNewSession } = await import('../../stores/session-actions');
          await createNewSession();
        }
        const res = await hanaFetch('/api/models');
        const data = await res.json();
        useStore.setState({ models: data.models || [] });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      {
        console.error('[model] switch failed:', err);
        useStore.getState().addToast(message || t('model.switchFailed'), 'error');
      }
      setLoading(false);
      useStore.getState().setModelSwitching(false);
    }
  }, [models, t,selection?.state]);

  // 按 provider 分组
  const grouped = useMemo(() => {
    const groups: Record<string, typeof models> = {};
    for (const m of models) {
      const key = m.provider || '';
      if (!groups[key]) groups[key] = [];
      groups[key].push(m);
    }
    // 只补入仍可用的当前模型；失效模型只作为状态展示，不塞回可选列表。
    const currentCanBeSelected = !sessionModel || !!matchedSessionModel;
    if (current && currentCanBeSelected && !sessionModelUnavailable && !models.find(m => m.id === current.id && m.provider === current.provider)) {
      const key = current.provider || '';
      if (!groups[key]) groups[key] = [];
      groups[key].unshift(current as typeof models[0]);
    }
    return groups;
  }, [models, current, sessionModel, matchedSessionModel, sessionModelUnavailable]);

  const groupKeys = Object.keys(grouped);
  const hasMultipleProviders = groupKeys.length > 1 || (groupKeys.length === 1 && groupKeys[0] !== '');

  const valueOf = (m: { id: string; provider?: string }) => `${m.provider || ''}/${m.id}`;

  const options: SelectOption[] = useMemo(() => {
    return groupKeys.flatMap(provider =>
      grouped[provider].map(m => ({
        value: valueOf(m),
        label: m.name,
        group: hasMultipleProviders ? (provider || '—') : undefined,
      })),
    );
  }, [grouped, groupKeys, hasMultipleProviders]);

  // Keep the unavailable historical identity visible in the trigger, but leave
  // the select value empty so choosing the same provider/id is a real action.
  const currentValue = current && !sessionModelUnavailable ? valueOf(current) : '';

  const handleSelect = useCallback((val: string) => {
    const all = groupKeys.flatMap(p => grouped[p]);
    const m = all.find(mm => valueOf(mm) === val);
    if (m) switchModel(m.id, m.provider);
  }, [grouped, groupKeys, switchModel]);

  return (
    <div className={styles['model-choice']}>
    {configuredRoles.length>0&&<button type="button" className={styles['model-role-summary']} aria-label={`模型分工：${configuredRoles.join('；')}`} data-tooltip={configuredRoles.join('\n')} onClick={()=>setRolesOpen(true)}>{policy?.mode==='delegated'?'主 / 子':`${configuredRoles.length} 个角色`}</button>}
    <SelectWidget
      className={styles['model-selector']}
      options={options}
      value={currentValue}
      onChange={handleSelect}
      disabled={loading}
      placement="top"
      align="end"
      offset={4}
      popupMinWidth={180}
      popupClassName={selectWidgetStyles.providerInset}
      triggerBare
      triggerClassName={`${styles['model-pill']}${loading ? ` ${styles['model-pill-disabled']}` : ''}`}
      renderTrigger={() => (
        <>
          {current?.provider && (
            <ProviderIcon provider={current.provider} className={styles['model-provider-icon']} />
          )}
          <span className={styles['model-pill-label']}>{configuredRoles.length>0&&<span>{policy?.mode==='delegated'?'主 Agent':policy?.phase==='planning'?'规划':policy?.phase==='review'?'复核':'执行'} · </span>}{label}</span>{loading&&<span className="enigma-model-loading" aria-label="正在记录模型选择"/>}
        </>
      )}
      renderGroupHeader={(g) => <ProviderGroupHeader provider={g} />}
    />
    {selection?.state==='pending'&&<span className={styles['model-selection-note']} role="status"><AppIcon name="arrowEnter" size={13}/>下一请求：{models.find(m=>m.id===selection.id&&m.provider===selection.provider)?.name||selection.id}<button type="button" aria-label="取消待切换模型" onClick={()=>void cancelSelection()}>×</button></span>}
    {cancelError&&<span className={styles['model-selection-note']} role="alert">{cancelError}</span>}
    {policyError&&<span className={styles['model-selection-note']} role="alert">{policyError}</span>}
    {selection?.state==='failed'&&<span className={styles['model-selection-note']} role="alert" title={selection.error}>模型未切换：{selection.error||'请重新选择'}</span>}
    {rolesOpen&&<ModelPolicyDialog close={()=>setRolesOpen(false)}/>}
    </div>
  );
}
