import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

export interface ManagedInputRef {fileId:string; fromTask?:string}
export interface ManagedInputSnapshot extends ManagedInputRef {label:string; sha256:string; bytes:number; version?:string; mimeType?:string}
type TaskLookup=(id:string)=>{sessionPath?:string};
const MAX_INPUTS=16,MAX_BYTES=32*1024*1024;
const version=(stat:{dev:number;ino:number;size:number;mtimeMs:number;ctimeMs:number})=>`${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;

async function readInput(engine:any,managerPath:string,ref:ManagedInputRef,task:TaskLookup){
  if(!ref||typeof ref.fileId!=='string'||!ref.fileId.trim()||ref.fromTask!==undefined&&(typeof ref.fromTask!=='string'||!ref.fromTask.trim()))throw new Error('任务附件需要当前管家或其工作对话中的文件标识');
  const source=ref.fromTask?task(ref.fromTask).sessionPath:managerPath;
  if(!source)throw new Error('附件来源工作对话尚未创建');
  const file=engine.resolveActiveSessionFile?.({sessionPath:source,fileId:ref.fileId});
  if(!file?.filePath||['missing','unavailable','expired'].includes(file.status))throw new Error('附件不在指定来源对话的有效文件范围内');
  const real=await fs.realpath(file.filePath);
  if(file.realPath&&path.resolve(file.realPath)!==real)throw new Error('附件来源位置已经变化，请重新选择');
  const handle=await fs.open(real,'r');
  try{
    const before=await handle.stat();if(!before.isFile()||before.size>MAX_BYTES)throw new Error('任务附件必须是32MB以内的文件');
    const data=await handle.readFile(),after=await handle.stat();
    if(data.length>MAX_BYTES||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw new Error('附件读取期间发生变化，请重新选择');
    const snapshot:ManagedInputSnapshot={fileId:ref.fileId,...(ref.fromTask?{fromTask:ref.fromTask}:{}),label:file.displayName||file.label||path.basename(real),sha256:createHash('sha256').update(data).digest('hex'),bytes:data.length,version:version(after),...(file.mime?{mimeType:file.mime}:{})};
    return {data,snapshot};
  }finally{await handle.close();}
}

export async function managedInputsCurrent(engine:any,managerPath:string,inputs:ManagedInputSnapshot[]|undefined,task:TaskLookup):Promise<boolean>{
  for(const input of inputs||[])try{
    const source=input.fromTask?task(input.fromTask).sessionPath:managerPath;
    const file=source&&engine.resolveActiveSessionFile?.({sessionPath:source,fileId:input.fileId});if(!file?.filePath||['missing','unavailable','expired'].includes(file.status))return false;
    const stat=await fs.stat(file.filePath);if(input.version){if(version(stat)!==input.version)return false;}
    else if((await readInput(engine,managerPath,input,task)).snapshot.sha256!==input.sha256)return false;
  }catch{return false;}
  return true;
}

/** Select only registered files owned by the manager or an owned worker. */
export async function captureManagedInputs(engine:any,managerPath:string,refs:ManagedInputRef[]|undefined,task:TaskLookup):Promise<ManagedInputSnapshot[]>{
  if(refs===undefined)return [];
  if(!Array.isArray(refs)||refs.length>MAX_INPUTS)throw new Error('每个工作任务最多传递16个附件');
  const result:ManagedInputSnapshot[]=[];
  for(const ref of refs){const {snapshot}=await readInput(engine,managerPath,ref,task);if(!result.some(item=>item.fileId===snapshot.fileId&&item.fromTask===snapshot.fromTask))result.push(snapshot);}
  return result;
}

/** Revalidate before copying into a new worker's own workspace. Source bytes
 * and permissions are never changed; a changed source fails instead of drifting. */
export async function deliverManagedInputs(engine:any,managerPath:string,inputs:ManagedInputSnapshot[]|undefined,target:{sessionPath:string;root:string},task:TaskLookup){
  if(!inputs?.length)return [];
  const result:Array<{fileId:string;path:string;name:string;isDir:false;mimeType?:string}>=[];
  for(const [index,input] of inputs.entries()){
    const {data,snapshot}=await readInput(engine,managerPath,input,task);
    if(snapshot.sha256!==input.sha256||snapshot.bytes!==input.bytes)throw new Error(`附件“${input.label}”在任务安排后已变化，请重新确认输入版本`);
    const directory=path.join(target.root,'inputs');await fs.mkdir(directory,{recursive:true});
    const originalName=path.basename(input.label.replaceAll('\\','/')).replaceAll('\0','');
    const candidateExtension=path.extname(originalName),extension=Buffer.byteLength(candidateExtension)<=32?candidateExtension:'';
    const characters=Array.from(extension?originalName.slice(0,-extension.length):originalName);
    while(Buffer.byteLength(characters.join('')+extension,'utf8')>200)characters.pop();
    const name=(characters.join('')||'input')+extension;
    const destination=path.join(directory,`${index+1}-${name}`);
    await fs.writeFile(destination,data,{flag:'wx',mode:0o444});
    const registered=engine.registerSessionFile?.({sessionPath:target.sessionPath,filePath:destination,label:input.label,origin:'agent_write',storageKind:'external',metadata:{sourceFileId:input.fileId,sourceTask:input.fromTask||null,sourceHash:input.sha256,purpose:'managed_task_input'}});
    const fileId=registered?.fileId||registered?.id;if(!fileId)throw new Error('工作任务附件登记失败，尚未启动模型');
    result.push({fileId,path:destination,name:input.label,isDir:false,mimeType:input.mimeType});
  }
  return result;
}
