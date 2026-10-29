import { SurfaceModal } from "./SurfaceMenu";
import { FormMultiChoice } from "./FormSelect";
import styles from "./FormLayout.module.css";
import { useState } from "react";
import { useStore } from "../stores";
import { switchSession } from "../stores/session-actions";
import { useEngineering, engineeringRequest } from "./state";
import {useSideAction} from './useSideAction';

export function ConductorCreateDialog({ close }: { close: () => void }) {
  const state = useEngineering(),
    models = useStore((s) => s.models),
    repos = state.snapshot?.overview?.repositories || [];
  const [sourceSession]=useState(state.sessionPath),[sourceConnection]=useState(state.connectionId);
  const sourceModel=models.find(model=>model.provider===state.snapshot?.state?.chat?.provider&&model.id===state.snapshot?.state?.chat?.model)||models.find(model=>model.isCurrent)||models[0];
  const [parallel, setParallel] = useState(2),
    [maximum, setMaximum] = useState(8),
    [writeRepos, setWriteRepos] = useState<string[]>(
      repos
        .filter((repo: any) => repo.access === "write")
        .map((repo: any) => repo.id),
    );
  const [allowedModels, setAllowedModels] = useState<string[]>(sourceModel?[`${sourceModel.provider}/${sourceModel.id}`]:[]),
    [rewind, setRewind] = useState(false);
  const action=useSideAction(sourceSession),busy=!!action.busy;
  const sourceChanged=state.sessionPath!==sourceSession||state.connectionId!==sourceConnection;
  const create = () => action.run('create',async()=>{
      if(useEngineering.getState().sessionPath!==sourceSession||useEngineering.getState().connectionId!==sourceConnection)throw new Error('会话已切换，请在目标项目重新创建管家');
      if(!allowedModels.length||allowedModels.some(value=>!models.some(model=>`${model.provider}/${model.id}`===value)))throw new Error('请选择已配置的可用模型');
      if(!Number.isInteger(parallel)||parallel<1||parallel>4||!Number.isInteger(maximum)||maximum<1||maximum>12)throw new Error('同时运行数量应为1–4，任务总数应为1–12，均填写整数');
      return engineeringRequest(
        "/conductor/new",
        sourceSession,
        {
          limits: {
            maxConcurrent: parallel,
            maxTasks: maximum,
            writableRepos: writeRepos,
            allowedModels,
            allowRewind: rewind,
          },
        },
      );
      },async result=>{close();await switchSession(result.sessionPath);});
  return <SurfaceModal onClose={close}><div className="enigma-modal-backdrop">
    <section className={`enigma-modal enigma-surface-card ${styles.dialog}`} role="dialog" data-glass-frame="sheet" data-glass-controls="" aria-modal="true" aria-label="创建任务编排管家">
      <header><h2>把目标交给管家</h2><button type="button" onClick={close}>关闭</button></header>
      <div className={styles.body}>
        <p>管家使用独立对话组织工作。先设置并发、仓库和模型范围，再交代目标。</p>
        <fieldset disabled={busy||sourceChanged} className={styles.form}>
          <div className={styles.columns}>
            <label className={styles.field}><span className={styles.label}>最多同时运行几个工作对话</span><input className={styles.input} aria-label="最多同时运行几个工作对话" type="number" min="1" max="4" value={parallel} onChange={event=>setParallel(Number(event.target.value))}/><small className={styles.hint}>同时运行上限：1–4</small></label>
            <label className={styles.field}><span className={styles.label}>这组任务最多创建几个对话</span><input className={styles.input} aria-label="这组任务最多创建几个对话" type="number" min="1" max="12" value={maximum} onChange={event=>setMaximum(Number(event.target.value))}/><small className={styles.hint}>累计创建上限：1–12</small></label>
          </div>
          <div><FormMultiChoice label="允许改代码的仓库" options={repos.filter((repo:any)=>repo.access==='write').map((repo:any)=>({value:repo.id,label:repo.id}))} value={writeRepos} onChange={setWriteRepos} empty="当前没有可写仓库，管家将按只读范围组织任务。"/><small className={styles.hint}>不勾选则只读。每个工作对话使用独立代码工作区。</small></div>
          <FormMultiChoice label="允许使用的模型" options={models.map(model=>({value:`${model.provider}/${model.id}`,label:`${model.name||model.id} · ${model.provider}`}))} value={allowedModels} onChange={setAllowedModels} empty="请先在设置 → 供应商中添加模型。"/>
          <div><label className={styles.check}><input type="checkbox" checked={rewind} onChange={event=>setRewind(event.target.checked)}/><span>允许管家恢复自己创建的工作对话</span></label><small className={styles.hint}>恢复会检查旧执行、原要求和当前代码；不会扩大权限或改动验收标准。</small></div>
        </fieldset>
        {action.error&&<p className={styles.error} role="alert">{action.error}</p>}
        {sourceChanged&&<p className={styles.error} role="alert">会话或服务已切换，请关闭后在目标项目重新打开。</p>}
        {busy&&<p role="status" className={styles.note}>正在创建独立对话。关闭窗口不会取消已提交的请求，完成后可在对话列表中找到它。</p>}
      </div>
      <footer className={styles.footer}><button type="button" onClick={close}>取消</button><button type="button" className="enigma-primary" onClick={()=>void create()} disabled={busy||sourceChanged||!allowedModels.length}>{busy?'正在创建…':'创建管家对话'}</button></footer>
    </section>
  </div></SurfaceModal>;
}
