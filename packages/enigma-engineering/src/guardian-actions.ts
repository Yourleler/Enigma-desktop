import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {ensureDir,hash,redact,safeId,writeJson} from './storage.js';

/** A lost HTTP response never grants permission to repeat a side effect.
 * Claims survive host crashes; unfinished claims require inspection. */
export class GuardianActions {
  constructor(readonly root:string,readonly session:string,readonly secrets:string[]=[]){safeId(session);}
  async run(requestId:string,input:object,action:()=>Promise<any>){
    safeId(requestId);if(requestId.length>100)throw new Error('Guardian request identity is too long');
    const directory=await ensureDir(join(this.root,'.enigma-next','guardians',this.session,'actions')),file=join(directory,`${requestId}.json`),fingerprint=hash(JSON.stringify(input));
    const claim={schema:1,requestId,fingerprint,state:'pending',at:new Date().toISOString()};
    try{await writeFile(file,JSON.stringify(claim),{flag:'wx',mode:0o600});}
    catch(error){
      if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
      const previous=JSON.parse(await readFile(file,'utf8'));
      if(previous.schema!==1||previous.requestId!==requestId||previous.fingerprint!==fingerprint)throw new Error('Guardian request identity was reused with different inputs');
      if(previous.state==='completed'&&previous.result&&typeof previous.result==='object')return {...previous.result,replayed:true};
      return {needsUser:true,replayed:true,requestState:'unknown',message:'上一次管家操作的结果需要核对，未重复执行。'+(previous.error?` ${previous.error}`:'')};
    }
    try{
      const result=await action(),safe=JSON.parse(redact(JSON.stringify(result),this.secrets));
      await writeJson(file,{...claim,state:'completed',finishedAt:new Date().toISOString(),result:safe});return safe;
    }catch(error){
      const message=redact(String(error),this.secrets);
      await writeJson(file,{...claim,state:'unknown',finishedAt:new Date().toISOString(),error:message});
      throw error;
    }
  }
}
