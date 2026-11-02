import { useEffect, useState, useId } from 'react';
import { SurfaceModal } from './SurfaceMenu';
import { FormSelect } from './FormSelect';
import styles from './FormLayout.module.css';
import { useStore } from '../stores';
import { hanaFetch } from '../hooks/use-hana-fetch';
import { shouldShowThinkingControl } from '../utils/model-thinking';
import { useEngineering, engineeringRequest, refreshEngineering } from './state';
import {validateModelPolicy} from '../../../../plugins/enigma/model-policy';

type Role = 'execution' | 'planning' | 'review' | 'worker';
type Target = 'current' | 'future' | 'both';
type Draft = { mode: string; execution: string; planning: string; review: string; worker:string; workerEnabled:boolean; thinking: Record<Role,string>; budget: string };
const key = (model: any) => model ? `${model.provider}/${model.id}` : '';
const roles:Role[]=['planning','execution','review','worker'];
const roleNames = {planning:'规划',execution:'执行',review:'复核',worker:'子 Agent'};
const thinkingChoices = [{value:'off',label:'关闭'}, {value:'low',label:'低'}, {value:'medium',label:'中'}, {value:'high',label:'高'}, {value:'max',label:'最高'}];
function draftFrom(policy: any, initial: any): Draft {
  return {mode:policy?.mode || 'single', execution:key(policy?.execution || initial), planning:key(policy?.planning || initial), review:key(policy?.review || initial),worker:key(policy?.worker || initial),workerEnabled:!!policy?.worker,
    thinking:{execution:policy?.execution?.thinking || 'medium',planning:policy?.planning?.thinking || 'medium',review:policy?.review?.thinking || 'medium',worker:policy?.worker?.thinking||'medium'},
    budget:policy?.maxRequests == null ? '' : String(policy.maxRequests)};
}
export function ModelPolicyDialog({close}:{close:()=>void}) {
  const models=useStore(s=>s.models), state=useEngineering();
  const currentPath=useStore(s=>s.currentSessionPath)||'',connection=useStore(s=>s.activeServerConnectionId)||'local';
  const pendingId=useStore(s=>s.pendingDraftId),pending=useStore(s=>s.pendingNewSession);
  const budgetHelp=useId();
  const [targetSession]=useState(currentPath),[targetDraft]=useState(pendingId),[targetConnection]=useState(connection);
  const [canCurrent]=useState(!!currentPath||pending);
  const pendingTarget=!targetSession&&canCurrent;
  const currentLabel=pendingTarget?'本次新对话':'仅当前对话';
  const [applyTo,setApplyTo]=useState<Target>(canCurrent?'current':'future');
  const initial=models.find(model=>model.isCurrent) || models[0];
  const [drafts,setDrafts]=useState(()=>({current:draftFrom(pendingTarget?useStore.getState().pendingNewSessionModelPolicy:state.snapshot?.modelPolicy,initial),future:draftFrom(null,initial)}));
  const [loaded,setLoaded]=useState({current:pendingTarget&&useStore.getState().pendingNewSessionModelPolicy!==undefined,future:false});
  const [loading,setLoading]=useState(false),[loadError,setLoadError]=useState(''),[retry,setRetry]=useState(0);
  const [error,setError]=useState(''),[saving,setSaving]=useState(false);
  const scope=applyTo==='future'?'future':'current',draft=drafts[scope];
  const sourceChanged=connection!==targetConnection || applyTo!=='future'&&(currentPath!==targetSession||pendingTarget&&pendingId!==targetDraft);
  const patch=(values:Partial<Draft>)=>setDrafts(d=>({...d,[scope]:{...d[scope],...values}}));
  const labelFor=(role:Role)=>role==='execution'&&draft.mode==='delegated'?'主 Agent':roleNames[role];

  useEffect(()=>{
    if(loaded[scope]||sourceChanged)return;
    let active=true;const controller=new AbortController();setLoading(true);setLoadError('');
    const url=scope==='future'||pendingTarget?'/api/enigma/model-policy-default':`/api/enigma/model-policy?sessionPath=${encodeURIComponent(targetSession)}`;
    void hanaFetch(url,{signal:controller.signal,throwOnHttpError:false}).then(async response=>{
      const result=await response.json();if(!response.ok||result.error)throw new Error(result.error||'读取模型分工失败');
      if(!active||(useStore.getState().activeServerConnectionId||'local')!==targetConnection)return;
      const available=useStore.getState().models;
      setDrafts(previous=>({...previous,[scope]:draftFrom(result.policy,available.find(model=>model.isCurrent)||available[0])}));
      setLoaded(previous=>({...previous,[scope]:true}));
    }).catch(reason=>{if(active&&!controller.signal.aborted)setLoadError(reason instanceof Error?reason.message:String(reason));})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;controller.abort();};
  },[scope,loaded[scope],sourceChanged,targetConnection,targetSession,pendingTarget,retry]);

  useEffect(()=>{
    if(!initial)return;
    setDrafts(previous=>{
      const next={...previous};
      for(const name of ['current','future'] as const)for(const role of roles)if(!next[name][role])next[name]={...next[name],[role]:key(initial)};
      return next;
    });
  },[initial?.provider,initial?.id]);
  const optionsForThinking=(name:Role)=>{
    const model=models.find(model=>key(model)===draft[name]);
    if(!shouldShowThinkingControl(model,models))return [thinkingChoices[0]];
    const declared=model?.thinkingLevels;
    const allowed=declared?.length?thinkingChoices.filter(option=>declared.includes(option.value as any)):thinkingChoices;
    return allowed.length?allowed:[thinkingChoices[0]];
  };
  const thinkingFor=(name:Role)=>{
    const options=optionsForThinking(name);
    return options.some(option=>option.value===draft.thinking[name])?draft.thinking[name]:options.find(option=>option.value==='medium')?.value||options[0].value;
  };
  const save=async()=>{
    if(saving||loading||!loaded[scope])return;
    setSaving(true);setError('');let currentSaved=false;
    try {
      const latest=useStore.getState();
      if((latest.activeServerConnectionId||'local')!==targetConnection || applyTo!=='future'&&((latest.currentSessionPath||'')!==targetSession||pendingTarget&&latest.pendingDraftId!==targetDraft))
        throw new Error('对话或服务连接已切换，请关闭后在目标对话重新设置');
      if(draft.budget!==''&&(!Number.isInteger(Number(draft.budget))||Number(draft.budget)<1||Number(draft.budget)>1000))throw new Error('请求上限应为 1–1000 的整数');
      const role=(name:Role)=>{const model=models.find(model=>key(model)===draft[name]);if(!model)throw new Error(`请选择已配置的${labelFor(name)}模型`);return {provider:model.provider,id:model.id,thinking:thinkingFor(name)};};
      const phased=['plan-execute','adaptive'].includes(draft.mode);
      const policy=validateModelPolicy({mode:draft.mode,execution:role('execution'),...(phased?{planning:role('planning'),review:role('review')}:{}),...(draft.mode==='delegated'||phased&&draft.workerEnabled?{worker:role('worker')}:{}),maxRequests:draft.budget?Number(draft.budget):undefined});
      if(applyTo!=='future'){
        if(pendingTarget)useStore.setState({pendingNewSessionModelPolicy:policy});
        else {await engineeringRequest('/model-policy',targetSession,{policy});await refreshEngineering(targetSession);}
        currentSaved=true;
      }
      if(applyTo!=='current'){
        if((useStore.getState().activeServerConnectionId||'local')!==targetConnection)throw new Error('服务连接已切换，请在原服务核对保存结果');
        const response=await hanaFetch('/api/enigma/model-policy-default',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({policy}),throwOnHttpError:false});
        const result=await response.json();if(!response.ok||result.error)throw new Error(result.error||'新对话默认设置保存失败');
      }
      window.dispatchEvent(new Event('enigma-model-policy-updated'));close();
    } catch(reason){setError(`${currentSaved?'当前对话设置已保存，请核对其余保存结果。':''}${reason instanceof Error?reason.message:String(reason)}`);}
    finally{setSaving(false);}
  };
  const shown:Role[]=draft.mode==='single'?['execution']:draft.mode==='delegated'?['execution','worker']:['planning','execution','review',...(draft.workerEnabled?['worker' as const]:[])];
  const modelOptions=models.map(model=>({value:key(model),label:model.name||model.id,group:model.provider}));
  const busy=saving||loading;
  const scopeLabel=applyTo==='current'?currentLabel:applyTo==='future'?'以后新建的对话':`${currentLabel}和以后新对话`;
  return <SurfaceModal onClose={close}><div className="enigma-modal-backdrop">
    <section className={`enigma-modal enigma-surface-card ${styles.dialog}`} role="dialog" data-glass-frame="sheet" data-glass-controls="" aria-modal="true" aria-label="模型分工">
      <header><h2>模型分工</h2><button type="button" onClick={close} aria-label="关闭模型分工">关闭</button></header>
      <div className={styles.body}>
        <p>按角色安排模型。已开始的请求会先完成，当前对话的调整从下一次模型请求生效。</p>
        <fieldset className={styles.form} disabled={saving||sourceChanged}>
          <FormSelect label="应用范围" value={applyTo} onChange={value=>{setApplyTo(value as Target);setError('');setLoadError('');}}
            options={[...(canCurrent?[{value:'current',label:currentLabel}]:[]),{value:'future',label:'以后新建的对话'},...(canCurrent?[{value:'both',label:`${currentLabel}和以后新对话`}]:[])]}
            hint={applyTo==='future'?'只修改默认分工，已有对话保留自己的设置。':pendingTarget?'这次输入首次发送时采用此分工，无需先连接工程工作区。':'直接应用于当前对话，不要求归属项目或连接工程工作区。'} />
          {loading&&<p role="status" className={styles.note}>正在读取模型分工…</p>}
          {loadError&&<div role="alert" className={styles.error}>{loadError}<button type="button" onClick={()=>setRetry(value=>value+1)}>重新读取</button></div>}
          <fieldset className={styles.form} disabled={busy||!loaded[scope]}>
            <FormSelect label="执行方式" value={draft.mode} onChange={mode=>patch({mode})} options={[
              {value:'single',label:'单模型完成任务'}, {value:'delegated',label:'主 Agent + 子 Agent'}, {value:'plan-execute',label:'规划 → 执行 → 复核'}, {value:'adaptive',label:'遇到困难时返回规划'},
            ]} />
            {['plan-execute','adaptive'].includes(draft.mode)&&<label className={styles.label}><input type="checkbox" checked={draft.workerEnabled} onChange={event=>patch({workerEnabled:event.target.checked})}/> 为子任务单独指定模型</label>}
            <div className={styles.roles}>
              {shown.map(name=><fieldset className={styles.role} key={name}>
                <legend>{labelFor(name)}</legend>
                <div className={styles.roleFields}>
                  <FormSelect label={`${labelFor(name)}模型`} options={modelOptions} value={draft[name]} onChange={value=>patch({[name]:value})} />
                  <FormSelect label={`${labelFor(name)}思考力度`} options={optionsForThinking(name)} value={thinkingFor(name)} fixed={optionsForThinking(name).length===1} onChange={value=>patch({thinking:{...draft.thinking,[name]:value}})} />
                </div>
              </fieldset>)}
            </div>
            <label className={styles.field}><span className={styles.label}>模型请求上限（可选）</span><input className={styles.input} aria-label="模型请求上限（可选）" aria-describedby={budgetHelp} type="number" min="1" max="1000" value={draft.budget} onChange={event=>patch({budget:event.target.value})} placeholder="沿用任务预算"/><small id={budgetHelp} className={styles.hint}>本对话及其独立复核的请求上限，范围为1–1000；子任务保留各自上限，不代表Token数量。</small></label>
          </fieldset>
        </fieldset>
        <p className={styles.note}>{draft.mode==='delegated'?'主 Agent 与你对话并统筹任务，子 Agent 用指定模型处理独立工作。对子任务的显式模型设置优先，既有任务不因默认值变化而被重启。':draft.mode==='single'?'一个模型负责整个任务。':'规划先读取材料形成计划，执行阶段再操作；复核模型独立检查已有证据。'}模型设置不会扩大任务权限。</p>
        {!models.length&&<p className={styles.error}>没有可用模型，请先在设置 → 供应商中添加模型。</p>}
        {sourceChanged&&<p className={styles.error} role="alert">对话或服务连接已切换，请关闭后在目标对话重新设置。</p>}
        {error&&<p className={styles.error} role="alert">{error}</p>}
      </div>
      <footer className={styles.footer}><span className={styles.hint}>范围：{scopeLabel}</span><button type="button" onClick={close}>取消</button><button type="button" className="enigma-primary" disabled={busy||sourceChanged||!models.length||!loaded[scope]} onClick={()=>void save()}>{saving?'正在保存…':'保存模型分工'}</button></footer>
    </section>
  </div></SurfaceModal>;
}
