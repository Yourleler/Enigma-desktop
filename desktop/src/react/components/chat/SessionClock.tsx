import { useEffect, useState, useRef } from 'react';
import { useStore } from '../../stores';
import { hanaFetch } from '../../hooks/use-hana-fetch';
import { tokenMeterKey, useTokenMeterStore } from '../input/token-meter-store';
import { elapsedClock, type RuntimeClock, type SessionTiming } from '../../../../../shared/session-timing';
import styles from './SessionClock.module.css';

export function formatClockTime(at:number|null):string {
  if(!at || !Number.isFinite(at))return '未记录';
  return new Date(at).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
}
export function SessionClock({compact=false,inline=false}:{compact?:boolean;inline?:boolean}={}) {
  const path=useStore(s=>s.currentSessionPath), connection=useStore(s=>s.activeServerConnectionId),connected=useStore(s=>s.connected),welcome=useStore(s=>s.welcomeVisible);
  const meter=useTokenMeterStore(s=>path?s.metersBySession[tokenMeterKey(connection,path)]:undefined);
  const meterReceipt=useRef({value:meter,at:Date.now()});
  if(meterReceipt.current.value!==meter)meterReceipt.current={value:meter,at:Date.now()};
  const scope=`${connection||'local'}:${path||''}`;
  const [sample,setSample]=useState<{scope:string;value:SessionTiming;receivedAt:number}|null>(null),[error,setError]=useState(false),[now,setNow]=useState(Date.now());
  useEffect(()=>{
    if(!path||welcome||!connected)return;
    let stopped=false,pending=false;const controller=new AbortController();setError(false);
    const read=async()=>{
      if(stopped||pending||document.hidden)return;pending=true;
      try{const response=await hanaFetch(`/api/sessions/timing?path=${encodeURIComponent(path)}`,{signal:controller.signal,timeout:8000});const value=await response.json();
        if(!response.ok||value.error||value.sessionPath!==path)throw new Error('Timing unavailable');
        if(!stopped){setSample({scope,value,receivedAt:Date.now()});setError(false);setNow(Date.now());}
      }catch{if(!stopped&&!controller.signal.aborted)setError(true);}finally{pending=false;}
    };
    void read();const timer=setInterval(()=>void read(),3000);const visible=()=>{if(!document.hidden)void read();};document.addEventListener('visibilitychange',visible);
    return()=>{stopped=true;controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
  },[path,scope,connected,welcome]);
  const data=sample?.scope===scope?sample:null;
  useEffect(()=>{
    if(welcome||!path)return;
    const timer=setInterval(()=>{if(!document.hidden)setNow(Date.now());},1000);
    return()=>clearInterval(timer);
  },[path,welcome]);
  if(!path||welcome)return null;
  const stale=!connected||error||!!data&&now-data.receivedAt>10000;
  let run=data?.value.run;
  if(meter && (!data || (meter.sampledAt || meter.startedAt) > data.value.sampledAt))run={kind:'conversation',startedAt:meter.startedAt,elapsedMs:meter.elapsedMs,state:meter.state==='running'?'running':meter.state==='done'?'done':'stopped'};
  const clocks=[data?.value.goal,data?.value.conductor,run].filter((clock):clock is RuntimeClock=>!!clock && clock.state !== 'done' && clock.state !== 'stopped');
  const clock=clocks.find(c=>c.kind==='goal'&&c.state==='running') || clocks.find(c=>c.kind==='conductor'&&c.state==='running') || clocks.find(c=>c.state==='running') || clocks[0];
  const received=clock?.kind==='conversation'&&meter&&(!data||(meter.sampledAt||meter.startedAt)>data.value.sampledAt) ? meterReceipt.current.at : data?.receivedAt;
  const elapsed=clock?.elapsedMs==null?null:clock.elapsedMs+(clock.state==='running'&&!stale&&received?Math.max(0,now-received):0);
  const label=clock?.kind==='goal'?'Goal 循环':clock?.kind==='conductor'?'管家协作':'本轮对话';
  const state=stale?'状态待同步':clock?.state==='running'?'运行中':clock?.state==='paused'?'已暂停':clock?.state==='done'?'已结束':clock?.state==='stopped'?'已停止':'状态待核对';
  if(inline){
    if(!clock||clock.kind==='goal')return null;
    const started=data?.value.createdAt;
    const detail=`对话开始 ${data?formatClockTime(started??null):error?'未获取':'读取中…'}${clock?`\n${label} · ${state} · ${elapsedClock(elapsed)}\n开始 ${formatClockTime(clock.startedAt)}`:''}`;
    return <div className={styles.inlineBar} data-testid="session-clock" aria-label="对话时间" data-tooltip={detail}>
      {clock&&<span className={styles.run} data-active={clock.state==='running'&&!stale}>{state} <strong>{elapsedClock(elapsed)}</strong></span>}
    </div>;
  }
  return <div className={styles.bar} aria-label="对话时间" data-compact={compact||undefined} data-testid="session-clock">
    <span>对话开始 <time dateTime={data?.value.createdAt?new Date(data.value.createdAt).toISOString():undefined}>{data?formatClockTime(data.value.createdAt):error?'未获取':'读取中…'}</time></span>
    {clock&&<><span className={styles.run} data-active={clock.state==='running'&&!stale}>{label} · {state} <strong>{elapsedClock(elapsed)}</strong></span><span>{clock.kind==='goal'?'目标开始':clock.kind==='conductor'?'协作开始':'本轮开始'} <time>{formatClockTime(clock.startedAt)}</time></span></>}
    {!clock&&stale&&<span>时间信息暂不可用</span>}
    {clock?.kind==='goal'&&<span className={styles.detail} title="等待下一轮时计时继续；显式暂停期间不累计。">含轮次间等待</span>}
    {clock?.kind==='conductor'&&<span className={styles.detail} title="从首次工作对话启动到当前或最后完成的跨度，包含协作间隔。">协作历时</span>}
  </div>;
}
