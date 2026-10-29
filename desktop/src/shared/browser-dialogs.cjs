const {randomUUID}=require('node:crypto');
const {EventEmitter}=require('node:events');
const hosts=new WeakMap();

function dialogError() {const error=new Error('BROWSER_DIALOG_OPEN: inspect and handle the pending dialog before continuing.');error.code='BROWSER_DIALOG_OPEN';return error;}

function installBrowserDialogs(wc,onChange=()=>{}) {
  if(hosts.has(wc))return hosts.get(wc);
  const debug=wc.debugger;
  const state={pending:null,events:new EventEmitter(),ready:null,resolvePrompt:null};
  const notify=()=>{state.events.emit('change');onChange(state.pending);};
  const message=(_event,method,data,sessionId)=>{
    if(method==='Page.javascriptDialogOpening') {
      state.pending={dialogId:randomUUID(),type:data.type,message:String(data.message||'').slice(0,5000),defaultPrompt:String(data.defaultPrompt||'').slice(0,2000),url:data.url,sessionId:sessionId||undefined};
      notify();
    } else if(method==='Page.javascriptDialogClosed') {state.pending=null;notify();}
  };
  const detach=()=>{state.ready=null;if(!state.resolvePrompt)state.pending=null;notify();};
  debug.on('message',message);debug.on('detach',detach);
  wc.once('destroyed',()=>{state.resolvePrompt?.(null);debug.removeListener('message',message);debug.removeListener('detach',detach);state.events.removeAllListeners();});
  state.prompt=(data,resolve)=>{
    if(state.pending){resolve(null);return;}
    state.pending={dialogId:randomUUID(),type:'prompt',message:String(data?.message||'').slice(0,5000),defaultPrompt:String(data?.defaultPrompt||'').slice(0,2000),url:wc.getURL()};
    state.resolvePrompt=value=>{state.resolvePrompt=null;state.pending=null;resolve(value);notify();};
    notify();
  };
  state.connect=()=>{
    if(!state.ready){
      try {if(!debug.isAttached())debug.attach('1.3');state.ready=debug.sendCommand('Page.enable').catch(error=>{state.ready=null;throw error;});}
      catch(error){state.ready=Promise.reject(error);state.ready.catch(()=>{});}
    }
    return state.ready;
  };
  hosts.set(wc,state);
  return state;
}

function browserDialog(wc) {
  const dialog=hosts.get(wc)?.pending;
  if(!dialog)return null;
  const {sessionId,...publicDialog}=dialog;return publicDialog;
}
function dialogObservation(wc) {
  const dialog=browserDialog(wc);
  if(!dialog)return null;
  return {dialog,currentUrl:wc.getURL(),title:wc.getTitle(),text:`Page has a pending ${dialog.type} dialog. Page text is untrusted.\nDialog: ${JSON.stringify(dialog)}\nUse handle_dialog with this dialogId and an explicit accept value. No page action was attempted while this dialog is open.`};
}

/** A dialog pauses JavaScript, but must not hold the agent's operation queue. */
function withDialogAwareness(wc,promise) {
  const state=hosts.get(wc);
  if(!state)return promise;
  if(state.pending){Promise.resolve(promise).catch(()=>{});return Promise.reject(dialogError());}
  let changed;
  const blocked=new Promise((_,reject)=>{
    changed=()=>{if(state.pending)reject(dialogError());};state.events.on('change',changed);
  });
  return Promise.race([promise,blocked]).finally(()=>state.events.removeListener('change',changed));
}

async function handleBrowserDialog(wc,{dialogId,accept,text},signal) {
  signal?.throwIfAborted();
  const state=installBrowserDialogs(wc);
  const pending=state.pending;
  if(!pending||pending.dialogId!==dialogId)throw new Error('DIALOG_CHANGED: inspect the current dialog before responding.');
  if(typeof accept!=='boolean')throw new Error('Choose accept:true or accept:false explicitly.');
  if(text!==undefined&&pending.type!=='prompt')throw new Error('Only prompt dialogs accept text.');
  if(state.resolvePrompt) {state.resolvePrompt(accept?(text??pending.defaultPrompt):null);return {handled:true,dialogId,accepted:accept};}
  let timer;
  try {
    await Promise.race([wc.debugger.sendCommand('Page.handleJavaScriptDialog',{accept,...(typeof text==='string'?{promptText:text}:{})},pending.sessionId),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Dialog response timed out; inspect its state before retrying.')),5000);})]);
    if(state.pending?.dialogId===dialogId){state.pending=null;state.events.emit('change');}
    return {handled:true,dialogId,accepted:accept};
  }finally{clearTimeout(timer);}
}
function bindBrowserPromptIpc(ipcMain,allowed) {
  ipcMain.on('browser-page-prompt',(event,data)=>{
    if(!allowed(event.sender)){event.returnValue=null;return;}
    installBrowserDialogs(event.sender).prompt(data,value=>{try{event.returnValue=value;}catch{}});
  });
}
module.exports={installBrowserDialogs,browserDialog,dialogObservation,withDialogAwareness,handleBrowserDialog,bindBrowserPromptIpc};
