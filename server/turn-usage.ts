import {normalizeLlmUsage} from '../lib/llm/usage-observer.ts';
import {groupUsage,summarizeUsage} from '../shared/usage-summary.ts';
import {timeMillis} from '../shared/session-timing.ts';
import type {TurnUsage} from '../shared/turn-usage.ts';
import {isCustomTurnInputHistoryMessage} from '../lib/turn-input-presentation.ts';

/** Full-branch aggregation precedes paging. Copied history describes its
 * original messages and is never added to the billing ledger. */
export function collectTurnUsage(messages:any[],consumedInputs:Map<string,string>=new Map()):Map<number,TurnUsage> {
  const starts=new Map<string,number|null>();
  const groups=new Map<string,{startedAt:number|null;endedAt:number|null;rows:any[];indices:number[]}>();
  let latest:string|null=null;
  for(let index=0;index<messages.length;index++){
    const message=messages[index];
    if(message.role==='user'||isCustomTurnInputHistoryMessage(message)){
      latest=message.id||`source-${index}`;starts.set(latest!,timeMillis(message.timestamp));
    }else if(message.role==='assistant'){
      const key=consumedInputs.get(message.id)||latest||`orphan-${index}`;
      const group=groups.get(key)||{startedAt:starts.get(key)??null,endedAt:null,rows:[],indices:[]};
      group.endedAt=timeMillis(message.timestamp)??group.endedAt;
      group.indices.push(index);
      group.rows.push({model:`${message.provider||'unknown'}/${message.model||'unknown'}`,status:message.stopReason,usage:normalizeLlmUsage(message.usage)});
      groups.set(key,group);
    }
  }
  const result=new Map<number,TurnUsage>();
  for(const group of groups.values()){
    const value={startedAt:group.startedAt,endedAt:group.endedAt,totals:summarizeUsage(group.rows),models:groupUsage(group.rows,row=>row.model)};
    for(const index of group.indices)result.set(index,value);
  }
  return result;
}
