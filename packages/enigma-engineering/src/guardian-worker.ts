import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readObserverStatus } from './observer.js';
import { readJson,writeJson,redact } from './storage.js';
import { guardianConcern,type GuardianConfig,type GuardianStatus } from './guardian.js';

const parts:Buffer[]=[];for await(const part of process.stdin)parts.push(Buffer.from(part));
const input=JSON.parse(Buffer.concat(parts).toString()) as {origin:string;token:string;sessionPath:string;workspace:string;session:string};
const directory=process.argv[2]!;
const config=await readJson<GuardianConfig>(join(directory,'config.json'));
let stopped=false;process.on('SIGTERM',()=>{stopped=true;});process.on('SIGINT',()=>{stopped=true;});
const state:GuardianStatus={phase:'watching',updatedAt:new Date().toISOString(),pid:process.pid,interventions:0,events:[]};
let lastConcern='',lastDiagnosisAt=0;
const publish=async()=>{state.updatedAt=new Date().toISOString();await writeJson(join(directory,'status.json'),state);};
const event=(text:string,action?:string)=>{state.events.push({at:new Date().toISOString(),text,action});state.events=state.events.slice(-40);};
async function call(route:string,body:object){const response=await fetch(input.origin+'/api/enigma/guardian/'+route,{method:'POST',headers:{Authorization:`Bearer ${input.token}`,'Content-Type':'application/json'},body:JSON.stringify({sessionPath:input.sessionPath,...body}),signal:AbortSignal.timeout(route==='diagnose'?25000:15000)});if(!response.ok)throw new Error('Host guardian request failed: '+response.status);return response.json();}
await publish();
while(!stopped){
  try{
    const control=JSON.parse(await readFile(join(directory,'control.json'),'utf8'));if(control.action==='stop')break;
    const observation=await readObserverStatus(input.workspace,undefined,input.session);
    const concern=guardianConcern(observation,config.stageDeadlineMs);
    const concernKey=concern?JSON.stringify({kind:concern.kind,run:observation.available?observation.run:null,stages:observation.available?observation.stages.map(stage=>({stage:stage.stage,id:stage.id})):[],progress:observation.available?observation.lastProgress:null}):'';
    if(concern&&concernKey!==lastConcern&&Date.now()-lastDiagnosisAt>1000){
      lastConcern=concernKey;lastDiagnosisAt=Date.now();state.phase='diagnosing';event(concern.reason);await publish();
      try{
        const diagnosis=await call('diagnose',{question:`当前任务出现 ${concern.kind}：${concern.reason}。请核对任务、工具、依赖、模型、压缩、展示或采集问题，给出合适的恢复建议。`,concern});state.diagnosis=diagnosis;
        if(config.mode==='managed'&&config.allowedActions.includes(diagnosis.action)&&state.interventions<config.maxInterventions){
          state.phase='intervening';await publish();
          const result=await call('act',{action:diagnosis.action,reason:diagnosis.answer,observationId:observation.available?observation.id:undefined,run:observation.available?observation.run:undefined});
          state.interventions++;event(result.message||'干预已核对',diagnosis.action);state.phase=result.needsUser?'waiting-user':'watching';
        }else{state.phase=concern.kind==='approval'?'waiting-user':'watching';event(diagnosis.answer,'suggestion');}
      }catch(error){state.phase='host-unavailable';event('宿主无法响应，独立管家仍保留观测和接管记录：'+redact(String(error),[input.token]));}
    }else if(!concern){lastConcern='';state.phase='watching';}
    await publish();
  }catch(error){event('监护读取失败：'+redact(String(error),[input.token]));await publish();}
  await delay(2000);
}
state.phase='stopped';await publish();
