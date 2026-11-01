import { GlassSelection } from '../../ui/GlassSelection';
import {Fragment,useEffect,useRef,useState} from 'react';
import {SelectWidget} from '../../ui/SelectWidget';
import {AppIcon} from '../../ui/app-icons';
import type {UsageTotals,UsageGroup} from '../../../../../shared/usage-summary';
import styles from './UsageAnalytics.module.css';

type Fetcher=(path:string,opts?:RequestInit)=>Promise<Response>;
export interface UsageReport {totals:UsageTotals;models:UsageGroup[];daily:UsageGroup[];sources:UsageGroup[];choices:{models:string[];sources:string[];agents:string[]};records:any[];pagination:{offset:number;limit:number;total:number;hasMore:boolean};coverage:{retained:number;maximum?:number;atCapacity?:boolean;oldestAt?:string|null};scope:string;sampledAt:number}
const number=(n:number|undefined)=>(n||0).toLocaleString();
const sourceName=(name:string)=>({session:'对话',utility:'辅助任务',memory:'记忆',subagent:'子任务',workflow:'协作流程',agent:'助手任务',review:'代码审查',enigma:'工程任务',unknown:'来源未记录'}[name]||name);
const operationName=(name:string)=>({reply:'回复',reading:'代码阅读',review:'审查',title:'生成标题',generate_description:'生成说明',appearance_summary:'外观摘要',rolling_summary:'更新对话摘要',compile_today:'整理今日记忆',extract_facts:'提取事实',compile_daily:'整理每日记忆',compile_longterm:'整理长期记忆',compile_editable_facts:'整理可编辑记忆','guardian-diagnose':'运行诊断',translate_skill_names:'翻译技能名称','memory-dream':'增量记忆整理'}[name]||name);
type UsageSession={path:string;title?:string;firstMessage?:string;modified?:string};
function sessionLabel(session:UsageSession){
 const title=session.title||session.firstMessage?.slice(0,70)||'未命名对话';
 const at=session.modified?new Date(session.modified):null;
 return at&&Number.isFinite(at.getTime())?`${title} · ${at.toLocaleString(undefined,{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})}`:title;
}
const statusName=(name:string)=>({ok:'已报告',error:'失败',aborted:'已中止',usage_missing:'未报告用量'}[name]||name);
export function UsageTotalsView({value,compact=false}:{value:UsageTotals;compact?:boolean}) {
  return <><div className={`${styles.totals} ${compact?styles.inlineTotals:''}`}><div><span>输入（含缓存）</span><strong>{value.reportedRequests?number(value.input):'—'}</strong></div><div><span>模型输出</span><strong>{value.reportedRequests?number(value.output):'—'}</strong></div><div><span>合计 token</span><strong>{value.reportedRequests?number(value.total):'—'}</strong></div><div><span>模型请求</span><strong>{number(value.requests)}</strong></div></div>
    <p className={styles.note}>缓存读取 {number(value.cacheRead)} · 缓存写入 {number(value.cacheWrite)}（已包含在输入中）{value.reasoningReported>0&&` · 已报告思考 ${number(value.reasoning)}（包含在输出中）`}</p>
    {value.missingRequests>0&&<p className={styles.warning}>{value.missingRequests} 次请求未返回用量，未按零消耗计入以上 token 合计。</p>}
    {value.failedRequests>0&&<p className={styles.note}>包含 {value.failedRequests} 次失败或中止请求；它们已报告的用量仍计入。</p>}</>;
}
export function UsageGroupTable({groups}:{groups:UsageGroup[]}){
 return <div className={styles.tableWrap}><table><thead><tr><th>分组</th><th>请求</th><th>输入</th><th>输出</th><th>合计</th></tr></thead><tbody>{groups.map(row=><tr key={row.key}><th>{row.label}</th><td>{row.requests}</td><td>{row.reportedRequests?number(row.input):'未报告'}</td><td>{row.reportedRequests?number(row.output):'未报告'}</td><td>{row.reportedRequests?number(row.total):'未报告'}</td></tr>)}</tbody></table>{!groups.length&&<p className={styles.note}>当前范围没有已保存的记录。</p>}</div>;
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
 const [offset,setOffset]=useState(0),[refresh,setRefresh]=useState(0),[data,setData]=useState<UsageReport|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[sessions,setSessions]=useState<UsageSession[]>([]);
 const range=timeRange(period,from,to),selectedSession=sessionPath||session;
 const params=new URLSearchParams({offset:String(offset),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});
 if(range.since)params.set('since',range.since);if(range.until)params.set('until',range.until);if(model)params.set('model',model);if(source)params.set('source',source);if(status)params.set('status',status);if(selectedSession)params.set('sessionPath',selectedSession);
 const query=params.toString(), resultKey=`${connectionKey||'local'}:${query}`;
 const [loadedKey,setLoadedKey]=useState('');
 const [expanded,setExpanded]=useState<string|null>(null),[exporting,setExporting]=useState(false),[exportError,setExportError]=useState(''),[notice,setNotice]=useState('');
 const exportRequest=useRef<AbortController|null>(null);
 useEffect(()=>{setExpanded(null);setExporting(false);setExportError('');setNotice('');return()=>{exportRequest.current?.abort();exportRequest.current=null;};},[resultKey]);
 const exportRecords=async(format:'csv'|'json')=>{
  exportRequest.current?.abort();const controller=new AbortController();exportRequest.current=controller;setExporting(true);setExportError('');setNotice('');
  const filters=new URLSearchParams(params);filters.delete('offset');filters.set('format',format);
  try{
   const response=await fetcher(`/api/usage/export?${filters}`,{signal:controller.signal});
   if(!response.ok){const result=await response.json().catch(()=>null);throw new Error(result?.error||'导出失败，请重试。');}
   if(response.headers.get('X-Enigma-Usage-Export')!=='1')throw new Error('当前服务尚不支持完整导出，请更新服务后重试。');
   const blob=await response.blob();if(controller.signal.aborted||exportRequest.current!==controller)return;
   const href=URL.createObjectURL(blob),link=document.createElement('a');link.href=href;link.download=`enigma-usage-${new Date().toISOString().slice(0,10)}.${format}`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(href),30000);
   setNotice('已生成当前筛选的完整记录，包含所有分页。');
  }catch(reason){if(!controller.signal.aborted)setExportError(reason instanceof Error?reason.message:'导出失败，请重试。');}
  finally{if(exportRequest.current===controller){exportRequest.current=null;setExporting(false);}}
 };
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
   {!sessionPath&&select('对话范围',session,[{value:'',label:'所有记录（含辅助任务）'},...sessions.map(s=>({value:s.path,label:sessionLabel(s)}))],setSession)}</>}
   {period==='custom'&&<><label className={styles.filter}>开始日期<input type="date" value={from} onChange={e=>change(setFrom)(e.target.value)}/></label><label className={styles.filter}>结束日期<input type="date" value={to} onChange={e=>change(setTo)(e.target.value)}/></label></>}
  </div>
  {error&&<p role="alert" className={styles.warning}>{error} <button onClick={()=>setRefresh(n=>n+1)}>重试</button></p>}
  {loading&&(!data||loadedKey!==resultKey)&&<p role="status">正在读取用量…</p>}
  {data&&loadedKey===resultKey&&!error&&<><UsageTotalsView value={data.totals}/><div className={styles.toolbar}><div className={styles.tabs} role="tablist" aria-label="用量分组" data-glass-segmented=""><GlassSelection selection={view}/>{(['models','daily','sources','records'] as const).map(id=><button key={id} role="tab" aria-selected={view===id} onClick={()=>setView(id)}>{{models:'按模型',daily:'按日期',sources:'按用途',records:'请求明细'}[id]}</button>)}</div>
    <details className={styles.exportMenu}><summary data-tooltip="导出当前筛选的全部保留记录，包含所有分页">{exporting?'正在生成…':'导出'}<AppIcon name="chevronDown" size={13}/></summary><div><button disabled={exporting} onClick={()=>void exportRecords('csv')}>CSV 表格</button><button disabled={exporting} onClick={()=>void exportRecords('json')}>JSON 完整统计</button></div></details></div>
    {exportError&&<p role="alert" className={styles.warning}>{exportError}</p>}{notice&&<p role="status" className={styles.note}>{notice}</p>}
    {view==='records'?<><div className={styles.tableWrap}><table><thead><tr><th>时间 / 模型</th><th>状态</th><th>输入</th><th>输出</th></tr></thead><tbody>{data.records.map(row=><Fragment key={row.requestId}><tr><th><button className={styles.recordToggle} aria-label={`请求明细 ${row.requestId}`} aria-expanded={expanded===row.requestId} data-tooltip="查看这次请求的耗时、缓存与思考用量" onClick={()=>setExpanded(expanded===row.requestId?null:row.requestId)}><span><time>{new Date(row.at).toLocaleString()}</time><small>{row.model}</small><small>{sourceName(row.source)} · {operationName(row.operation)}</small></span><AppIcon name="chevronRight" size={13}/></button></th><td>{statusName(row.status)}</td><td>{row.missingRequests?'未报告':number(row.input)}</td><td>{row.missingRequests?'未报告':number(row.output)}</td></tr>
      {expanded===row.requestId&&<tr><td colSpan={4}><dl className={styles.requestDetails}>
       <div><dt>请求耗时（含等待）</dt><dd>{row.durationMs==null?'未记录（没有请求起止记录）':`${(row.durationMs/1000).toLocaleString(undefined,{maximumFractionDigits:2})} 秒`}</dd></div>
       <div><dt>合计 token</dt><dd>{row.missingRequests?'未报告':number(row.total)}</dd></div>
       <div><dt>缓存读取 / 写入</dt><dd>{row.cacheReported?`${number(row.cacheRead)} / ${number(row.cacheWrite)}`:'未单独报告'}</dd></div>
       <div><dt>思考 token（已含在输出）</dt><dd>{row.reasoningReported?number(row.reasoning):'未单独报告'}</dd></div>
       <div><dt>开始</dt><dd>{row.startedAt?new Date(row.startedAt).toLocaleString():'未记录'}</dd></div>
       <div><dt>结束</dt><dd>{row.endedAt?new Date(row.endedAt).toLocaleString():'未记录'}</dd></div>
       <div className={styles.requestId}><dt>请求编号</dt><dd><code>{row.requestId}</code><button onClick={()=>{void navigator.clipboard.writeText(row.requestId).then(()=>setNotice('已复制请求编号。')).catch(()=>setExportError('复制失败，请选中请求编号后复制。'));}}>复制编号</button></dd></div>
      </dl></td></tr>}</Fragment>)}</tbody></table></div><div className={styles.pagination}><button disabled={!offset||loading} onClick={()=>setOffset(Math.max(0,offset-data.pagination.limit))}>上一页</button><span>{data.pagination.total?`${offset+1}–${Math.min(offset+data.pagination.limit,data.pagination.total)} / ${data.pagination.total}`:'0 条记录'}</span><button disabled={!data.pagination.hasMore||loading} onClick={()=>setOffset(offset+data.pagination.limit)}>下一页</button></div></>:<UsageGroupTable groups={view==='models'?data.models:view==='daily'?data.daily:data.sources.map(group=>({...group,label:sourceName(group.label)}))}/>}
    <p className={styles.note}>统计使用接口已报告的用量；实时估算不混入历史合计。按日期分组采用当前时区。{data.coverage.maximum?`本地最多保留 ${data.coverage.maximum.toLocaleString()} 条请求记录，当前 ${data.coverage.retained.toLocaleString()} 条。`:''}{data.coverage.atCapacity?'更早记录可能已移出保留范围，以上不是账户终身用量。':''}</p>
    <p className={styles.note}>{selectedSession?'按请求归属统计本对话，复制/分支带来的旧消息不会重复计费。':'辅助任务或没有对话归属的请求仍计入所有记录。'}计费以供应商账单为准。</p>
    <p className={styles.note}>{data.coverage.oldestAt&&`最早保留：${new Date(data.coverage.oldestAt).toLocaleString()} · `}更新于 {new Date(data.sampledAt).toLocaleTimeString()}</p>
  </>}
 </section>;
}
