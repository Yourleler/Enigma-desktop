import { GlassSelection } from '../../ui/GlassSelection';
import {useEffect,useState} from 'react';
import {SelectWidget} from '../../ui/SelectWidget';
import type {UsageTotals,UsageGroup} from '../../../../../shared/usage-summary';
import styles from './UsageAnalytics.module.css';

type Fetcher=(path:string,opts?:RequestInit)=>Promise<Response>;
export interface UsageReport {totals:UsageTotals;models:UsageGroup[];daily:UsageGroup[];sources:UsageGroup[];choices:{models:string[];sources:string[];agents:string[]};records:any[];pagination:{offset:number;limit:number;total:number;hasMore:boolean};coverage:{retained:number;maximum?:number;atCapacity?:boolean;oldestAt?:string|null};scope:string;sampledAt:number}
const number=(n:number|undefined)=>(n||0).toLocaleString();
const sourceName=(name:string)=>({session:'对话',utility:'辅助任务',memory:'记忆',subagent:'子任务',workflow:'协作流程',unknown:'来源未记录'}[name]||name);
const statusName=(name:string)=>({ok:'已报告',error:'失败',aborted:'已中止',usage_missing:'未报告用量'}[name]||name);
export function UsageTotalsView({value}:{value:UsageTotals}) {
  return <><div className={styles.totals}><div><span>输入（含缓存）</span><strong>{number(value.input)}</strong></div><div><span>模型输出</span><strong>{number(value.output)}</strong></div><div><span>合计 token</span><strong>{number(value.total)}</strong></div><div><span>模型请求</span><strong>{number(value.requests)}</strong></div></div>
    <p className={styles.note}>缓存读取 {number(value.cacheRead)} · 缓存写入 {number(value.cacheWrite)}（已包含在输入中）{value.reasoningReported>0&&` · 已报告思考 ${number(value.reasoning)}（包含在输出中）`}</p>
    {value.missingRequests>0&&<p className={styles.warning}>{value.missingRequests} 次请求未返回用量，未按零消耗计入以上 token 合计。</p>}
    {value.failedRequests>0&&<p className={styles.note}>包含 {value.failedRequests} 次失败或中止请求；它们已报告的用量仍计入。</p>}</>;
}
export function UsageGroupTable({groups}:{groups:UsageGroup[]}){
 return <div className={styles.tableWrap}><table><thead><tr><th>分组</th><th>请求</th><th>输入</th><th>输出</th><th>合计</th></tr></thead><tbody>{groups.map(row=><tr key={row.key}><th>{row.label}</th><td>{row.requests}</td><td>{number(row.input)}</td><td>{number(row.output)}</td><td>{number(row.total)}</td></tr>)}</tbody></table>{!groups.length&&<p className={styles.note}>当前范围没有已保存的记录。</p>}</div>;
}
function timeRange(period:string,from:string,to:string){
 const now=new Date(),start=new Date(now);start.setHours(0,0,0,0);
 if(period==='all')return {};
 if(period==='custom'){
  if(!from||!to)return {error:'请选择开始日期与结束日期。'};
  const a=new Date(`${from}T00:00:00`),b=new Date(`${to}T00:00:00`);b.setDate(b.getDate()+1);
  if(a>=b)return {error:'结束日期不能早于开始日期。'};
  return {since:a.toISOString(),until:b.toISOString()};
 }
 if(period==='week')start.setDate(start.getDate()-6);if(period==='month')start.setDate(start.getDate()-29);
 const end=new Date(now);end.setHours(24,0,0,0);return {since:start.toISOString(),until:end.toISOString()};
}
export function UsageAnalytics({fetcher,connectionKey,sessionPath,compact=false}:{fetcher:Fetcher;connectionKey?:string|null;sessionPath?:string|null;compact?:boolean}) {
 const [period,setPeriod]=useState(sessionPath?'all':'week'),[model,setModel]=useState(''),[source,setSource]=useState(''),[status,setStatus]=useState(''),[session,setSession]=useState('');
 const [from,setFrom]=useState(''),[to,setTo]=useState(''),[view,setView]=useState<'models'|'daily'|'sources'|'records'>('models');
 const [offset,setOffset]=useState(0),[refresh,setRefresh]=useState(0),[data,setData]=useState<UsageReport|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[sessions,setSessions]=useState<{path:string;title?:string;firstMessage?:string}[]>([]);
 const range=timeRange(period,from,to),selectedSession=sessionPath||session;
 const params=new URLSearchParams({offset:String(offset),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});
 if(range.since)params.set('since',range.since);if(range.until)params.set('until',range.until);if(model)params.set('model',model);if(source)params.set('source',source);if(status)params.set('status',status);if(selectedSession)params.set('sessionPath',selectedSession);
 const query=params.toString(), resultKey=`${connectionKey||'local'}:${query}`;
 const [loadedKey,setLoadedKey]=useState('');
 useEffect(()=>{setData(null);setSessions([]);setOffset(0);setModel('');setSession('');},[sessionPath,connectionKey]);
 useEffect(()=>{if(sessionPath)return;let active=true;const controller=new AbortController();void fetcher('/api/sessions',{signal:controller.signal}).then(response=>response.json()).then(value=>{if(active&&Array.isArray(value))setSessions(value);}).catch(()=>{});return()=>{active=false;controller.abort();};},[fetcher,connectionKey,sessionPath]);
 useEffect(()=>{
  if(range.error){setError(range.error);setLoading(false);return;}
  let active=true;const controller=new AbortController();setLoading(true);setError('');
  void fetcher(`/api/usage/summary?${query}`,{signal:controller.signal}).then(async response=>{const result=await response.json();if(!response.ok||result.error)throw new Error(result.error||'用量读取失败');if(active){setData(result);setLoadedKey(resultKey);}}).catch(reason=>{if(active&&!controller.signal.aborted)setError(reason instanceof Error?reason.message:String(reason));}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;controller.abort();};
 },[fetcher,query,connectionKey,refresh,range.error]);
 useEffect(()=>{const timer=setInterval(()=>{if(!document.hidden)setRefresh(value=>value+1);},5000);return()=>clearInterval(timer);},[]);
 const change=(set:(v:string)=>void)=>(v:string)=>{set(v);setOffset(0);};
 const select=(label:string,value:string,options:{value:string;label:string}[],set:(v:string)=>void)=><label className={styles.filter}><span>{label}</span><SelectWidget ariaLabel={label} value={value} options={options} onChange={change(set)} className={styles.select}/></label>;
 return <section className={`${styles.analytics} ${compact?styles.compact:''}`} aria-label={sessionPath?'本对话用量统计':'历史用量统计'}>
  <div className={styles.filters}>
   {select('时间范围',period,[{value:'today',label:'今天'},{value:'week',label:'最近 7 天'},{value:'month',label:'最近 30 天'},{value:'all',label:'全部保留记录'},{value:'custom',label:'自定义日期'}],setPeriod)}
   {select('模型筛选',model,[{value:'',label:'全部模型'},...(data?.choices.models||[]).map(value=>({value,label:value}))],setModel)}
   {!compact&&<>{select('用途筛选',source,[{value:'',label:'全部用途'},...(data?.choices.sources||[]).map(value=>({value,label:sourceName(value)}))],setSource)}{select('请求状态',status,[{value:'',label:'全部状态'},...['ok','error','aborted','usage_missing'].map(value=>({value,label:statusName(value)}))],setStatus)}
   {!sessionPath&&select('对话范围',session,[{value:'',label:'所有记录（含辅助任务）'},...sessions.map(s=>({value:s.path,label:s.title||s.firstMessage?.slice(0,70)||'未命名对话'}))],setSession)}</>}
   {period==='custom'&&<><label className={styles.filter}>开始日期<input type="date" value={from} onChange={e=>change(setFrom)(e.target.value)}/></label><label className={styles.filter}>结束日期<input type="date" value={to} onChange={e=>change(setTo)(e.target.value)}/></label></>}
  </div>
  {error&&<p role="alert" className={styles.warning}>{error} <button onClick={()=>setRefresh(n=>n+1)}>重试</button></p>}
  {loading&&(!data||loadedKey!==resultKey)&&<p role="status">正在读取用量…</p>}
  {data&&loadedKey===resultKey&&!error&&<><UsageTotalsView value={data.totals}/><div className={styles.tabs} role="tablist" aria-label="用量分组" data-glass-segmented=""><GlassSelection selection={view}/>{(['models','daily','sources','records'] as const).map(id=><button key={id} role="tab" aria-selected={view===id} onClick={()=>setView(id)}>{{models:'按模型',daily:'按日期',sources:'按用途',records:'请求明细'}[id]}</button>)}</div>
    {view==='records'?<><div className={styles.tableWrap}><table><thead><tr><th>时间 / 模型</th><th>状态</th><th>输入</th><th>输出</th></tr></thead><tbody>{data.records.map(row=><tr key={row.requestId}><th><time>{new Date(row.at).toLocaleString()}</time><small>{row.model}</small><small>{sourceName(row.source)} · {row.operation}</small></th><td>{statusName(row.status)}</td><td>{row.missingRequests?'未报告':number(row.input)}</td><td>{row.missingRequests?'未报告':number(row.output)}</td></tr>)}</tbody></table></div><div className={styles.pagination}><button disabled={!offset||loading} onClick={()=>setOffset(Math.max(0,offset-data.pagination.limit))}>上一页</button><span>{data.pagination.total?`${offset+1}–${Math.min(offset+data.pagination.limit,data.pagination.total)} / ${data.pagination.total}`:'0 条记录'}</span><button disabled={!data.pagination.hasMore||loading} onClick={()=>setOffset(offset+data.pagination.limit)}>下一页</button></div></>:<UsageGroupTable groups={view==='models'?data.models:view==='daily'?data.daily:data.sources.map(group=>({...group,label:sourceName(group.label)}))}/>}
    <p className={styles.note}>统计使用接口已报告的用量；实时估算不混入历史合计。按日期分组采用当前时区。{data.coverage.maximum?`本地最多保留 ${data.coverage.maximum.toLocaleString()} 条请求记录，当前 ${data.coverage.retained.toLocaleString()} 条。`:''}{data.coverage.atCapacity?'更早记录可能已移出保留范围，以上不是账户终身用量。':''}</p>
    <p className={styles.note}>{selectedSession?'按请求归属统计本对话，复制/分支带来的旧消息不会重复计费。':'辅助任务或没有对话归属的请求仍计入所有记录。'}计费以供应商账单为准。</p>
  </>}
 </section>;
}
