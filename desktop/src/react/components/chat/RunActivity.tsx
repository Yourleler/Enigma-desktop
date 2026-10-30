import { useEffect, useState } from 'react';
import { useStore } from '../../stores';
import { tokenMeterKey, useTokenMeterStore } from '../input/token-meter-store';
import './RunActivity.css';

export function ActivityWave(){return <span className="enigma-activity-wave" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M10 2.5 12 8l5.5 2-5.5 2-2 5.5L8 12l-5.5-2L8 8Z"/></svg></span>;}

export function RunActivity({sessionPath}:{sessionPath:string}) {
  const connection=useStore(s=>s.activeServerConnectionId),connected=useStore(s=>s.connected);
  const meter=useTokenMeterStore(s=>s.metersBySession[tokenMeterKey(connection,sessionPath)]);
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const activity=meter?.activity;
  const phase=activity?.kind || ({upload:'waiting',tool:'tool',processing:'processing',thinking:'thinking',writing:'writing'} as const)[meter?.phase||'upload'];
  const labels={waiting:'等待模型响应',thinking:'正在思考',writing:'正在生成内容','preparing-tool':'正在准备工具调用',tool:'正在执行工具',processing:'正在处理后续步骤'};
  const idle=Math.max(0,Math.floor((now-(activity?.at||meter?.startedAt||now))/1000));
  const stale=!connected||!!meter?.sampledAt&&now-meter.sampledAt>6000;
  const hint=stale?'连接或状态更新暂时中断，当前进度待确认':idle>=15?`${idle} 秒未收到新的进展；${phase==='waiting'?'仍在等待响应':phase==='tool'?'工具尚未返回结果':'未报告新的输出'}`:phase==='preparing-tool'?'模型正在生成调用参数，工具尚未执行':phase==='waiting'?'收到首个响应后会更新进度':phase==='processing'?'本次响应已结束，正在衔接下一步':null;
  return <div className="enigma-run-activity" data-phase={phase}>
    <ActivityWave/><div><span className={stale?'':'enigma-work-shimmer'} role="status" aria-live="polite">{stale?'状态待确认':labels[phase]}{activity?.toolName&&<code>{activity.toolName}</code>}</span>{(stale||idle>=15)&&hint&&<small>{hint}</small>}</div>
    {meter&&<time>{Math.max(0,Math.floor((now-meter.startedAt)/1000))}s</time>}
  </div>;
}
