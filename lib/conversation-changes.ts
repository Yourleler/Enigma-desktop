import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createTwoFilesPatch} from 'diff';
import {excludedSourcePath} from 'enigma-next';

export interface ChangeRoot {id:string;root:string;name:string}
export interface CapturedFile {hash:string;mode:number;size:number;omitted?:string}
export interface DirectoryCapture {roots:ChangeRoot[];files:Record<string,CapturedFile>;gaps:string[]}
export interface ChangeOperation {tool:string;file?:string;before?:string;after?:string;exact:boolean;error?:boolean}
export interface ConversationTurn {
  schema:1;id:string;session:string;startedAt:string;endedAt?:string;parentEntry:string|null;inputEntry?:string;
  prompt:string;status:'running'|'complete'|'interrupted';before:DirectoryCapture;after?:DirectoryCapture;operations:ChangeOperation[];
}
const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const safe=(id:string)=>{if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw Error('无效的变更记录');return id;};
const ignored=(file:string)=>excludedSourcePath(file)||file.split(/[\\/]/).some(p=>['.git','node_modules','.cache','dist','dist-server','dist-enigma','coverage'].includes(p));
const key=(root:string,file:string)=>`${root}:${file.replaceAll(path.sep,'/')}`;

/** Immutable per-input file observations. No source directory is initialized
 * as Git, and no history is invented for turns that predate capture. */
