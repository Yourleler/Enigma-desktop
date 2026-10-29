import {expect,it,vi} from 'vitest';
import {createUsageLedger} from '../lib/llm/usage-ledger';
import {queryUsageSummary} from '../server/usage-summary';
const context=(sessionId='a',sessionPath='/a')=>({source:{subsystem:'session',operation:'reply'},attribution:{kind:'session',sessionId,sessionPath}});
it('reuses unchanged history but invalidates on append, retention changes and clear',()=>{
 const ledger=createUsageLedger(); const list=vi.spyOn(ledger,'list');
 ledger.record({usageContext:context(),usage:{input:2,output:1}});
 const first=queryUsageSummary(ledger,{timeZone:'UTC'});
 const repeated=queryUsageSummary(ledger,{timeZone:'UTC'});
 expect(list).toHaveBeenCalledTimes(1); expect(repeated.totals).toEqual(first.totals);
 repeated.totals.requests=999; expect(queryUsageSummary(ledger,{timeZone:'UTC'}).totals.requests).toBe(1);
 ledger.record({usageContext:context(),usage:{input:4,output:1}});
 expect(queryUsageSummary(ledger,{timeZone:'UTC'}).totals.requests).toBe(2); expect(list).toHaveBeenCalledTimes(2);
 ledger.setMaxEntries(10000); expect(queryUsageSummary(ledger,{timeZone:'UTC'}).coverage.maximum).toBe(10000);
 ledger.clear(); expect(queryUsageSummary(ledger,{timeZone:'UTC'}).totals.requests).toBe(0);
});
it('isolates cached filters, sessions and ledger instances',()=>{
 const ledger=createUsageLedger(); const other=createUsageLedger();
 ledger.record({usageContext:context(),model:{provider:'test',id:'a'},usage:{input:2,output:1}});
 ledger.record({usageContext:context('b','/b'),model:{provider:'test',id:'b'},usage:{input:4,output:1}});
 const a=queryUsageSummary(ledger,{}, {sessionId:'a',sessionPath:'/a'});
 expect(a.totals.requests).toBe(1);
 expect(queryUsageSummary(ledger,{}, {sessionId:'b',sessionPath:'/b'}).totals.total).not.toBe(a.totals.total);
 expect(queryUsageSummary(ledger,{model:'test/missing'}).totals.requests).toBe(0);
 expect(queryUsageSummary(other,{}).totals.requests).toBe(0);
 expect(queryUsageSummary(ledger,{}).totals.requests).toBe(2);
});
it('sums all retained records before pagination, deduplicates grouping and counts cache only once',()=>{
 let now=Date.parse('2026-10-28T01:00:00Z');const ledger=createUsageLedger({now:()=>now++});
 for(let n=0;n<80;n++)ledger.record({usageContext:context(),model:{provider:'test',id:n%2?'fast':'large'},usage:{input:10,output:2,cacheRead:8,cacheWrite:0,totalTokens:20}});
 const report=queryUsageSummary(ledger,{}, {sessionId:'a',sessionPath:'/moved'});
 expect(report.totals).toMatchObject({requests:80,input:1440,output:160,total:1600,cacheRead:640});expect(report.records).toHaveLength(50);expect(report.models).toHaveLength(2);
 const second=queryUsageSummary(ledger,{offset:'50'},{sessionId:'a',sessionPath:'/a'});expect(second.records).toHaveLength(30);expect(second.totals).toEqual(report.totals);
});
it('filters dates models session and status, preserving missing usage and failed usage',()=>{
 let now=Date.parse('2026-10-27T16:01:00Z');const ledger=createUsageLedger({now:()=>now++});
 ledger.record({usageContext:context(),model:{provider:'test',id:'fast'},usage:{prompt_tokens:20,completion_tokens:5,total_tokens:25,prompt_tokens_details:{cached_tokens:10}}});
 ledger.record({usageContext:context('b','/b'),model:{provider:'test',id:'large'},usage:{input:100,output:20}});
 const request=ledger.start({usageContext:context(),model:{provider:'test',id:'fast'}});ledger.recordError(request.requestId,new Error('aborted'),'aborted',{usage:{input:5,output:1}});
 ledger.record({usageContext:context(),model:{provider:'test',id:'fast'},usage:null});
 const result=queryUsageSummary(ledger,{timeZone:'Asia/Shanghai',since:'2026-10-27T16:00:00Z',until:'2026-10-28T16:00:00Z',model:'test/fast'},{sessionId:'a',sessionPath:'/a'});
 expect(result.totals).toMatchObject({requests:3,reportedRequests:2,missingRequests:1,failedRequests:1,input:25,output:6,total:31});expect(result.daily[0].key).toBe('2026-10-28');
 expect(queryUsageSummary(ledger,{status:'aborted'}).totals.requests).toBe(1);
 expect(()=>queryUsageSummary(ledger,{since:'bad'})).toThrow('日期');
 expect(()=>queryUsageSummary(ledger,{since:'2026-11-01',until:'2026-10-01'})).toThrow('结束日期');
});
