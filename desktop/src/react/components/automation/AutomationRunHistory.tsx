import {useCallback, useEffect, useRef, useState} from 'react';
import {hanaFetch} from '../../hooks/use-hana-fetch';
import {capturePreviewContext} from '../../utils/preview-context';
import {useStore} from '../../stores';
import type {CronJob} from './automation-types';
import styles from './AutomationPanel.module.css';

interface Run {status?:string;startedAt?:string;finishedAt?:string;error?:string;reason?:string;}
const time=(value?:string)=>value&&!Number.isNaN(Date.parse(value))?new Date(value).toLocaleString(undefined,{hour12:false}):'未记录';

export function AutomationRunHistory({job,open}:{job:CronJob;open:boolean}){
  const [runs,setRuns]=useState<Run[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const serial=useRef(0);
  const load=useCallback(async()=>{
    const current=++serial.current,owns=capturePreviewContext();setLoading(true);setError('');
    try{
      const response=await hanaFetch(`/api/desk/cron?jobId=${encodeURIComponent(job.id)}`,{throwOnHttpError:false});
      const data=await response.json();
      if(!owns()||current!==serial.current)return;
      if(!response.ok||!Array.isArray(data.runs))throw Error('运行记录暂不可用，请重试。');
      setRuns(data.runs);
    }catch(err){if(owns()&&current===serial.current)setError(err instanceof Error?err.message:'运行记录读取失败');}
    finally{if(owns()&&current===serial.current)setLoading(false);}
  },[job.id]);
  useEffect(()=>{if(open)void load();return()=>{serial.current++;};},[open,job.id,job.lastRunAt,load]);
  if(!open)return null;
  return <section className={styles.runHistory} aria-label="计划任务运行记录">
    <div className={styles.historyHeading}><strong>最近运行</strong><button onClick={()=>void load()} disabled={loading}>{loading?'读取中…':'刷新记录'}</button></div>
    {error?<div role="alert">{error}</div>:runs.length===0&&!loading?<p>还没有执行记录。开启并到达计划时间后会自动执行。</p>:null}
    <ol>{runs.map((run,index)=><li key={`${run.startedAt}:${index}`}>
      <span data-run-status={run.status}>{({success:'执行成功',error:'执行失败',skipped:'已跳过'} as Record<string,string>)[run.status||'']||'状态未知'}</span>
      <time>开始 {time(run.startedAt)}</time><time>结束 {time(run.finishedAt)}</time>
      {run.error||run.reason?<p>{run.error||run.reason}</p>:null}
    </li>)}</ol>
    {runs.length>0&&<><small>显示最近 {runs.length} 次；运行成功不代表任务产物已经人工验收。</small><button onClick={()=>useStore.getState().setActivePanel('activity')}>查看全部运行记录与结果</button></>}
  </section>;
}
