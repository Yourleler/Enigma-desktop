export interface UsageTotals {
  requests:number; reportedRequests:number; missingRequests:number; failedRequests:number;
  input:number; output:number; cacheRead:number; cacheWrite:number; reasoning:number; reasoningReported:number; total:number;
}
export interface UsageGroup extends UsageTotals {key:string;label:string}
export function emptyUsageTotals():UsageTotals {return {requests:0,reportedRequests:0,missingRequests:0,failedRequests:0,input:0,output:0,cacheRead:0,cacheWrite:0,reasoning:0,reasoningReported:0,total:0};}
const num=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?Math.max(0,value):0;
export function summarizeUsage(entries:any[]):UsageTotals {
  const totals=emptyUsageTotals();
  for(const entry of entries){
    totals.requests++;if(['error','aborted'].includes(entry.status))totals.failedRequests++;
    const usage=entry.usage;
    if(!usage){totals.missingRequests++;continue;}
    totals.reportedRequests++;
    const output=num(usage.output?.totalTokens),total=num(usage.totalTokens);
    // Canonical total covers input and output including cached prompt tokens.
    const input=Math.max(num(usage.input?.totalTokens),total-output);
    totals.input+=input;totals.output+=output;totals.total+=input+output;
    totals.cacheRead+=num(usage.cache?.readTokens);totals.cacheWrite+=num(usage.cache?.writeTokens);
    if(typeof usage.output?.reasoningTokens==='number'){totals.reasoning+=num(usage.output.reasoningTokens);totals.reasoningReported++;}
  }
  return totals;
}
export function groupUsage(entries:any[],key:(entry:any)=>string):UsageGroup[]{
  const groups=new Map<string,any[]>();for(const entry of entries){const id=key(entry);const group=groups.get(id)||[];group.push(entry);groups.set(id,group);}
  return [...groups].map(([id,entries])=>({key:id,label:id,...summarizeUsage(entries)})).sort((a,b)=>b.total-a.total||a.key.localeCompare(b.key));
}
