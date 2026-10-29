/** Durable local journal + conditional server writes. No editor text is lost on a failed request. */
import type {JSONContent} from '@tiptap/core';
import {create} from 'zustand';
import {hanaFetch} from '../hooks/use-hana-fetch';
import {hasServerConnection} from '../services/server-connection';
import {useStore} from './index';
import {resolveWorkspaceUiSurface} from './workspace-ui-state-actions';
import {registerDraftSyncListener} from './input-draft-sync';
import {HOME_DRAFT_KEY,hasInputDraftDocumentContent} from '../../../../shared/input-drafts.ts';
import {DraftRecoveryJournal,type DraftRecord} from './draft-recovery-journal';

type Entry={text:string;doc?:JSONContent|null}|null;
export interface DraftSaveStatus {state:'pending'|'saved'|'offline'|'conflict'|'local-error'|'unsupported'|'rejected';remote?:Entry;revision?:number;localDurable?:boolean}
export const useDraftSaveState=create<{items:Record<string,DraftSaveStatus>}>(()=>({items:{}}));
const pending=new Map<string,DraftRecord>(),revisions=new Map<string,number>(),timers=new Map<string,ReturnType<typeof setTimeout>>(),inflight=new Map<string,string>(),failures=new Map<string,number>(),durability=new Map<string,boolean>();
let generation=0;
let scope='',tab='',ready=false,journal:DraftRecoveryJournal|null=null,cleanupRuntime:(()=>void)|undefined;
let hydration:Promise<void>|null=null;
function endpointIdentity(url:string|undefined):string {if(!url)return 'local';try{const u=new URL(url);return u.origin+u.pathname;}catch{return 'unresolved';}}
function currentScope():string {
  const s=useStore.getState(),c=s.activeServerConnection;
  if(!hasServerConnection(s))return '';
  // Stable identity survives local port/token rotation. Credentials never enter the recovery journal.
  return JSON.stringify([c?.serverId||s.activeServerConnectionId||'local',c?.studioId||'',c?.userId||'',c?.kind==='local'?'local':endpointIdentity(c?.baseUrl),resolveWorkspaceUiSurface()]);
}
function requestScope():string {const s=useStore.getState();return JSON.stringify([currentScope(),s.activeServerConnection?.token,s.serverToken,s.serverPort]);}
function setStatus(key:string,value:DraftSaveStatus){useDraftSaveState.setState(s=>({items:{...s.items,[key]:{...value,localDurable:durability.get(key)}}}));}
function id(){return crypto.randomUUID();}
function apply(key:string,entry:Entry){
  const s=useStore.getState(),drafts={...s.drafts,[key]:entry?.text||''},draftDocs={...s.draftDocs};
  if(entry?.doc)draftDocs[key]=entry.doc;else delete draftDocs[key];
  useStore.setState({drafts,draftDocs,draftsHydratedAt:Date.now()});
}
function sameEntry(a:Entry,b:Entry){const normalized=(entry:Entry)=>!entry?.text.trim()&&!hasInputDraftDocumentContent(entry?.doc)?null:entry;const left=normalized(a),right=normalized(b);return (left?.text||'')===(right?.text||'')&&JSON.stringify(left?.doc||null)===JSON.stringify(right?.doc||null);}
function storeRecord(record:DraftRecord,previous?:DraftRecord):boolean {
  try{if(!journal)throw Error('Local recovery storage unavailable');journal.write(record,previous);durability.set(record.key,true);return true;}
  catch{durability.set(record.key,false);setStatus(record.key,{state:'local-error'});return false;}
}
function clearTimer(key:string){const timer=timers.get(key);if(timer)clearTimeout(timer);timers.delete(key);}
function schedule(key:string,delay=500){clearTimer(key);timers.set(key,setTimeout(()=>{timers.delete(key);void push(key);},delay));}
function switchScope(){
  const next=currentScope();if(next===scope)return;const previousScope=scope;generation++;
  for(const key of timers.keys())clearTimer(key);pending.clear();revisions.clear();inflight.clear();failures.clear();durability.clear();ready=false;hydration=null;scope=next;
  useDraftSaveState.setState({items:{}});
  // Do not carry home/session text into another server's workspace.
  if(previousScope)useStore.setState({drafts:{},draftDocs:{},draftsHydratedAt:Date.now()});
  if(!scope)return;
  try{
    const records=journal?.list(scope)||[];
    for(const record of records.sort((a,b)=>Number(b.tab===tab)-Number(a.tab===tab)||b.updatedAt-a.updatedAt)){
      if(pending.has(record.key))continue;pending.set(record.key,record);durability.set(record.key,true);if(!Object.prototype.hasOwnProperty.call(useStore.getState().drafts,record.key))apply(record.key,record);setStatus(record.key,{state:'offline'});
    }
  }catch{/* A storage read failure must not clear the editor. */}
}
function recordChange(key:string,text:string,doc:JSONContent|null){
  switchScope();if(!scope)return;
  const previous=pending.get(key),record:DraftRecord={id:id(),scope,tab,key,text,doc,updatedAt:Date.now(),baseRevision:previous?.baseRevision??revisions.get(key)};
  pending.set(key,record);
  const local=storeRecord(record,previous);
  const prior=useDraftSaveState.getState().items[key];
  if(prior?.state==='conflict'){setStatus(key,{...prior,state:local?'conflict':'local-error'});return;}
  if(local)setStatus(key,{state:'pending'});schedule(key);
}
async function push(key:string,keepalive=false):Promise<void>{
  const record=pending.get(key);if(!record||record.scope!==scope||scope!==currentScope()||inflight.has(key))return;
  if(!ready){await hydrateInputDrafts();return;}
  const status=useDraftSaveState.getState().items[key];if(status?.state==='conflict'||status?.state==='unsupported'||status?.state==='rejected')return;
  const request=requestScope(),epoch=generation,operation=id();inflight.set(key,operation);
  const body={surface:resolveWorkspaceUiSurface(),text:record.text,doc:record.doc,expectedRevision:record.baseRevision??revisions.get(key)??0,
    ...(key===HOME_DRAFT_KEY?{scope:'home'}:key.includes('/')||key.includes('\\')?{sessionPath:key}:{sessionId:key})};
  try{
    const response=await hanaFetch('/api/input-drafts',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),throwOnHttpError:false,timeout:10000,keepalive});
    const result=await response.json();if(epoch!==generation||request!==requestScope()||record.scope!==scope)return;
    if(response.status===409&&result.conflict){
      if(!sameEntry(result.entry,record)){setStatus(key,{state:'conflict',remote:result.entry,revision:result.revision});return;}
    }else if(!response.ok){if(response.status===400||response.status===413){setStatus(key,{state:'rejected'});return;}throw Error('Draft not acknowledged');}
    if(!Number.isSafeInteger(result.revision)) {setStatus(key,{state:'unsupported'});return;}
    failures.delete(key);revisions.set(key,result.revision);
    const latest=pending.get(key);
    if(latest?.id===record.id){pending.delete(key);try{journal?.remove(record);}catch{}setStatus(key,{state:'saved'});}
    else if(latest){latest.baseRevision=result.revision;storeRecord(latest);schedule(key,0);}
  }catch{
    if(epoch===generation&&request===requestScope()&&record.scope===scope){if(useDraftSaveState.getState().items[key]?.state!=='local-error')setStatus(key,{state:'offline'});const count=(failures.get(key)||0)+1;failures.set(key,count);schedule(key,Math.min(60000,5000*2**Math.min(count-1,4)));}
  }finally{if(inflight.get(key)===operation)inflight.delete(key);}
}
export function retryInputDraft(key:string){if(pending.has(key)){setStatus(key,{state:'pending'});schedule(key,0);}}
export function flushInputDrafts(){for(const key of pending.keys()){clearTimer(key);void push(key,true);}}
export function getDraftRecoveryCopies(key:string):DraftRecord[]{try{return journal?.list(scope).filter(r=>r.key===key)||[];}catch{return [];}}
export function chooseDraftVersion(key:string,choice:'local'|'remote'){
  const status=useDraftSaveState.getState().items[key],record=pending.get(key);if(!record||status?.revision===undefined)return;
  if(choice==='remote'){
    pending.delete(key);try{journal?.remove(record);}catch{}revisions.set(key,status.revision);apply(key,status.remote||null);setStatus(key,{state:'saved'});
  }else{record.baseRevision=status.revision;storeRecord(record);setStatus(key,{state:'pending'});schedule(key,0);}
}
export function restoreDraftCopy(record:DraftRecord){
  if(record.scope!==scope)return;apply(record.key,record);recordChange(record.key,record.text,record.doc);
}
/** Only unedited keys hydrate from the server; a local pending deletion also counts as an edit. */
export async function hydrateInputDrafts():Promise<void>{
  switchScope();if(!scope)return;if(hydration)return hydration;
  const startedScope=scope,request=requestScope(),epoch=generation;
  const task=(async()=>{
    try{
      const response=await hanaFetch(`/api/input-drafts?surface=${resolveWorkspaceUiSurface()}`,{timeout:10000});
      const data=await response.json();if(epoch!==generation||startedScope!==scope||request!==requestScope())return;
      ready=data.protocol===2;
      const entries:Record<string,Entry>={[HOME_DRAFT_KEY]:data.home||null,...data.sessions};
      for(const key of new Set([...Object.keys(entries),...Object.keys(data.revisions||{}),...pending.keys()])){
        const local=pending.get(key),remote=entries[key]||null,revision=Number.isSafeInteger(data.revisions?.[key])?data.revisions[key]:0;
        const current=useStore.getState(),hasMemory=Object.prototype.hasOwnProperty.call(current.drafts,key);
        if(local){
          if(!ready){setStatus(key,{state:'unsupported'});continue;}
          if(local.baseRevision===undefined){
            local.baseRevision=revision;storeRecord(local);
            if(remote&&!sameEntry(remote,local)){setStatus(key,{state:'conflict',remote,revision});continue;}
          }
          if(useDraftSaveState.getState().items[key]?.state!=='conflict')schedule(key,0);
        }else if(!hasMemory){revisions.set(key,revision);if(remote)apply(key,remote);}
        else if(sameEntry({text:current.drafts[key],doc:current.draftDocs[key]},remote))revisions.set(key,revision);
        // A focus/reconnect read must never advance the base revision under an
        // editor still showing another version; its next write must conflict.

      }
      useStore.setState({draftsHydratedAt:Date.now()});
    }catch{if(epoch===generation&&startedScope===scope){for(const key of pending.keys()){if(useDraftSaveState.getState().items[key]?.state!=='local-error')setStatus(key,{state:'offline'});schedule(key,5000);}}}
  })();
  hydration=task;try{await task;}finally{if(hydration===task)hydration=null;}
}
/** Idempotent setup; dispose is also used by tests and hot reload. */
export function initInputDraftPersistence():()=>void {
  cleanupRuntime?.();scope='';ready=false;
  try{journal=new DraftRecoveryJournal(localStorage);tab=sessionStorage.getItem('enigma-draft-tab')||id();sessionStorage.setItem('enigma-draft-tab',tab);}catch{journal=null;tab=id();}
  switchScope();registerDraftSyncListener({onSet:recordChange,onClear:key=>recordChange(key,'',null)});
  const retry=()=>{switchScope();void hydrateInputDrafts();};
  const hidden=()=>{if(document.hidden)flushInputDrafts();};
  window.addEventListener('online',retry);window.addEventListener('focus',retry);window.addEventListener('pagehide',flushInputDrafts);document.addEventListener('visibilitychange',hidden);
  let lastRequestScope=requestScope();
  const unsubscribe=useStore.subscribe((s,previous)=>{const next=requestScope();if(next!==lastRequestScope||s.connected&&!previous.connected){lastRequestScope=next;queueMicrotask(retry);}});
  cleanupRuntime=()=>{generation++;for(const key of timers.keys())clearTimer(key);unsubscribe();registerDraftSyncListener(null);window.removeEventListener('online',retry);window.removeEventListener('focus',retry);window.removeEventListener('pagehide',flushInputDrafts);document.removeEventListener('visibilitychange',hidden);pending.clear();revisions.clear();inflight.clear();scope='';ready=false;hydration=null;cleanupRuntime=undefined;};
  return cleanupRuntime;
}
