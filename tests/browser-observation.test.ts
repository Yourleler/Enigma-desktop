// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { collectObservation, prepareAction, navigateBrowser, interactBrowser, dragBrowser } from '../desktop/src/shared/browser-observation.cjs';
import { EventEmitter } from 'node:events';

beforeEach(() => {
  document.body.innerHTML = '<label for="title">标题</label><input id="title" value="原草稿"><button>保存</button><input type="password" aria-label="密码" value="private-fixture-value">';
  vi.spyOn(HTMLElement.prototype,'getClientRects').mockReturnValue([{x:0,y:0,width:120,height:30}] as any);
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({x:0,y:0,width:120,height:30} as DOMRect);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  document.elementFromPoint = vi.fn(() => document.querySelector('button'));
});
afterEach(() => { vi.restoreAllMocks();vi.useRealTimers();document.body.innerHTML=''; });

it('includes labelled and fixed controls but never exposes a password value', () => {
  document.querySelector('button')!.style.position='fixed';
  const snapshot=collectObservation('snapshot-a');
  expect(snapshot.text).toContain('标题');expect(snapshot.text).toContain('保存');
  expect(snapshot.text).toContain('private value');expect(snapshot.text).not.toContain('private-fixture-value');
  expect(snapshot.text).toContain('snapshot-a');
});

it('keeps a select label separate from its options', () => {
  document.body.innerHTML='<label>颜色 <select><option value="blue">蓝色</option><option value="green">绿色</option></select></label>';
  const snapshot=collectObservation('select');
  expect(snapshot.text).toContain('select "颜色"');
  expect(snapshot.text).toContain('"label":"蓝色","value":"blue"');
  expect(snapshot.text).not.toContain('select "颜色 蓝色');
});

it('rejects a reused ref from an old observation and changes made by the user', () => {
  collectObservation('old');collectObservation('fresh');
  expect(()=>prepareAction({action:'type',ref:1,snapshotId:'old'})).toThrow('STALE_SNAPSHOT');
  (document.querySelector('#title') as HTMLInputElement).value='用户刚改的草稿';
  expect(()=>prepareAction({action:'type',ref:1,snapshotId:'fresh'})).toThrow('STALE_ELEMENT');
  expect((document.querySelector('#title') as HTMLInputElement).value).toBe('用户刚改的草稿');
});

it('rejects changed button semantics and a covered target', () => {
  collectObservation('first');document.querySelector('button')!.textContent='删除';
  expect(()=>prepareAction({action:'click',ref:2,snapshotId:'first'})).toThrow('STALE_ELEMENT');
  collectObservation('second');document.elementFromPoint=vi.fn(()=>document.body);
  expect(()=>prepareAction({action:'click',ref:2,snapshotId:'second'})).toThrow('ELEMENT_COVERED');
});

it('supports replacement selection without editing until native text input runs', () => {
  document.elementFromPoint=vi.fn(()=>document.querySelector('#title'));
  collectObservation('text');prepareAction({action:'type',ref:1,snapshotId:'text',mode:'replace'});
  const field=document.querySelector('#title') as HTMLInputElement;
  expect(field.selectionStart).toBe(0);expect(field.selectionEnd).toBe(field.value.length);
  expect(field.value).toBe('原草稿');
});

