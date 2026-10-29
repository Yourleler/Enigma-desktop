import {EventEmitter} from 'node:events';
import {expect,it,vi} from 'vitest';
import {installBrowserDialogs,browserDialog,withDialogAwareness,handleBrowserDialog,bindBrowserPromptIpc} from '../desktop/src/shared/browser-dialogs.cjs';
function fixture(){const debug:any=new EventEmitter();debug.isAttached=()=>true;debug.sendCommand=vi.fn(async()=>({}));const wc:any=new EventEmitter();wc.debugger=debug;wc.getURL=()=> 'https://fixture.invalid';wc.getTitle=()=> 'Fixture';return {wc,debug};}
it('unblocks the observer without accepting an untrusted dialog',async()=>{
  const {wc,debug}=fixture();installBrowserDialogs(wc);
  const waiting=withDialogAwareness(wc,new Promise(()=>{}));
  debug.emit('message',{},'Page.javascriptDialogOpening',{type:'confirm',message:'Delete?',url:'https://fixture.invalid'},'');
  await expect(waiting).rejects.toThrow('BROWSER_DIALOG_OPEN');
  const dialog=browserDialog(wc);expect(dialog.type).toBe('confirm');expect(debug.sendCommand).not.toHaveBeenCalled();
  await expect(handleBrowserDialog(wc,{dialogId:'wrong',accept:true})).rejects.toThrow('DIALOG_CHANGED');
  await handleBrowserDialog(wc,{dialogId:dialog.dialogId,accept:false});
  expect(debug.sendCommand).toHaveBeenCalledWith('Page.handleJavaScriptDialog',{accept:false},undefined);
});
it('exposes only prompt replies from an explicitly allowed browser page',async()=>{
  const {wc}=fixture(),ipc=new EventEmitter();bindBrowserPromptIpc(ipc,sender=>sender===wc);
  const forbidden:any={sender:{},returnValue:undefined};ipc.emit('browser-page-prompt',forbidden,{message:'x'});expect(forbidden.returnValue).toBeNull();
  const allowed:any={sender:wc,returnValue:undefined};ipc.emit('browser-page-prompt',allowed,{message:'备注',defaultPrompt:'默认'});
  expect(allowed.returnValue).toBeUndefined();
  const dialog=browserDialog(wc);expect(dialog.type).toBe('prompt');
  await handleBrowserDialog(wc,{dialogId:dialog.dialogId,accept:true,text:'中文'});
  expect(allowed.returnValue).toBe('中文');expect(browserDialog(wc)).toBeNull();
});
it('resolves a blocked prompt when its page is destroyed',()=>{
  const {wc}=fixture(),resolve=vi.fn();installBrowserDialogs(wc).prompt({message:'test'},resolve);wc.emit('destroyed');expect(resolve).toHaveBeenCalledWith(null);
});
