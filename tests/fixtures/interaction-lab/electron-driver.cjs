// An isolated test transport for the real production observation/input code.
// It never attaches to a user's browser or reads an existing browser profile.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const readline = require('node:readline');
const fs = require('node:fs');
const { observeBrowser, interactBrowser, navigateBrowser, uploadBrowser } = require('../../../desktop/src/shared/browser-observation.cjs');
const { waitForBrowserState } = require('../../../desktop/src/shared/browser-wait.cjs');
const { BrowserDownloads, browserDownloadDirectory } = require('../../../shared/browser-downloads.cjs');
const {listBrowserFrames,runBrowserFrame} = require('../../../desktop/src/shared/browser-frames.cjs');
const {dragBrowser} = require('../../../desktop/src/shared/browser-observation.cjs');
const {installBrowserDialogs,browserDialog,handleBrowserDialog,bindBrowserPromptIpc} = require('../../../desktop/src/shared/browser-dialogs.cjs');
const root = process.env.ENIGMA_LAB_ROOT;
const origin = new URL(process.env.ENIGMA_LAB_URL).origin;
if (!root) throw new Error('A new lab directory is required');
app.setPath('userData',path.join(root,'isolated-browser-profile'));
app.on('window-all-closed',()=>{});
const workspaces=new Map(), commands=new Map();
bindBrowserPromptIpc(ipcMain,wc=>[...workspaces.values()].some(w=>[...w.tabs.values()].some(win=>win.webContents===wc)));
function send(message){process.stdout.write('ENIGMA_INTERACTION '+JSON.stringify(message)+'\n');}
function allowed(url){return url==='about:blank'||new URL(url).origin===origin;}
function workspace(sessionPath){
  if(typeof sessionPath!=='string'||!sessionPath.startsWith(root+path.sep))throw new Error('Only the new test session is allowed');
  const value=workspaces.get(sessionPath);if(!value)throw new Error('No test workspace');return value;
}
function serialized(w){return {running:!!w,activeTabId:w?.active||null,tabs:w?[...w.tabs].map(([tabId,win])=>({tabId,title:win.webContents.getTitle(),url:win.webContents.getURL(),canGoBack:win.webContents.canGoBack(),canGoForward:win.webContents.canGoForward()})):[]};}
async function newTab(w,url='about:blank'){
  if(!allowed(url))throw new Error('Only the new lab website is allowed');
  const id=randomUUID();
  const win=new BrowserWindow({width:1440,height:1000,show:false,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false,preload:path.resolve(__dirname,'../../../desktop/src/shared/browser-prompt-preload.cjs')}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('console-message',(...args)=>fs.appendFileSync(path.join(root,'page-console.log'),String(args.find(value=>value?.message)?.message||'')+'\n'));
  const dialogs=installBrowserDialogs(win.webContents);
  win.webContents.on('will-navigate',(event,url)=>{if(!allowed(url))event.preventDefault();});
  win.webContents.on('will-redirect',(event,url)=>{if(!allowed(url))event.preventDefault();});
  w.downloads.attach(win.webContents,id);
  w.tabs.set(id,win);w.active=id;await win.loadURL(url);await dialogs.connect();return id;
}
async function command(cmd,p,signal){
  signal.throwIfAborted();
  if(cmd==='setAcceptCookies')return {};
  if(cmd==='launch'){
    if(!p.sessionPath.startsWith(root+path.sep))throw new Error('Test session is required');
    const w={tabs:new Map(),active:null,downloads:new BrowserDownloads({directory:browserDownloadDirectory(root,p.sessionId||p.sessionPath)})};workspaces.set(p.sessionPath,w);await newTab(w);return serialized(w);
  }
  const w=workspace(p.sessionPath);
  if(cmd==='downloads')return {downloads:w.downloads.list(p.tabId)};
  if(cmd==='waitDownload')return {download:await w.downloads.wait(p.downloadId,{signal,timeoutMs:p.timeout})};
  if(cmd==='cancelDownload')return {cancelled:w.downloads.cancel(p.downloadId)};
  if(cmd==='newTab'){await newTab(w,p.url);return serialized(w);}
  if(cmd==='listTabs')return serialized(w);
  if(cmd==='switchTab'){if(!w.tabs.has(p.tabId))throw new Error('Unknown test tab');w.active=p.tabId;return serialized(w);}
  if(cmd==='closeTab'){const win=w.tabs.get(p.tabId);if(!win)throw new Error('Unknown test tab');win.destroy();w.tabs.delete(p.tabId);w.active=w.tabs.keys().next().value||null;return serialized(w);}
  if(cmd==='close'||cmd==='destroyView'){for(const win of w.tabs.values())win.destroy();workspaces.delete(p.sessionPath);return {};}
  const tabId=p.tabId||w.active, win=w.tabs.get(tabId);if(!win)throw new Error('Unknown test tab');
  const wc=win.webContents;
  if(cmd==='frames')return {frames:await listBrowserFrames(wc,signal)};
  if(cmd==='frameAction')return runBrowserFrame(wc,p,signal);
  if(cmd==='drag')return dragBrowser(wc,p,signal);
  if(cmd==='dialog')return {dialog:browserDialog(wc)};
  if(cmd==='handleDialog')return {handled:await handleBrowserDialog(wc,p,signal),...await observeBrowser(wc,signal)};
  if(cmd==='navigate'){
    if(!allowed(p.url))throw new Error('Only the new lab website is allowed');
    const snap=await navigateBrowser(wc,p.url,{signal});return {...snap,url:snap.currentUrl,snapshot:snap.text,tabId};
  }
  if(cmd==='snapshot')return {...await observeBrowser(wc,signal),tabId};
  if(['click','double_click','right_click','hover','type','select','pressKey'].includes(cmd))return {...await interactBrowser(wc,{...p,action:cmd==='pressKey'?'key':cmd},signal),tabId};
  if(cmd==='upload')return {...await uploadBrowser(wc,p,signal),tabId};
  if(cmd==='download'){if(!allowed(p.url))throw new Error('Only test downloads are allowed');return {download:await w.downloads.start(wc,p.url,{signal,timeoutMs:p.timeout})};}
  if(cmd==='wait'){
    const wait=await waitForBrowserState(wc,{state:p.state,timeoutMs:p.timeout,text:p.text,signal});return {...await observeBrowser(wc,signal),tabId,diagnostics:{wait}};
  }
  if(['back','forward','reload'].includes(cmd)){
    if(cmd==='back'&&wc.canGoBack())wc.goBack();else if(cmd==='forward'&&wc.canGoForward())wc.goForward();else if(cmd==='reload')wc.reload();
    await waitForBrowserState(wc,{state:'stable',signal});return {...await observeBrowser(wc,signal),tabId};
  }
  if(cmd==='screenshot'||cmd==='thumbnail'){
    const image=await wc.capturePage();return {base64:(cmd==='thumbnail'?image.resize({width:400}):image).toJPEG(75).toString('base64'),tabId};
  }
  if(cmd==='show')return {};
  throw new Error('Unsupported test command: '+cmd);
}
app.whenReady().then(()=>{
  readline.createInterface({input:process.stdin}).on('line',async line=>{
    let message;try{message=JSON.parse(line);}catch{return;}
    if(message.type==='shutdown'){for(const w of workspaces.values())for(const win of w.tabs.values())if(!win.isDestroyed())win.destroy();app.exit(0);return;}
    if(message.type==='browser-cancel'){commands.get(message.id)?.abort(new Error('Test operation cancelled'));return;}
    const controller=new AbortController();commands.set(message.id,controller);
    fs.appendFileSync(path.join(root,'transport.jsonl'),JSON.stringify({at:Date.now(),stage:'start',id:message.id,cmd:message.cmd,tabId:message.params?.tabId,windows:[...workspaces.values()].flatMap(w=>[...w.tabs].map(([id,win])=>({id,destroyed:win.isDestroyed(),loading:!win.isDestroyed()&&win.webContents.isLoading(),url:!win.isDestroyed()&&win.webContents.getURL()})) )})+'\n');
    try{send({type:'browser-result',id:message.id,result:await command(message.cmd,message.params||{},controller.signal)});}
    catch(error){send({type:'browser-result',id:message.id,error:error.message});}
    finally{commands.delete(message.id);fs.appendFileSync(path.join(root,'transport.jsonl'),JSON.stringify({at:Date.now(),stage:'end',id:message.id,cmd:message.cmd})+'\n');}
  }).on('close',()=>app.exit(0));
  send({type:'ready'});
});
