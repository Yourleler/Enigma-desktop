import type {TurnUsage} from '../../../../shared/turn-usage';
import type {TokenMeterSnapshot} from '../../../../shared/token-meter-types';
export function turnUsageMeter(usage:TurnUsage|undefined):TokenMeterSnapshot|null {
  if(!usage)return null;
  const value=usage.totals;
  return {historical:true,missingRequests:value.missingRequests,state:'done',phase:'processing',runId:0,
    startedAt:usage.startedAt??0,endedAt:usage.endedAt,elapsedMs:usage.startedAt&&usage.endedAt?Math.max(0,usage.endedAt-usage.startedAt):0,
    model:usage.models.length===1?usage.models[0].label:null,requests:value.requests,
    up:{tokens:value.input,estimated:false},down:{tokens:value.output,estimated:false},rate:0,
    cacheRead:value.cacheRead,cacheWrite:value.cacheWrite,
    byModel:usage.models.map(row=>({model:row.label,requests:row.requests,input:row.input,output:row.output,cacheRead:row.cacheRead,cacheWrite:row.cacheWrite,inputEstimated:false,outputEstimated:false}))};
}
