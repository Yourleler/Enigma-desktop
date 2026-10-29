import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readObserverStatus, processIdentity } from './observer.js';
import { readJson,writeJson,redact } from './storage.js';
import { guardianConcern,type GuardianConfig,type GuardianStatus } from './guardian.js';
import {randomUUID} from 'node:crypto';

const parts:Buffer[]=[];for await(const part of process.stdin)parts.push(Buffer.from(part));
const input=JSON.parse(Buffer.concat(parts).toString()) as {origin:string;token:string;sessionPath:string;workspace:string;session:string;instanceId?:string;interventions?:number;restorePendingActions?:boolean};
const directory=process.argv[2]!;
const config=await readJson<GuardianConfig>(join(directory,'config.json'));
let stopped=false;
const identity=await processIdentity(process.pid);
const previous=input.restorePendingActions?await readJson<GuardianStatus>(join(directory,'status.json')).catch(()=>null):null;
const state:GuardianStatus={phase:'watching',updatedAt:new Date().toISOString(),pid:process.pid,processIdentity:identity.identity,instanceId:input.instanceId,interventions:input.interventions??0,events:[]};
let lastConcern='',lastDiagnosisAt=0,retryAt=0,failures=0;
let pendingAction=previous?.pendingAction;
if(pendingAction){state.pendingAction=pendingAction;state.diagnosis=previous?.diagnosis;}
let request:AbortController|null=null;
const stop=()=>{stopped=true;request?.abort();};process.on('SIGTERM',stop);process.on('SIGINT',stop);
const publish=async()=>{state.updatedAt=new Date().toISOString();await writeJson(join(directory,'status.json'),state);};
const event=(text:string,action?:string)=>{state.events.push({at:new Date().toISOString(),text,action});state.events=state.events.slice(-40);};
async function call(route:string,body:object){
  request=new AbortController();
  try{const response=await fetch(input.origin+'/api/enigma/guardian/'+route,{method:'POST',headers:{Authorization:`Bearer ${input.token}`,'Content-Type':'application/json'},body:JSON.stringify({sessionPath:input.sessionPath,...body}),signal:AbortSignal.any([request.signal,AbortSignal.timeout(route==='diagnose'?25000:15000)])});if(!response.ok)throw new Error('Host guardian request failed: '+response.status);return await response.json();}
  finally{request=null;}
}
await publish();
while(!stopped){
  try{
    const control=JSON.parse(await readFile(join(directory,'control.json'),'utf8'));if(control.action==='stop')break;
    const observation=await readObserverStatus(input.workspace,undefined,input.session);
    const concern=guardianConcern(observation,config.stageDeadlineMs);
    const concernKey=concern?JSON.stringify({kind:concern.kind,run:observation.available?observation.run:null,stages:observation.available?observation.stages.map(stage=>({stage:stage.stage,id:stage.id})):[],progress:observation.available?observation.lastProgress:null}):'';
    if((pendingAction||concern&&(concernKey!==lastConcern||retryAt>0&&Date.now()>=retryAt))&&Date.now()>=retryAt&&Date.now()-lastDiagnosisAt>1000){
      if(!pendingAction){lastConcern=concernKey;state.phase='diagnosing';event(concern!.reason);}lastDiagnosisAt=Date.now();await publish();
      try{
        const diagnosis=pendingAction?state.diagnosis!:await call('diagnose',{question:`当前任务出现 ${concern!.kind}：${concern!.reason}。请核对任务、工具、依赖、模型、压缩、展示或采集问题，给出合适的恢复建议。`,concern});state.diagnosis=diagnosis;
        if(stopped)break;
        if(pendingAction||config.mode==='managed'&&config.allowedActions.includes(diagnosis.action)&&state.interventions<config.maxInterventions){
          state.phase='intervening';await publish();
          pendingAction??={requestId:randomUUID(),action:diagnosis.action,reason:diagnosis.answer,observationId:observation.available?observation.id:undefined,run:observation.available?observation.run:undefined};
          state.pendingAction=pendingAction;await publish();
          const result=await call('act',pendingAction);
          state.interventions=Number.isSafeInteger(result.interventions)?result.interventions:state.interventions+1;event(result.message||'干预已核对',pendingAction.action);state.phase=result.needsUser?'waiting-user':'watching';pendingAction=undefined;delete state.pendingAction;lastConcern=concernKey;
        }else{state.phase=concern?.kind==='approval'?'waiting-user':'watching';event(diagnosis.answer,'suggestion');}
        failures=0;retryAt=0;
      }catch(error){if(stopped)break;state.phase='host-unavailable';failures++;retryAt=Date.now()+Math.min(30000,2000*2**Math.min(failures-1,4));event('宿主无法响应，稍后将重新核对；保留观测与接管记录：'+redact(String(error),[input.token]));}
    }else if(!concern&&!pendingAction){lastConcern='';failures=0;retryAt=0;state.phase='watching';}
    await publish();
  }catch(error){event('监护读取失败：'+redact(String(error),[input.token]));await publish();}
  await delay(2000);
}
state.phase='stopped';await publish();
