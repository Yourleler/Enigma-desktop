// Electron does not implement window.prompt. Expose only this web-standard
// dialog operation, without giving the untrusted page any application APIs.
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('__enigmaWebPrompt',(message='',defaultValue='')=>
  ipcRenderer.sendSync('browser-page-prompt',{message:String(message).slice(0,5000),defaultPrompt:String(defaultValue).slice(0,2000)}));
contextBridge.executeInMainWorld({func:()=>{window.prompt=(message='',value='')=>window.__enigmaWebPrompt(message,value);}});
