const fs = require('node:fs');
const path = require('node:path');
const {createHash,randomUUID} = require('node:crypto');
const {EventEmitter} = require('node:events');

function browserDownloadDirectory(profileRoot,sessionPath) {
  if(!profileRoot||!sessionPath)throw new Error('Download requires a profile and conversation');
  return path.join(profileRoot,'cache','browser-downloads',createHash('sha256').update(sessionPath).digest('hex').slice(0,24));
}
function safeFilename(value) {
  const name=path.basename(String(value||'download').replace(/\\/g,'/')).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,180);
  return !name||name==='.'||name==='..'?'download':name;
}

class BrowserDownloads {
  constructor({directory,maxBytes=512*1024*1024}) {
    this.directory=path.resolve(directory);this.maxBytes=maxBytes;
    this.records=new Map();this.items=new Map();this.attachments=new Map();this.events=new EventEmitter();
    this.indexPath=path.join(this.directory,'downloads.json');
    fs.mkdirSync(this.directory,{recursive:true});
    try {
      const saved=JSON.parse(fs.readFileSync(this.indexPath,'utf8'));
      for(const record of Array.isArray(saved)?saved.slice(-100):[]) {
        if(!/^[\da-f-]{36}$/i.test(record?.id||'')||!record.filename)continue;
        const expected=path.join(this.directory,`${record.id}-${safeFilename(record.filename)}`);
        if(record.path!==expected)continue;
        if(record.state==='progress'){record.state='interrupted';record.error='Application restarted during download';try{fs.unlinkSync(expected);}catch{}}
        if(record.state==='completed'&&!fs.existsSync(expected)){record.state='missing';record.error='Downloaded file is missing';}
        this.records.set(record.id,record);
      }
    } catch {}
  }
  persist() {
    const temp=this.indexPath+'.'+randomUUID()+'.tmp';
    try{fs.writeFileSync(temp,JSON.stringify([...this.records.values()].slice(-100)));fs.renameSync(temp,this.indexPath);}finally{try{fs.unlinkSync(temp);}catch{}}
  }
  attach(webContents,tabId) {
    const browserSession = webContents.session;
    const webContentsId = webContents.id;
    if(this.attachments.has(webContents.id))return;
    const listener=(_event,item,owner)=>{
      if(owner?.id!==webContents.id)return;
      const id=randomUUID(),filename=safeFilename(item.getFilename());
      const record={id,tabId,filename,path:path.join(this.directory,`${id}-${filename}`),url:item.getURL(),mime:item.getMimeType(),state:'progress',receivedBytes:0,totalBytes:item.getTotalBytes(),startedAt:Date.now()};
      this.records.set(id,record);this.items.set(id,item);
      item.setSavePath(record.path);this.persist();this.events.emit('added',{record,webContentsId:webContents.id,urls:item.getURLChain?.()||[item.getURL()]});
      let savedAt=0;
      const progress=()=>{
        record.receivedBytes=item.getReceivedBytes();record.totalBytes=item.getTotalBytes();
        if(record.receivedBytes>this.maxBytes||record.totalBytes>this.maxBytes){record.error='Download exceeds the 512 MB limit';item.cancel();}
        if(Date.now()-savedAt>750){savedAt=Date.now();this.persist();}
        this.events.emit('change',id);
      };
      item.on('updated',progress);
      item.once('done',(_event,state)=>{
        item.removeListener('updated',progress);this.items.delete(id);
        record.state=state;record.finishedAt=Date.now();record.receivedBytes=item.getReceivedBytes();
        if(state!=='completed'){try{fs.unlinkSync(record.path);}catch{}}
        else if(!fs.existsSync(record.path)){record.state='interrupted';record.error='Downloaded file is missing';}
        this.persist();this.events.emit('change',id);
      });
      if(record.totalBytes>this.maxBytes){record.error='Download exceeds the 512 MB limit';item.cancel();}
    };
    const cleanup=()=>{
      browserSession.removeListener('will-download',listener);this.attachments.delete(webContentsId);
      for(const record of this.records.values())if(record.tabId===tabId&&record.state==='progress')this.cancel(record.id);
    };
    browserSession.on('will-download',listener);webContents.once('destroyed',cleanup);
    this.attachments.set(webContentsId,{webContents,listener,cleanup});
  }
  list(tabId) {
    return [...this.records.values()].filter(record=>!tabId||record.tabId===tabId).map(record=>({
      ...record,filePath:record.state==='completed'?record.path:undefined,path:undefined,
    }));
  }
  cancel(id) {const item=this.items.get(id);if(item)item.cancel();return !!item;}
  async wait(id,{timeoutMs=10000,signal}={}) {
    signal?.throwIfAborted();if(!this.records.has(id))throw new Error('Download was not found in this conversation');
    if(this.records.get(id).state!=='progress')return this.list().find(record=>record.id===id);
    return new Promise((resolve,reject)=>{
      const finish=()=>{cleanup();resolve(this.list().find(record=>record.id===id));};
      const changed=changedId=>{if(changedId===id&&this.records.get(id).state!=='progress')finish();};
      const aborted=()=>{cleanup();this.cancel(id);reject(signal.reason||new Error('Download wait cancelled'));};
      const timer=setTimeout(finish,Math.max(1,Math.min(10000,timeoutMs)));
      const cleanup=()=>{clearTimeout(timer);this.events.removeListener('change',changed);signal?.removeEventListener('abort',aborted);};
      this.events.on('change',changed);signal?.addEventListener('abort',aborted,{once:true});
      if(signal?.aborted)aborted();
    });
  }
  async start(webContents,url,{signal,timeoutMs=10000}={}) {
    if(!/^https?:\/\//i.test(url))throw new Error('Download URL must use http or https');
    signal?.throwIfAborted();
    const record=await new Promise((resolve,reject)=>{
      const comparable=value=>{try{const parsed=new URL(value);parsed.hash='';return parsed.href;}catch{return value;}};
      const added=event=>{if(event.webContentsId===webContents.id&&event.urls.some(value=>comparable(value)===comparable(url))){cleanup();resolve(event.record);}};
      const abort=()=>{cleanup();reject(signal.reason||new Error('Download cancelled'));};
      const timer=setTimeout(()=>{cleanup();reject(new Error('The browser did not start a download'));},5000);
      const cleanup=()=>{clearTimeout(timer);this.events.removeListener('added',added);signal?.removeEventListener('abort',abort);};
      this.events.on('added',added);signal?.addEventListener('abort',abort,{once:true});
      try{webContents.downloadURL(url);}catch(error){cleanup();reject(error);}
    });
    return this.wait(record.id,{signal,timeoutMs});
  }
}
module.exports={BrowserDownloads,browserDownloadDirectory,safeFilename};