it('clears the navigation timeout so a successful page is not stopped later', async () => {
  vi.useFakeTimers();
  const wc={loadURL:vi.fn().mockResolvedValue(undefined),stop:vi.fn(),executeJavaScriptInIsolatedWorld:vi.fn(async (_id, scripts)=>
    scripts[0].code.includes('collectObservation') ? {ok:true,value:{snapshotId:'ready',text:'loaded'}}
      : {readyState:'complete',mutationAgeMs:1000,elementCount:4,textLength:10,bodyHeight:500})};
  const result=await navigateBrowser(wc,'https://fixture.test');
  expect(result.snapshotId).toBe('ready');
  await vi.advanceTimersByTimeAsync(31000);expect(wc.stop).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('stops a pending navigation on cancellation and removes its timer', async () => {
  vi.useFakeTimers();
  const controller=new AbortController();
  const wc={loadURL:vi.fn(()=>new Promise(()=>{})),stop:vi.fn()};
  const operation=navigateBrowser(wc,'https://fixture.test',{signal:controller.signal});
  await Promise.resolve();await Promise.resolve();
  controller.abort(new Error('test cancellation'));
  await expect(operation).rejects.toThrow('test cancellation');
  expect(wc.stop).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
});

it('preserves useful target errors across the isolated world without dispatching input', async () => {
  const wc = {executeJavaScriptInIsolatedWorld: vi.fn(async () => ({ok:false,error:'ELEMENT_COVERED: close the dialog first'})), sendInputEvent:vi.fn()};
  await expect(interactBrowser(wc, {action:'click',snapshotId:'s',ref:1})).rejects.toThrow('ELEMENT_COVERED');
  expect(wc.sendInputEvent).not.toHaveBeenCalled();
});

it('bounds a frozen page and expires delayed preparation before it can focus or edit', async () => {
  vi.useFakeTimers();
  collectObservation('snapshot');
  let script = '';
  const wc = {executeJavaScriptInIsolatedWorld: vi.fn((_world, scripts) => {script=scripts[0].code;return new Promise(()=>{});}), insertText:vi.fn()};
  const operation = interactBrowser(wc, {action:'type',snapshotId:'snapshot',ref:1,text:'should not be written'});
  const check = expect(operation).rejects.toThrow('PAGE_UNRESPONSIVE');
  await vi.advanceTimersByTimeAsync(5001);await check;
  expect(wc.insertText).not.toHaveBeenCalled();
  expect(window.eval(script)).toMatchObject({ok:false,error:expect.stringContaining('OBSERVATION_EXPIRED')});
  expect((document.querySelector('#title') as HTMLInputElement).value).toBe('原草稿');
  expect(vi.getTimerCount()).toBe(0);
});

it('refuses to focus or edit a text control covered by another surface', () => {
  collectObservation('covered');
  const input=document.querySelector('#title') as HTMLInputElement;
  const focus=vi.spyOn(input,'focus');
  document.elementFromPoint=vi.fn(()=>document.body);
  expect(()=>prepareAction({action:'type',ref:1,snapshotId:'covered',text:'wrong'})).toThrow('ELEMENT_COVERED');
  expect(focus).not.toHaveBeenCalled();expect(input.value).toBe('原草稿');
});

it('cancels a drag without leaving the mouse held or interception enabled', async () => {
  const controller=new AbortController(),calls:any[]=[];
  const debug:any=new EventEmitter();
  debug.isAttached=()=>false;debug.attach=vi.fn();debug.detach=vi.fn();
  let held=false,intercepted=false;
  debug.sendCommand=vi.fn(async(method,params)=>{
    calls.push({method,params});
    if(method==='Input.setInterceptDrags')intercepted=params.enabled;
    if(method==='Input.dispatchMouseEvent'&&params.type==='mousePressed') {
      held=true;debug.emit('message',{},'Input.dragIntercepted',{data:{items:[],dragOperationsMask:1}});controller.abort(new Error('User took over'));
    }
    if(method==='Input.dispatchMouseEvent'&&params.type==='mouseReleased')held=false;
  });
  const wc:any={debugger:debug,once:vi.fn(),executeJavaScriptInIsolatedWorld:vi.fn(async()=>({ok:true,value:{source:{x:10,y:10},target:{x:100,y:100}}}))};
  await expect(dragBrowser(wc,{snapshotId:'s',ref:1,targetRef:2},controller.signal)).rejects.toThrow('User took over');
  expect(held).toBe(false);expect(intercepted).toBe(false);
  expect(calls.some(x=>x.params.type==='drop')).toBe(false);
  expect(calls.some(x=>x.params.type==='dragCancel')).toBe(true);
});
