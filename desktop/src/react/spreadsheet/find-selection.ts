import type {IRange} from '@univerjs/core';
import type {IFindReplaceService} from '@univerjs/preset-sheets-find-replace';
export interface FoundCell {unitId:string;sheetId:string;range:IRange}

/** The service emits a null match before it announces that find is closed. */
export function onFindClosed(service:IFindReplaceService, select:(match:FoundCell)=>void) {
  let open=false,last:FoundCell|null=null,revision=0,disposed=false;
  const matches=service.currentMatch$.subscribe(match=>{
    const current=++revision,value=match?.range as {subUnitId?:string;range?:IRange}|undefined;
    if(match&&typeof value?.subUnitId==='string'&&value.range){last={unitId:match.unitId,sheetId:value.subUnitId,range:{...value.range}};return;}
    // Keep the previous match for the synchronous close notification. A real
    // empty search clears it by the end of this turn, so stale matches aren't selected.
    queueMicrotask(()=>{if(!disposed&&revision===current)last=null;});
  });
  const states=service.state$.subscribe(state=>{
    const closing=open&&!state.revealed;open=state.revealed;
    if(closing&&last){const match=last;last=null;select(match);}
  });
  return {dispose(){disposed=true;matches.unsubscribe();states.unsubscribe();}};
}
