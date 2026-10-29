import {hash} from './storage.js';

export interface WorkbenchRequest {
  entry:string; sourceHash:string; operation:string; action:string; title:string; goal:boolean;
  state:string; outcome?:string; error?:string;
}
export function operationVerificationResult(result:any){
  return result?.verification || (result?.run?.steps ? result.run.steps.findLast((step:any)=>step.kind==='verify')?.data : undefined) || result;
}
export function hasWorkbenchGoal(value:unknown):boolean {
  if(!value||typeof value!=='object')return false;
  if(Array.isArray(value))return value.some(hasWorkbenchGoal);
  return Object.entries(value).some(([key,item])=>key==='goal'&&typeof item==='string'&&!!item.trim()||hasWorkbenchGoal(item));
}
const userText=(entry:any):string|undefined=>entry?.type==='message'&&entry.message?.role==='user' ? typeof entry.message.content==='string'?entry.message.content:Array.isArray(entry.message.content)&&entry.message.content.every((part:any)=>part.type==='text')?entry.message.content.map((part:any)=>part.text).join('\n'):undefined : undefined;
const parseReceipt=(entry:any)=>{
  if(entry?.type!=='custom_message'||entry.customType!=='enigma.workbench-operation')return undefined;
  let body:any={};try{body=JSON.parse(entry.content);}catch{/* Bounded metadata survives clipped output. */}
  const meta=entry.details||{};return {operation:meta.operation||body.id,title:meta.title||body.title,state:meta.state||body.state||'unknown',outcome:meta.outcome||body.outcome,error:typeof body.error==='string'?body.error:undefined};
};
/** Only app-authored metadata paired with the exact user entry can classify
 * an operation. A user typing the same words remains a normal requirement. */
export function workbenchRequests(entries:readonly any[]):WorkbenchRequest[] {
  const byId=new Map(entries.map(entry=>[entry.id,entry])),receipts=new Map<string,ReturnType<typeof parseReceipt>>();
  for(const entry of entries){const receipt=parseReceipt(entry);if(receipt?.operation)receipts.set(receipt.operation,receipt);}
  const requests=new Map<string,WorkbenchRequest>();
  for(let index=0;index<entries.length;index++){
    const entry=entries[index];
    if(entry.type==='custom'&&entry.customType==='enigma.workbench-request'){
      const data=entry.data,user=byId.get(data?.entry),text=userText(user);
      if(typeof text!=='string'||entry.parentId!==user.id||data.sourceHash!==hash(text)||typeof data.operation!=='string'||typeof data.action!=='string'||typeof data.title!=='string'||typeof data.goal!=='boolean')continue;
      const receipt=receipts.get(data.operation);
      requests.set(user.id,{entry:user.id,sourceHash:data.sourceHash,operation:data.operation,action:data.action,title:data.title,goal:data.goal,state:receipt?.state||'unknown',outcome:receipt?.outcome,error:receipt?.error});
    }
    // Older desktop versions wrote a full request immediately before the
    // generated user entry. Require matching text and a receipt on that route.
    if(entry.type!=='custom'||entry.customType!=='enigma.operation-request')continue;
    const user=entries[index+1],text=userText(user),data=entry.data,args=data?.request?.args||{};
    if(!user||user.parentId!==entry.id||typeof data?.title!=='string'||typeof data?.request?.action!=='string')continue;
    const details=[args.goal&&`目标：${args.goal}`,args.repo&&`仓库：${args.repo}`,args.file&&`文件：${args.file}`,args.title&&`名称：${args.title}`].filter(Boolean);
    const expected=`请执行工作台操作：${data.title}。${details.length?'\n'+details.join('\n'):''}`;
    if(text!==expected)continue;
    let cursor=user,receipt;
    for(let next=index+2;next<entries.length;next++){
      const item=entries[next];if(item.parentId!==cursor.id||item.type==='message'&&['user','assistant'].includes(item.message?.role))break;
      receipt=parseReceipt(item);if(receipt)break;cursor=item;
    }
    if(!receipt?.operation||receipt.title!==data.title)continue;
    if(!requests.has(user.id))requests.set(user.id,{entry:user.id,sourceHash:hash(text),operation:receipt.operation,action:data.request.action,title:data.title,goal:hasWorkbenchGoal(args),state:receipt.state,outcome:receipt.outcome,error:receipt.error});
  }
  return [...requests.values()];
}

/** Read only completed operation receipts from the current conversation branch.
 * Historical payloads may have been truncated; metadata is still a receipt,
 * but never sufficient to invent a successful command outcome. */
export function workbenchOperationHistory(entries: readonly any[]) {
  return entries.filter(entry=>entry.type==='custom_message'&&entry.customType==='enigma.workbench-operation').slice(-20).reverse().map(entry=>{
    let operation:any={};
    if(typeof entry.content==='string'&&entry.content.length<=21000)try{operation=JSON.parse(entry.content);}catch{/* Older clipped JSON retains metadata only. */}
    const metadata=entry.details||{},value=operation.result;
    const verification=operationVerificationResult(value);
    return {
      id:metadata.operation||operation.id||entry.id,
      title:metadata.title||operation.title||'工作台操作',
      state:metadata.state||operation.state||'unknown',
      outcome:metadata.outcome||operation.outcome,
      at:entry.timestamp,
      error:typeof operation.error==='string'?operation.error.slice(0,2000):undefined,
      output:typeof value?.output==='string'?value.output.slice(0,4000):undefined,
      reference:metadata.verificationEvidence||verification?.evidence||value?.evidence||value?.id,
      verificationAttempt:metadata.verificationAttempt===true||Array.isArray(verification?.results),
      checks:Array.isArray(verification?.results)?verification.results.slice(0,12).map((check:any)=>({check:check.check,repo:check.repo,status:check.status,output:typeof check.output==='string'?check.output.slice(0,800):undefined})):undefined,
      payloadIncomplete:!operation.id,
    };
  });
}

/** A manual check after the last agent response belongs to the current user
 * workflow. Its evidence must still pass source/check freshness validation.
 * Any later agent response returns authority to the native session sidecar. */
export function workbenchVerificationEvidence(entries: readonly any[], nativeEvidence?: string): string | undefined {
  for (let index=entries.length-1;index>=0;index--) {
    const entry=entries[index];
    if(entry.type==='message'&&['assistant','toolResult'].includes(entry.message?.role))return nativeEvidence;
    if(entry.type!=='custom_message'||entry.customType!=='enigma.workbench-operation')continue;
    const metadata=entry.details||{};let operation:any;
    try{operation=typeof entry.content==='string'?JSON.parse(entry.content):undefined;}catch{/* New metadata retains check identity if content was clipped. */}
    const checked=operationVerificationResult(operation?.result);
    if(metadata.verificationAttempt===true || checked&&Array.isArray(checked.results)&&typeof checked.evidence==='string'){
      const state=metadata.state||operation?.state;
      return state==='completed' ? metadata.verificationEvidence||checked?.evidence : undefined;
    }
  }
  return nativeEvidence;
}
