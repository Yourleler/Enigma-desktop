import {expect,it} from 'vitest';
import {collectTurnUsage} from '../server/turn-usage.ts';

it('sums all model requests in the actual turn, including cached input and tool steps',()=>{
 const messages=[
  {role:'user',id:'u1',timestamp:1000},
  {role:'assistant',id:'a1',provider:'one',model:'m',timestamp:1100,usage:{input:100,output:10,cacheRead:30,cacheWrite:5}},
  {role:'toolResult',id:'t1',timestamp:1200},
  {role:'assistant',id:'a2',provider:'two',model:'n',timestamp:1300,usage:{input:200,output:20}},
  {role:'user',id:'u2',timestamp:1400},
  {role:'assistant',id:'a3',timestamp:1500},
 ];
 const usage=collectTurnUsage(messages);
 expect(usage.get(1)).toBe(usage.get(3));
 expect(usage.get(3)?.totals).toMatchObject({input:335,output:30,requests:2,cacheRead:30,cacheWrite:5,total:365});
 expect(usage.get(3)?.models.map(row=>row.label)).toEqual(['two/n','one/m']);
 expect(usage.get(5)?.totals).toMatchObject({requests:1,reportedRequests:0,missingRequests:1});
 expect(usage.get(5)?.startedAt).toBe(1400);
});

it('uses consumed hidden input attribution instead of guessing the nearest visible input',()=>{
 const usage=collectTurnUsage([
  {role:'user',id:'hidden',timestamp:1000},
  {role:'user',id:'visible',timestamp:2000},
  {role:'assistant',id:'a1',timestamp:3000,usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120,prompt_tokens_details:{cached_tokens:30}}},
  {role:'assistant',id:'a2',timestamp:4000,usage:{input:8,output:2}},
 ],new Map([['a1','hidden']]));
 expect(usage.get(2)?.startedAt).toBe(1000);
 expect(usage.get(2)?.totals.input).toBe(100);
 expect(usage.get(3)?.startedAt).toBe(2000);
 expect(usage.get(3)?.totals.input).toBe(8);
});
