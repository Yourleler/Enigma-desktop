import {groupUsage,summarizeUsage} from '../shared/usage-summary.ts';

// The UI polls every five seconds. Retention may hold 100k records; unchanged
// ledgers should not repeatedly clone, sort and format the entire history.
const summaries = new WeakMap<object, { revision: number; queries: Map<string, any> }>();
const MAX_CACHED_QUERIES = 12;

/** Aggregate the full retained set, never the first page of a request list. */
export function queryUsageSummary(ledger:any,query:Record<string,string>,session?:{sessionId?:string|null;sessionPath:string}){
  const dates:Record<string,string>={};
  for(const key of ['since','until'])if(query[key]){const ms=Date.parse(query[key]);if(!Number.isFinite(ms))throw new Error('请选择有效的日期范围');dates[key]=new Date(ms).toISOString();}
  if(dates.since&&dates.until&&dates.since>=dates.until)throw new Error('结束日期必须晚于开始日期');
  const revision = ledger.revision?.();
  const cacheKey = JSON.stringify([
    session?.sessionId, session?.sessionPath,
    ...['since','until','model','source','agent','status','offset','timeZone'].map(key => query[key] || ''),
  ]);
  let cache = Number.isSafeInteger(revision) ? summaries.get(ledger) : undefined;
  if (Number.isSafeInteger(revision) && cache?.revision !== revision) {
    cache = { revision, queries: new Map() }; summaries.set(ledger, cache);
  }
  if (cache?.queries.has(cacheKey)) {
    const cached = cache.queries.get(cacheKey);
    cache.queries.delete(cacheKey); cache.queries.set(cacheKey, cached);
    return { ...structuredClone(cached), sampledAt: Date.now() };
  }
  const stored=ledger.list({}).entries;
  const context=stored.filter((entry:any)=>!session||entry.attribution?.sessionId===session.sessionId&&!!session.sessionId||entry.attribution?.sessionPath===session.sessionPath);
  const models=[...new Set(context.map((entry:any)=>`${entry.model?.provider||'unknown'}/${entry.model?.modelId||'unknown'}`))].sort();
  const sources=[...new Set(context.map((entry:any)=>entry.source?.subsystem||'unknown'))].sort();
  const agents=[...new Set(context.map((entry:any)=>entry.attribution?.agentId).filter(Boolean))].sort();
  const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:query.timeZone||'UTC',year:'numeric',month:'2-digit',day:'2-digit'});
  const entries=context.filter((entry:any)=>{
    const at=entry.endedAt||entry.startedAt;
    return (!dates.since||at>=dates.since)&&(!dates.until||at<dates.until)
      &&(!query.model||`${entry.model?.provider||'unknown'}/${entry.model?.modelId||'unknown'}`===query.model)
      &&(!query.source||entry.source?.subsystem===query.source)&&(!query.agent||entry.attribution?.agentId===query.agent)
      &&(!query.status||entry.status===query.status);
  });
  const offset=Math.max(0,Number.parseInt(query.offset||'0',10)||0),limit=50;
  const recent=[...entries].sort((a,b)=>String(b.endedAt||b.startedAt).localeCompare(String(a.endedAt||a.startedAt)));
  const result = {totals:summarizeUsage(entries),models:groupUsage(entries,e=>`${e.model?.provider||'unknown'}/${e.model?.modelId||'unknown'}`),
    daily:groupUsage(entries,e=>dayFormat.format(new Date(e.endedAt||e.startedAt))).sort((a,b)=>a.key.localeCompare(b.key)),
    sources:groupUsage(entries,e=>e.source?.subsystem||'unknown'),choices:{models,sources,agents},
    records:recent.slice(offset,offset+limit).map(e=>({requestId:e.requestId,at:e.endedAt||e.startedAt,model:`${e.model?.provider||'unknown'}/${e.model?.modelId||'unknown'}`,source:e.source?.subsystem||'unknown',operation:e.source?.operation||'',status:e.status,...summarizeUsage([e])})),
    pagination:{offset,limit,total:entries.length,hasMore:offset+limit<entries.length},
    coverage:ledger.coverage?.()||{retained:stored.length},scope:session?'session':'history',sampledAt:Date.now()};
  if (cache) {
    if (cache.queries.size >= MAX_CACHED_QUERIES) cache.queries.delete(cache.queries.keys().next().value);
    cache.queries.set(cacheKey, structuredClone(result));
  }
  return result;
}