export class ConversationChanges {
  private active=new Map<string,ConversationTurn>();
  private finishes=new Map<string,{promise:Promise<void>;resolve:()=>void}>();
  private storedBytes:number|undefined;
  constructor(readonly directory:string,readonly resolveRoots:(session:string)=>Promise<ChangeRoot[]>,readonly canRead:(session:string,file:string)=>boolean=()=>true){}
  private sessionDir(session:string){return path.join(this.directory,digest(session));}
  private async json(file:string,value:unknown){await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(value),{mode:0o600});await fs.rename(temp,file);}
  private async blob(bytes:Buffer){
    const hash=digest(bytes),folder=path.join(this.directory,'blobs'),file=path.join(folder,hash);await fs.mkdir(folder,{recursive:true});
    if(this.storedBytes===undefined){let total=0;for(const name of await fs.readdir(folder)){try{total+=(await fs.stat(path.join(folder,name))).size;}catch{}}this.storedBytes=total;}
    if(await fs.stat(file).then(()=>true,()=>false))return hash;
    if(this.storedBytes+bytes.length>256*1024*1024)throw Error('quota');
    await fs.writeFile(file,bytes,{mode:0o600,flag:'wx'}).then(()=>{this.storedBytes!+=bytes.length;}).catch(error=>{if(error.code!=='EEXIST')throw error;});return hash;
  }
  async content(version:CapturedFile|undefined){
    if(!version)return undefined;if(version.omitted)return undefined;
    const bytes=await fs.readFile(path.join(this.directory,'blobs',version.hash));if(digest(bytes)!==version.hash)throw Error('文件版本校验失败');
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  }
  async capture(session:string,persist=true):Promise<DirectoryCapture>{
    const roots=await Promise.all((await this.resolveRoots(session)).map(async r=>({...r,root:await fs.realpath(r.root)}))),result:DirectoryCapture={roots,files:{},gaps:[]};let count=0,bytesTotal=0;
    const deadline=Date.now()+4000;
    for(const root of roots){
      const walk=async(dir:string)=>{
        if(Date.now()>deadline||count>=4000||bytesTotal>12_000_000){result.gaps.push(`${root.name}：捕获达到文件数、体积或时间上限`);return;}
        let entries;try{entries=await fs.readdir(path.join(root.root,dir),{withFileTypes:true});}catch{result.gaps.push(`${root.name}/${dir}：目录不可读取`);return;}
        for(const entry of entries){
          const file=path.join(dir,entry.name);if(ignored(file))continue;
          if(Date.now()>deadline||count>=4000||bytesTotal>12_000_000){result.gaps.push(`${root.name}：捕获不完整`);break;}
          if(entry.isSymbolicLink()){result.gaps.push(`${root.name}/${file}：跳过符号链接`);continue;}
          if(entry.isDirectory()){await walk(file);continue;}if(!entry.isFile())continue;
          const target=path.join(root.root,file);if(!this.canRead(session,target))continue;count++;
          try{
            const canonical=await fs.realpath(target);if(!canonical.startsWith(root.root+path.sep)||!this.canRead(session,canonical)){result.gaps.push(`${root.name}/${file}：路径权限已变化`);continue;}
            const handle=await fs.open(canonical,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
            try{
              const stat=await handle.stat();if(!stat.isFile())continue;
              if(stat.size>512_000){result.files[key(root.id,file)]={hash:`stat:${stat.size}:${stat.mtimeMs}`,mode:stat.mode&0o777,size:stat.size,omitted:'文件超过512KB，仅保留变化标记'};continue;}
              const bytes=await handle.readFile();bytesTotal+=bytes.length;
              let omitted:string|undefined;try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(bytes.includes(0))omitted='二进制文件';}catch{omitted='非UTF-8文件';}
              let hash=digest(bytes);if(!omitted&&persist)try{hash=await this.blob(bytes);}catch{omitted='历史存储达到256MB，保留哈希但未保存正文';result.gaps.push('文件历史容量已满，本轮部分正文未保存');}
              result.files[key(root.id,file)]={hash,mode:stat.mode&0o777,size:bytes.length,...(omitted?{omitted}:{})};
            }finally{await handle.close();}
          }catch{result.files[key(root.id,file)]={hash:'unavailable',mode:0,size:0,omitted:'读取期间发生变化或无权限'};result.gaps.push(`${root.name}/${file}：读取期间发生变化或无权限`);}
        }
      };await walk('');
    }
    result.gaps=[...new Set(result.gaps)];return result;
  }
  async begin(session:string,prompt:string,parentEntry:string|null){
    while(this.finishes.has(session))await this.finishes.get(session)!.promise;
    let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});this.finishes.set(session,{promise,resolve:release});
    let before:DirectoryCapture;try{before=await this.capture(session);}catch(error){this.finishes.delete(session);release();throw error;}
    const record:ConversationTurn={schema:1,id:randomUUID(),session,startedAt:new Date().toISOString(),parentEntry,prompt:prompt.slice(0,4000),status:'running',before,operations:[]};
    this.active.set(session,record);try{await this.json(path.join(this.sessionDir(session),record.id+'.json'),record);}catch(error){this.active.delete(session);this.finishes.delete(session);release();throw error;}return record.id;
  }
  release(session:string,id:string){
    if(this.active.get(session)?.id!==id)return;
    this.active.delete(session);const finish=this.finishes.get(session);this.finishes.delete(session);finish?.resolve();
  }
  async end(session:string,id:string|null,inputEntry?:string,interrupted=false){
    const record=this.active.get(session);if(!id||record?.id!==id)return;
    try{record.after=await this.capture(session);record.inputEntry=inputEntry;record.endedAt=new Date().toISOString();record.status=interrupted?'interrupted':'complete';await this.json(path.join(this.sessionDir(session),record.id+'.json'),record);}finally{this.release(session,id);}
  }
  async observeTool<T>(session:string,tool:string,params:any,cwd:string,run:()=>Promise<T>):Promise<T>{
    const record=this.active.get(session);if(!record)return run();
    const raw=typeof params?.path==='string'?params.path:typeof params?.file_path==='string'?params.file_path:undefined;
    const requested=raw?path.resolve(cwd,raw):undefined;
    const target=requested?await fs.realpath(requested).catch(async()=>path.join(await fs.realpath(path.dirname(requested)).catch(()=>path.dirname(requested)),path.basename(requested))):undefined;
    const root=target?record.before.roots.find(r=>target.startsWith(r.root+path.sep)):undefined;
    const file=root&&target?key(root.id,path.relative(root.root,target)):undefined;
    const eligible=file&&!ignored(path.relative(root!.root,target!))&&this.canRead(session,target!);
    let observedText:string|undefined;
    const read=async()=>{if(!eligible)return undefined;try{const h=await fs.open(target!,constants.O_RDONLY|(constants.O_NOFOLLOW||0));try{if((await h.stat()).size>512000)return undefined;const bytes=await h.readFile();observedText=bytes.toString('utf8');return digest(bytes);}finally{await h.close();}}catch{return undefined;}};
    const before=await read(),beforeText=observedText;let error=false;
    try{return await run();}catch(e){error=true;throw e;}finally{
      const after=await read();const oldText=params?.oldText,newText=params?.newText;
      const exact=tool==='write'&&typeof params.content==='string'&&after===digest(params.content)
        ||tool==='edit'&&typeof beforeText==='string'&&typeof oldText==='string'&&oldText.length>0&&typeof newText==='string'&&beforeText.indexOf(oldText)>=0&&beforeText.indexOf(oldText)===beforeText.lastIndexOf(oldText)&&after===digest(beforeText.replace(oldText,newText));
      record.operations.push({tool,file,before,after,exact,error});
    }
  }
  async list(session:string){
    let names:string[]=[];try{names=await fs.readdir(this.sessionDir(session));}catch{}
    const turns:ConversationTurn[]=[];for(const name of names.filter(n=>n.endsWith('.json'))){try{const value=JSON.parse(await fs.readFile(path.join(this.sessionDir(session),name),'utf8'));if(value.schema===1&&value.session===session)turns.push(value);}catch{}}
    return turns.sort((a,b)=>a.startedAt.localeCompare(b.startedAt));
  }
  async inherit(source:string,target:string,entries:Set<string>){
    for(const turn of await this.list(source)){
      if(!turn.inputEntry||!entries.has(turn.inputEntry)||!turn.after)continue;
      const file=path.join(this.sessionDir(target),turn.id+'.json');
      if(await fs.stat(file).then(()=>true,()=>false))continue;
      await this.json(file,{...turn,session:target,inheritedFrom:source});
    }
  }
  async compare(session:string,from?:string,to?:string,branch?:Set<string>){
    const turns=(await this.list(session)).filter(t=>!branch||!t.inputEntry||branch.has(t.inputEntry)),start=from?turns.findIndex(t=>t.id===safe(from)):Math.max(0,turns.length-1),end=to?turns.findIndex(t=>t.id===safe(to)):turns.length-1;
    if(start<0||end<start||!turns[end])return {turns,changes:[],gaps:['没有可用的轮次文件记录。旧对话不会自动重建历史，下一次输入起开始记录。'],version:''};
    const selected=turns.slice(start,end+1),a=selected[0].before,b=selected.at(-1)!.after;
    if(!b)return {turns,changes:[],gaps:['这一轮尚未封存；执行中或异常退出的版本不能视为完整差异。'],version:''};
    const currentRoots=await this.resolveRoots(session);const allowed=new Set(await Promise.all(currentRoots.map(r=>fs.realpath(r.root).catch(()=>r.root))));
    const roots=[...new Map([...a.roots,...b.roots].filter(r=>allowed.has(r.root)).map(r=>[r.id,r])).values()],changes:any[]=[];
    for(const fileKey of new Set([...Object.keys(a.files),...Object.keys(b.files)])){
      const split=fileKey.indexOf(':'),repo=fileKey.slice(0,split),file=fileKey.slice(split+1),root=roots.find(r=>r.id===repo);if(!root||ignored(file)||!this.canRead(session,path.join(root.root,file)))continue;
      const before=a.files[fileKey],after=b.files[fileKey];if(before?.hash===after?.hash&&before?.mode===after?.mode)continue;
      const beforeContent=await this.content(before),afterContent=await this.content(after),incomplete=(!before&&(a.gaps.length>0||!a.roots.some(r=>r.id===repo)))||(!after&&b.gaps.length>0),text=!incomplete&&(!before||beforeContent!==undefined)&&(!after||afterContent!==undefined);
      const ops=selected.flatMap(t=>t.operations).filter(o=>o.file===fileKey);
      let authored=before?.hash,verified=0;for(const op of ops){if(op.exact&&op.before===authored){authored=op.after;verified++;}else if(op.before!==op.after){verified=0;break;}}
      const exact=verified>0&&authored===after?.hash;
      const patch=text?createTwoFilesPatch(file,file,beforeContent||'',afterContent||''):undefined;
      changes.push({repo,file,change:incomplete?'unknown':!before?'added':!after?'deleted':'modified',before:before?{...before,content:beforeContent}:undefined,after:after?{...after,content:afterContent}:undefined,patch:patch?.slice(0,120000),patchTruncated:!!patch&&patch.length>120000,attribution:exact?'verified-write':ops.length?'observed-tool':'unattributed'});
    }
    for(const added of changes.filter(c=>c.change==='added')){
      const matching=changes.filter(c=>c.change==='deleted'&&c.repo===added.repo&&c.before?.hash===added.after?.hash&&!c.before?.omitted);
      const additions=changes.filter(c=>c.change==='added'&&c.repo===added.repo&&c.after?.hash===added.after?.hash);
      if(matching.length===1&&additions.length===1){const removed=matching[0];added.change='renamed';added.previousPath=removed.file;added.before=removed.before;removed.paired=true;}
    }
    const visible=changes.filter(c=>!c.paired);
    const gaps=[...a.gaps,...b.gaps,...(b.roots.some(r=>!a.roots.some(old=>old.id===r.id))?['轮次中新增目录，部分文件缺少开始时的基线']:[]),...(!selected.every(t=>t.status==='complete')?['所选范围包含中断轮次，可能有未确认的外部效果']:[])];
    return {turns,roots,changes:visible,gaps:[...new Set(gaps)],version:digest(JSON.stringify({before:a.files,after:b.files,from:selected[0].id,to:selected.at(-1)!.id})),from:selected[0].id,to:selected.at(-1)!.id};
  }
}
