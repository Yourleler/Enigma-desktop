import { useState } from 'react';
import { useStore } from '../stores';
import { hanaFetch } from '../hooks/use-hana-fetch';
import { useEngineering, engineeringRequest, refreshEngineering } from './state';

export function ModelPolicyDialog({ close }: { close: () => void }) {
  const models=useStore(s=>s.models),state=useEngineering(),current=state.snapshot?.modelPolicy;
  const initial=current?.execution || models.find(model=>model.isCurrent) || models[0];
  const key=(model:any)=>model?`${model.provider}/${model.id}`:'';
  const [mode,setMode]=useState(current?.mode || 'single'),[execution,setExecution]=useState(key(initial)),[planning,setPlanning]=useState(key(current?.planning || initial)),[review,setReview]=useState(key(current?.review || initial));
  const [thinking,setThinking]=useState({execution:current?.execution?.thinking||'medium',planning:current?.planning?.thinking||'medium',review:current?.review?.thinking||'medium'}),[budget,setBudget]=useState(current?.maxRequests || ''),[error,setError]=useState(''),[saving,setSaving]=useState(false);
  const role=(value:string,name:'execution'|'planning'|'review')=>{const model=models.find(model=>key(model)===value);if(!model)throw new Error('请选择已配置的模型');return {provider:model.provider,id:model.id,thinking:thinking[name]};};
  const save=async()=>{
    setSaving(true);setError('');
    try{
      const policy={mode,execution:role(execution,'execution'),...(mode!=='single'?{planning:role(planning,'planning'),review:role(review,'review')}:{}),maxRequests:budget?Number(budget):undefined};
      const response=await hanaFetch('/api/enigma/model-policy-default',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({policy}),throwOnHttpError:false});
      if(!response.ok)throw new Error((await response.json()).error || '保存失败');
      if(state.snapshot?.connected&&state.sessionPath){await engineeringRequest('/model-policy',state.sessionPath,{policy});await refreshEngineering(state.sessionPath);}
      close();
    }catch(error){setError(String(error));}finally{setSaving(false);}
  };
  const select=(label:string,value:string,set:(value:string)=>void)=><label className="enigma-field"><span>{label}</span><select value={value} onChange={event=>set(event.target.value)}>{models.map(model=><option key={key(model)} value={key(model)}>{model.name || model.id} · {model.provider}</option>)}</select></label>;
  return <div className="enigma-modal-backdrop"><section className="enigma-modal enigma-glass" role="dialog" aria-modal="true" aria-label="新任务模型分工"><header><h2>模型分工</h2><button onClick={close}>关闭</button></header><p>保存为新工程任务的默认设置，也应用到当前工程会话。运行中的选择在下一次请求生效。</p>
    <label className="enigma-field"><span>执行方式</span><select value={mode} onChange={event=>setMode(event.target.value)}><option value="single">单模型</option><option value="plan-execute">规划与执行分开</option><option value="adaptive">规划 / 执行，困难时回到规划</option></select></label>
    {select('执行模型',execution,setExecution)}{mode!=='single'&&select('规划模型',planning,setPlanning)}{mode!=='single'&&select('复核模型',review,setReview)}
    {(['execution',...(mode!=='single'?['planning','review']:[])] as ('execution'|'planning'|'review')[]).map(name=><label className="enigma-field" key={name}><span>{({execution:'执行',planning:'规划',review:'复核'})[name]}思考力度</span><select value={thinking[name]} onChange={event=>setThinking({...thinking,[name]:event.target.value})}>{['off','low','medium','high','max'].map(value=><option value={value} key={value}>{({off:'关闭',low:'低',medium:'中',high:'高',max:'最高'} as any)[value]}</option>)}</select></label>)}
    <label className="enigma-field"><span>主循环模型请求上限（可选）</span><input type="number" min="1" max="1000" value={budget} onChange={event=>setBudget(event.target.value)} placeholder="沿用任务预算" /></label>
    <p>规划阶段先阅读并形成任务计划，进入执行后再写源码。验收仍使用原检查，切换模型不会改变权限。</p>{error&&<p className="enigma-error">{error}</p>}<button className="enigma-primary" disabled={saving||!models.length} onClick={()=>void save()}>{saving?'正在保存…':'保存模型分工'}</button>
  </section></div>;
}
