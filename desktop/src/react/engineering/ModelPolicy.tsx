import { useEffect, useState, useId } from 'react';
import { SurfaceModal } from './SurfaceMenu';
import { FormSelect } from './FormSelect';
import styles from './FormLayout.module.css';
import { useStore } from '../stores';
import { hanaFetch } from '../hooks/use-hana-fetch';
import { shouldShowThinkingControl } from '../utils/model-thinking';
import { useEngineering, engineeringRequest, refreshEngineering } from './state';

type Role = 'execution' | 'planning' | 'review';
type Target = 'current' | 'future' | 'both';
type Draft = { mode: string; execution: string; planning: string; review: string; thinking: Record<Role,string>; budget: string };
const key = (model: any) => model ? `${model.provider}/${model.id}` : '';
const roles: Role[] = ['planning','execution','review'];
const roleNames = {planning:'规划',execution:'执行',review:'复核'};
const thinkingChoices = [
  {value:'off',label:'关闭'}, {value:'low',label:'低'}, {value:'medium',label:'中'}, {value:'high',label:'高'}, {value:'max',label:'最高'},
];
function draftFrom(policy: any, initial: any): Draft {
  return {mode:policy?.mode || 'single', execution:key(policy?.execution || initial), planning:key(policy?.planning || initial), review:key(policy?.review || initial),
    thinking:{execution:policy?.execution?.thinking || 'medium',planning:policy?.planning?.thinking || 'medium',review:policy?.review?.thinking || 'medium'},
    budget:policy?.maxRequests == null ? '' : String(policy.maxRequests)};
}
export function ModelPolicyDialog({close}:{close:()=>void}) {
  const models=useStore(s=>s.models), state=useEngineering();
  const budgetHelp=useId();
  const [targetSession]=useState(state.sessionPath), [targetConnection]=useState(state.connectionId);
  const [canCurrent]=useState(!!state.snapshot?.connected && !!state.sessionPath);
  const [applyTo,setApplyTo]=useState<Target>(canCurrent?'current':'future');
  const initial=models.find(model=>model.isCurrent) || models[0];
  const [drafts,setDrafts]=useState(()=>({current:draftFrom(state.snapshot?.modelPolicy,initial),future:draftFrom(null,initial)}));
  const [futureLoaded,setFutureLoaded]=useState(false),[loading,setLoading]=useState(false),[loadError,setLoadError]=useState(''),[retry,setRetry]=useState(0);
  const [error,setError]=useState(''),[saving,setSaving]=useState(false);
  const scope=applyTo==='future'?'future':'current',draft=drafts[scope];
  const sourceChanged=state.connectionId!==targetConnection || applyTo!=='future'&&state.sessionPath!==targetSession;
  const patch=(values:Partial<Draft>)=>setDrafts(d=>({...d,[scope]:{...d[scope],...values}}));

  useEffect(()=>{
    if(applyTo!=='future'||futureLoaded||sourceChanged)return;
    let active=true;const controller=new AbortController();setLoading(true);setLoadError('');
    void hanaFetch('/api/enigma/model-policy-default',{signal:controller.signal,throwOnHttpError:false}).then(async response=>{
      const result=await response.json();if(!response.ok||result.error)throw new Error(result.error||'读取新任务默认分工失败');
      if(!active||useEngineering.getState().connectionId!==targetConnection)return;
      const available=useStore.getState().models;
      setDrafts(previous=>({...previous,future:draftFrom(result.policy,available.find(model=>model.isCurrent)||available[0])}));setFutureLoaded(true);
    }).catch(reason=>{if(active&&!controller.signal.aborted)setLoadError(reason instanceof Error?reason.message:String(reason));})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;controller.abort();};
  },[applyTo,futureLoaded,sourceChanged,targetConnection,retry]);

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
    if(saving||loading||applyTo==='future'&&!futureLoaded)return;
    setSaving(true);setError('');let currentSaved=false;
    try {
      if(useEngineering.getState().connectionId!==targetConnection || applyTo!=='future'&&useEngineering.getState().sessionPath!==targetSession)
        throw new Error('会话或服务连接已切换，请关闭后在目标会话重新设置');
      if(draft.budget!==''&&(!Number.isInteger(Number(draft.budget))||Number(draft.budget)<1||Number(draft.budget)>1000))throw new Error('请求上限应为 1–1000 的整数');
      const role=(name:Role)=>{const model=models.find(model=>key(model)===draft[name]);if(!model)throw new Error(`请选择已配置的${roleNames[name]}模型`);return {provider:model.provider,id:model.id,thinking:thinkingFor(name)};};
      const policy={mode:draft.mode,execution:role('execution'),...(draft.mode!=='single'?{planning:role('planning'),review:role('review')}:{}),maxRequests:draft.budget?Number(draft.budget):undefined};
      if(applyTo!=='future'){await engineeringRequest('/model-policy',targetSession,{policy});currentSaved=true;await refreshEngineering(targetSession);}
      if(applyTo!=='current'){
        if(useEngineering.getState().connectionId!==targetConnection)throw new Error('服务连接已切换，请在原服务核对保存结果');
        const response=await hanaFetch('/api/enigma/model-policy-default',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({policy}),throwOnHttpError:false});
        const result=await response.json();if(!response.ok||result.error)throw new Error(result.error||'新任务默认设置保存失败');
      }
      close();
    } catch(reason){setError(`${currentSaved?'当前会话已保存，请核对其余保存结果。':''}${reason instanceof Error?reason.message:String(reason)}`);}
    finally{setSaving(false);}
  };
  const shown:Role[]=draft.mode==='single'?['execution']:roles;
  const modelOptions=models.map(model=>({value:key(model),label:model.name||model.id,group:model.provider}));
  const busy=saving||loading;
  return <SurfaceModal onClose={close}><div className="enigma-modal-backdrop">
    <section className={`enigma-modal enigma-surface-card ${styles.dialog}`} role="dialog" aria-modal="true" aria-label="模型分工">
      <header><h2>模型分工</h2><button type="button" onClick={close} aria-label="关闭模型分工">关闭</button></header>
      <div className={styles.body}>
        <p>选择任务的执行方式，再为每个角色指定模型。当前运行中的请求会先完成，调整从下一次模型请求生效。</p>
        <fieldset className={styles.form} disabled={saving||sourceChanged}>
          <FormSelect label="应用范围" value={applyTo} onChange={value=>{setApplyTo(value as Target);setError('');}}
            fixed={!canCurrent} options={canCurrent?[{value:'current',label:'仅当前会话'},{value:'future',label:'以后新建的工程任务'},{value:'both',label:'当前会话和以后新任务'}]:[{value:'future',label:'以后新建的工程任务'}]}
            hint={!canCurrent?'目前没有已连接工程工作区的对话，因此这里只设置新任务默认值。':applyTo==='future'?'只修改新任务的默认值，当前会话继续使用自己的设置。':applyTo==='both'?'将下面这份分工同时应用到当前会话和新任务默认值。':'只修改当前会话，其他会话与新任务默认值保持各自设置。'} />
          {loading&&<p role="status" className={styles.note}>正在读取新任务默认分工…</p>}
          {loadError&&applyTo==='future'&&<div role="alert" className={styles.error}>{loadError}<button type="button" onClick={()=>setRetry(value=>value+1)}>重新读取</button></div>}
          <fieldset className={styles.form} disabled={busy||applyTo==='future'&&!futureLoaded}>
            <FormSelect label="执行方式" value={draft.mode} onChange={mode=>patch({mode})} options={[
              {value:'single',label:'单模型完成任务'}, {value:'plan-execute',label:'规划 → 执行 → 复核'}, {value:'adaptive',label:'遇到困难时返回规划'},
            ]} />
            <div className={styles.roles}>
              {shown.map(name=><fieldset className={styles.role} key={name}>
                <legend>{roleNames[name]}</legend>
                <div className={styles.roleFields}>
                  <FormSelect label={`${roleNames[name]}模型`} options={modelOptions} value={draft[name]} onChange={value=>patch({[name]:value})} />
                  <FormSelect label={`${roleNames[name]}思考力度`} options={optionsForThinking(name)} value={thinkingFor(name)} fixed={optionsForThinking(name).length===1} onChange={value=>patch({thinking:{...draft.thinking,[name]:value}})} />
                </div>
              </fieldset>)}
            </div>
            <label className={styles.field}><span className={styles.label}>模型请求上限（可选）</span><input className={styles.input} aria-label="模型请求上限（可选）" aria-describedby={budgetHelp} type="number" min="1" max="1000" value={draft.budget} onChange={event=>patch({budget:event.target.value})} placeholder="沿用任务预算"/><small id={budgetHelp} className={styles.hint}>限制主循环的模型请求次数，范围为 1–1000；不代表 token 数量。</small></label>
          </fieldset>
        </fieldset>
        <p className={styles.note}>{draft.mode==='single'?'一个模型负责整个任务。':'规划先读取源码并形成计划，执行阶段再修改代码；复核使用指定的复核模型。'}验收仍使用原检查，模型设置不会扩大任务权限。</p>
        {!models.length&&<p className={styles.error}>没有可用模型，请先在设置 → 供应商中添加模型。</p>}
        {sourceChanged&&<p className={styles.error} role="alert">会话或服务连接已切换，请关闭后在目标会话重新设置。</p>}
        {error&&<p className={styles.error} role="alert">{error}</p>}
      </div>
      <footer className={styles.footer}><span className={styles.hint}>范围：{applyTo==='current'?'仅当前会话':applyTo==='future'?'以后新建的工程任务':'当前会话和以后新任务'}</span><button type="button" onClick={close}>取消</button><button type="button" className="enigma-primary" disabled={busy||sourceChanged||!models.length||applyTo==='future'&&!futureLoaded} onClick={()=>void save()}>{saving?'正在保存…':'保存模型分工'}</button></footer>
    </section>
  </div></SurfaceModal>;
}
