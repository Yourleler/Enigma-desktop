import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {submitDesktopSessionMessage,submitDesktopSessionInterjection} from './desktop-session-submit.ts';

type Item={id:string;text:string;doc:any;payload:any;state:'queued'|'sending'|'failed'|'unknown';error?:string;createdAt:number};
type Queue={sessionPath:string;paused:boolean;items:Item[];revision:number};
const services=new WeakMap<object,DesktopInputQueue>();
export function desktopInputQueue(engine:any){let service=services.get(engine);if(!service){service=new DesktopInputQueue(engine);services.set(engine,service);}return service;}
/** Pending user input remains editable until claimed for delivery; never replay an uncertain send. */
export class DesktopInputQueue{
 private queues=new Map<string,Queue>();private locks=new Map<string,Promise<unknown>>();private active=new Set<string>();
 private engine:any;
 constructor(engine:any){
  this.engine=engine;
  engine.subscribe?.((event:any,sessionPath:string)=>{if(event.type==='turn_end'&&event.aborted&&this.queues.has(sessionPath))void this.change(sessionPath,queue=>{queue.paused=true;});});
  const timer=setInterval(()=>{for(const sessionPath of this.queues.keys())void this.flush(sessionPath).catch(()=>{});},1000);timer.unref?.();
 }
 private file(sessionPath:string){return path.join(this.engine.hanakoHome,'input-queue',createHash('sha256').update(sessionPath).digest('hex')+'.json');}
 private async load(sessionPath:string){
  let queue=this.queues.get(sessionPath);if(queue)return queue;
  try{const value=JSON.parse(await fs.readFile(this.file(sessionPath),'utf8'));if(value.sessionPath!==sessionPath||!Array.isArray(value.items))throw Error('Invalid input queue');queue={...value,paused:true,items:value.items.map((item:Item)=>item.state==='sending'?{...item,state:'unknown',error:'发送时应用退出，请核对对话后再处理'}:item)};}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;queue={sessionPath,paused:false,items:[],revision:0};}
  this.queues.set(sessionPath,queue!);return queue!;
 }
 private change<T>(sessionPath:string,fn:(queue:Queue)=>T|Promise<T>):Promise<T>{
  const previous=this.locks.get(sessionPath)||Promise.resolve();
  const next=previous.catch(()=>{}).then(async()=>{const queue=await this.load(sessionPath),result=await fn(queue);queue.revision++;const file=this.file(sessionPath);await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(queue),{mode:0o600});await fs.rename(temp,file);return result;});
  this.locks.set(sessionPath,next);return next.finally(()=>{if(this.locks.get(sessionPath)===next)this.locks.delete(sessionPath);});
 }
 async read(sessionPath:string){await (this.locks.get(sessionPath)||Promise.resolve()).catch(()=>{});const queue=await this.load(sessionPath);return {paused:queue.paused,revision:queue.revision,items:queue.items.map(({payload,doc,...item})=>item)};}
 async add(sessionPath:string,body:any){
  if(typeof body?.payload?.text!=='string'||!body.payload.text.trim()||typeof body.text!=='string'||JSON.stringify(body).length>12_000_000)throw Error('排队消息为空或过大');
  if(body.payload.agentReviewRequests?.length)throw Error('指定助手的审查任务请直接发送');
  return this.change(sessionPath,queue=>{
   if(queue.items.length>=20)throw Error('最多排队20条消息');
   const payload:any={sessionPath};for(const key of ['text','images','videos','audios','clientMessageId','displayMessage','sessionFileRefs','uiContext'])if(body.payload[key]!==undefined)payload[key]=body.payload[key];
   const item:Item={id:randomUUID(),text:body.text,doc:body.doc,payload,state:'queued',createdAt:Date.now()};queue.items.push(item);return {id:item.id};
  });
 }
 async update(sessionPath:string,body:any){
  return this.change(sessionPath,queue=>{
   if(body.action==='pause'){queue.paused=body.paused===true;return {ok:true};}
   const index=queue.items.findIndex(item=>item.id===body.id),item=queue.items[index];if(!item)throw Error('这条消息已发送或已移除');
   if(item.state==='sending')throw Error('消息已经开始发送，不能再编辑或撤回');
   if(body.action==='remove'||body.action==='recall'){queue.items.splice(index,1);return body.action==='recall'?{text:item.text,doc:item.doc,attachments:item.payload.displayMessage?.attachments||[]}: {ok:true};}
   if(body.action==='move'){if(!Number.isInteger(body.index))throw Error('顺序无效');queue.items.splice(index,1);queue.items.splice(Math.max(0,Math.min(queue.items.length,body.index)),0,item);return {ok:true};}
   if(body.action==='edit'){
    if(typeof body.text!=='string'||!body.text.trim()||body.text.length>100000)throw Error('请输入有效内容');
    const old=item.payload.displayMessage?.text||item.text,at=item.payload.text.indexOf(old);
    if(!old||at<0)throw Error('此消息含特殊上下文，请撤回输入框编辑');
    item.payload.text=item.payload.text.slice(0,at)+body.text+item.payload.text.slice(at+old.length);item.payload.displayMessage={...item.payload.displayMessage,text:body.text};item.text=body.text;item.doc=null;return {ok:true};
   }
   if(body.action==='retry'){item.state='queued';item.error=undefined;return {ok:true};}
   throw Error('未知队列操作');
  });
 }
 async sendNow(sessionPath:string,id:string){const queue=await this.load(sessionPath);if(!queue.items.some(item=>item.id===id&&item.state==='queued'))throw Error('消息已发送或不能发送');void this.flush(sessionPath,id,true).catch(()=>{});return {ok:true};}
 private async flush(sessionPath:string,id?:string,steer=false){
  if(this.active.has(sessionPath)||(!steer&&(this.engine.isSessionStreaming(sessionPath)||this.engine.isSessionSwitching?.(sessionPath))))return;
  const pendingQueue=await this.load(sessionPath);
  if(!id&&(pendingQueue.paused||pendingQueue.items[0]?.state!=='queued'))return;
  let item:Item|undefined;
  await this.change(sessionPath,queue=>{if(!id&&queue.paused)return;item=id?queue.items.find(item=>item.id===id):queue.items[0];if(!item||item.state!=='queued'){item=undefined;return;}item.state='sending';this.active.add(sessionPath);});
  if(!item)return;
  let accepted=false;
  try{
   if(steer&&this.engine.isSessionStreaming(sessionPath))await submitDesktopSessionInterjection(this.engine,item.payload);
   else await submitDesktopSessionMessage(this.engine,{...item.payload,onInputAccepted:()=>{accepted=true;}});
   await this.change(sessionPath,queue=>{queue.items=queue.items.filter(row=>row.id!==item!.id);});
  }catch(error){await this.change(sessionPath,queue=>{item!.state=accepted?'unknown':'failed';item!.error=error instanceof Error?error.message:String(error);queue.paused=true;});}
  finally{this.active.delete(sessionPath);}
 }
}
