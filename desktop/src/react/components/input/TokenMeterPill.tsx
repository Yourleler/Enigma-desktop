import { GlassSelection } from '../../ui/GlassSelection';
import { UsageAnalytics } from '../usage/UsageAnalytics';
import { hanaFetch } from '../../hooks/use-hana-fetch';
import { openSettingsModal } from '../../stores/settings-modal-actions';
import { useEffect, useMemo, useRef, useState } from 'react';
import {sessionScopedValue} from '../../stores/session-slice';
import {turnUsageMeter} from '../../utils/turn-usage-meter';
import {timeMillis} from '../../../../../shared/session-timing';
import { useStore } from '../../stores';
import { AnchoredPortal } from '../../ui/AnchoredPortal';
import { formatElapsed, formatTokenCount, METER_PHASE_LABEL, tokenMeterKey, useTokenMeterStore } from './token-meter-store';
import styles from './TokenMeterPill.module.css';
import {useAnimatedNumber} from '../../hooks/use-animated-number';

/** Per-send usage stays available after completion. Raw usage and estimates
 * remain distinct; live updates do not make screen readers announce each tick. */
export function TokenMeterPill() {
  const sessionPath = useStore(s => s.currentSessionPath);
  const connection = useStore(s => s.activeServerConnectionId);
  const connected = useStore(s => s.connected);
  const liveMeter = useTokenMeterStore(s => sessionPath ? s.metersBySession[tokenMeterKey(connection, sessionPath)] : null);
  const history = useStore(s=>sessionPath?sessionScopedValue(s,s.chatSessions,sessionPath)?.items:undefined);
  const {historicalMeter,latestInputAt}=useMemo(()=>{
    let meter=null,inputAt=null;
    for(let index=(history?.length||0)-1;index>=0;index--){const item=history![index];if(item.type!=='message')continue;
      if(item.data.role==='user'){inputAt=timeMillis(item.data.timestamp);break;}
      if(!meter&&item.data.role==='assistant'&&item.data.turnUsage)meter=turnUsageMeter(item.data.turnUsage);
    }
    return {historicalMeter:meter,latestInputAt:inputAt};
  },[history]);
  const currentLive=liveMeter&&(liveMeter.state==='running'||!latestInputAt||(liveMeter.endedAt??liveMeter.startedAt)>=latestInputAt)?liveMeter:null;
  const meter=currentLive&&(!historicalMeter||currentLive.state==='running'||currentLive.startedAt>=historicalMeter.startedAt)?currentLive:historicalMeter;
  const [open, setOpen] = useState(false), [now, setNow] = useState(Date.now()),[view,setView]=useState<'round'|'session'>('round');
  const anchor = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  useEffect(() => { setOpen(false);setView('round'); }, [sessionPath, connection]);
  useEffect(() => {
    if (meter?.state !== 'running') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [meter?.state]);
  const numberIdentity=JSON.stringify([connection,sessionPath,meter?.runId,meter?.startedAt]);
  const animatedUp=useAnimatedNumber(meter?.up.tokens||0,numberIdentity,meter?.state==='running');
  const animatedDown=useAnimatedNumber(meter?.down.tokens||0,numberIdentity,meter?.state==='running');
  const close = () => { setOpen(false); anchor.current?.focus(); };
  if (!sessionPath) return null;
  const running = meter?.state === 'running';
  const stale = running && (!connected || !!meter.sampledAt && now - meter.sampledAt > 5000);
  const phase = !meter ? '尚无用量' : stale ? '用量更新中断' : running ? METER_PHASE_LABEL[meter.phase] : meter.state === 'aborted' ? '已停止' : '本轮结束';
  const counter = (side: 'up'|'down') => !meter ? '—' : meter.missingRequests===meter.requests&&meter.requests>0?'未报告':(!meter.requests && meter[side].tokens === 0) ? '待统计' : `${meter[side].estimated ? '≈' : ''}${formatTokenCount(side==='up'?animatedUp:animatedDown)}`;
  const rateVisible = running && !stale && ['thinking','writing'].includes(meter.phase) && meter.rate > 0;
  return <div className={styles.meterRow}>
    <button ref={anchor} type="button" className={styles.meter} data-liquid="control" data-testid="token-meter" data-state={meter?.state || 'idle'} aria-label="查看本轮模型用量" aria-expanded={open} aria-haspopup="dialog" data-tooltip="本次发送的模型用量：输入包含上下文与缓存，输出包含生成内容；点击查看明细" onClick={() => setOpen(v=>!v)}>
      <span className={styles.phase}><span className={`${styles.dot} ${running && !stale ? styles.live : ''}`} aria-hidden/><span>{phase}</span></span>
      <span className={styles.side}><span>↑ 输入</span><strong>{counter('up')}</strong></span>
      <span className={styles.side}><span>↓ 输出</span><strong>{counter('down')}</strong></span>
      {meter && <span className={styles.extra}>{rateVisible ? `${Math.round(meter.rate)} token/s · ` : ''}{formatElapsed(meter.elapsedMs)}</span>}
      <span className={styles.chevron} aria-hidden>⌃</span>
    </button>
    <AnchoredPortal open={open} anchorRef={anchor} onClose={close} align="end" viewportPadding={12} className={`${styles.popover} enigma-token-popover`} role="dialog" ariaLabel="本轮模型用量" focusOnOpen>
      <div ref={panel} aria-label="本轮模型用量" onKeyDown={event=>{if(event.key==='Tab'){const buttons=panel.current?.querySelectorAll<HTMLButtonElement>('button');if(buttons?.length===1){event.preventDefault();buttons[0].focus();}}}}>
        <header><div><strong>{view==='round'?'本轮模型用量':'本对话用量'}</strong><small>{view==='round'?'一次发送内，所有模型请求的累计':'当前对话已记录请求，按实际模型归属汇总'}</small></div><button onClick={close} aria-label="关闭用量明细">×</button></header>
        <div className={styles.scopeTabs} role="tablist" aria-label="用量范围" data-glass-segmented=""><GlassSelection selection={view}/><button role="tab" aria-selected={view==='round'} onClick={()=>setView('round')}>本轮</button><button role="tab" aria-selected={view==='session'} onClick={()=>setView('session')}>本对话</button><button onClick={()=>{close();openSettingsModal('usage');}}>历史统计 ↗</button></div>
        {view==='session'?<UsageAnalytics fetcher={hanaFetch} connectionKey={connection} sessionPath={sessionPath} compact/>:<>

        {!meter ? <p>这轮没有保留下来的模型用量。可切换“本对话”查看已记录请求。</p> : <>
          <div className={styles.phaseDetail}><span>{phase}</span><span>{formatElapsed(meter.elapsedMs)} · {meter.requests} 次模型请求</span></div>
          {meter.historical&&<p className={styles.note}>来自这轮原始消息的已报告用量；分支沿用的旧消息不会重新计入请求账本。</p>}
          {!!meter.missingRequests&&<p className={styles.note}>{meter.missingRequests} 次请求未保存用量，以下是已记录部分，不表示其余请求免费。</p>}
          {stale && <p className={styles.note}>当前显示最后一次收到的数据。连接恢复后会继续更新，数字停止不代表任务已经结束。</p>}
          {running&&!stale&&meter.phase==='processing'&&<p className={styles.note}>这次模型响应已结束，应用仍在处理后续步骤；可能执行工具、保存记录或准备下一次请求。</p>}
          <dl><div><dt>↑ 输入上下文</dt><dd>{meter.up.tokens.toLocaleString()} <small>{meter.up.estimated ? '估算 token' : '已报告 token'}</small></dd></div>
          <div><dt>↓ 生成输出</dt><dd>{meter.down.tokens.toLocaleString()} <small>{meter.down.estimated ? '估算 token' : '已报告 token'}</small></dd></div>
          <div><dt>缓存读取 / 写入</dt><dd>{meter.cacheRead.toLocaleString()} / {meter.cacheWrite.toLocaleString()}</dd></div>
          <div><dt>当前生成速度</dt><dd>{rateVisible ? `≈${Math.round(meter.rate)} token/s` : running ? meter.phase==='processing'?'当前没有模型输出':'等待输出' : '本轮已结束'}</dd></div>
          <div><dt>首个输出等待</dt><dd>{meter.firstOutputAt != null ? formatElapsed(meter.firstOutputAt-meter.startedAt) : running ? '尚未收到输出' : '未记录'}</dd></div></dl>
          {meter.model && <p className={styles.model}>最近使用：{meter.model}</p>}
          <p className={styles.note}>输入包含每次请求携带的上下文及已报告的缓存 token；多轮工具调用会重复携带上下文。输出可能包含思考与工具参数。</p>
          <p className={styles.note}>≈ 表示流式估算，模型报告用量后会校正。这里是本轮用量，费用以供应商账单为准；上下文容量仍在输入框的上下文按钮中查看。</p>
          {!!meter.excludedStatusNotices&&<p className={styles.note}>已从实时估算中排除 {meter.excludedStatusNotices} 条排队状态提示；状态提示不表示模型已开始生成。</p>}
          {!!meter.byModel?.length&&<details className={styles.modelDetails}><summary>本轮按模型 · {meter.byModel.length} 个</summary>{meter.byModel.map(row=><div className={styles.modelRow} key={row.model}><strong>{row.model}</strong><span>{row.requests} 次请求 · 输入 {row.inputEstimated?'≈':''}{row.input.toLocaleString()} · 输出 {row.outputEstimated?'≈':''}{row.output.toLocaleString()}</span></div>)}</details>}
        </>}
        </>}
      </div>
    </AnchoredPortal>
  </div>;
}
