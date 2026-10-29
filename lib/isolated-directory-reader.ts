import {spawn} from 'node:child_process';
import path from 'node:path';

export type DirectoryEntrySnapshot={name:string;isDirectory:boolean;isFile:boolean;size:number;mtimeMs:number};
const readerSource=`
const fs=require('node:fs'),path=require('node:path');
try {
  const entries=fs.readdirSync(process.argv[1],{withFileTypes:true});
  if(entries.length>30000)throw Object.assign(new Error('Directory has too many entries'),{code:'E2BIG'});
  const result=[];
  for(const entry of entries) {
    let stat;try{stat=fs.statSync(path.join(process.argv[1],entry.name))}catch(error){if(error.code==='ENOENT')continue;throw error}
    result.push({name:entry.name,isDirectory:entry.isDirectory(),isFile:entry.isFile(),size:stat.size,mtimeMs:stat.mtimeMs});
  }
  process.stdout.write(JSON.stringify({entries:result}));
}catch(error){process.stdout.write(JSON.stringify({error:{code:error.code||'EIO',message:error.message}}));process.exitCode=1;}
`;

/** Protected/network directory reads may block in the OS indefinitely. A
 * separate process leaves both the server loop and its shared fs pool free. */
export function createIsolatedDirectoryReader({source=readerSource,timeoutMs=4000,maxConcurrent=4}={}) {
  const inflight=new Map<string,Promise<DirectoryEntrySnapshot[]>>();
  const cooldown=new Map<string,number>();
  const unavailable=()=>Object.assign(new Error('目录读取仍在等待系统访问权限或磁盘响应，请确认后重试。其他功能可继续使用。'),{code:'DIRECTORY_READ_TIMEOUT',status:408});
  return (directory:string):Promise<DirectoryEntrySnapshot[]>=>{
    const key=path.resolve(directory),running=inflight.get(key);if(running)return running;
    if((cooldown.get(key)||0)>Date.now()||inflight.size>=maxConcurrent)return Promise.reject(unavailable());
    const work=new Promise<DirectoryEntrySnapshot[]>((resolve,reject)=>{
      const child=spawn(process.execPath,['-e',source,key],{stdio:['ignore','pipe','pipe'],windowsHide:true});
      let output='',done=false;
      const finish=(error?:Error,result?:DirectoryEntrySnapshot[])=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(result!)};
      const timer=setTimeout(()=>{cooldown.set(key,Date.now()+15000);child.kill('SIGKILL');finish(unavailable())},timeoutMs);
      child.stdout.on('data',chunk=>{output+=String(chunk);if(output.length>8*1024*1024){child.kill('SIGKILL');finish(Object.assign(new Error('目录条目过多，请打开更具体的子目录。'),{code:'E2BIG'}))}});
      child.stderr.resume();
      child.once('error',error=>finish(error));
      child.once('close',()=>{if(done)return;try{const data=JSON.parse(output);if(data.error)finish(Object.assign(new Error(data.error.message),{code:data.error.code}));else if(Array.isArray(data.entries))finish(undefined,data.entries);else throw Error('Invalid directory snapshot')}catch(error){finish(error as Error)}});
    });
    inflight.set(key,work);void work.finally(()=>inflight.delete(key)).catch(()=>{});
    return work;
  };
}
export const readDirectoryIsolated=createIsolatedDirectoryReader();
