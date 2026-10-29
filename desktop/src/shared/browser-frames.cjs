const {randomUUID} = require('node:crypto');
const {collectObservation, prepareAction, prepareDrag, performBrowserDrag, browserOperation} = require('./browser-observation.cjs');
const hosts = new WeakMap();
const {dialogObservation,withDialogAwareness}=require('./browser-dialogs.cjs');

function bounded(promise, signal, timeout = 5000) {
  signal?.throwIfAborted();
  let timer, abort;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('FRAME_UNRESPONSIVE: frame did not answer; inspect or reload the page.')), timeout);
    abort = () => reject(signal.reason || new Error('Frame operation cancelled'));
    signal?.addEventListener('abort', abort, {once:true});
  })]).finally(() => {clearTimeout(timer); if(abort)signal?.removeEventListener('abort',abort);});
}

class BrowserFrames {
  constructor(wc) {
    this.wc = wc; this.debug = wc.debugger; this.sessions = new Set(); this.pending = new Set(); this.frames = new Map();
    this.ready = null;
    this.message = (_event, method, data) => {
      if (method === 'Target.attachedToTarget' && data.targetInfo.type === 'iframe') {
        this.sessions.add(data.sessionId);
        const setup = this.setup(data.sessionId).catch(() => this.sessions.delete(data.sessionId));
        this.pending.add(setup);setup.finally(() => this.pending.delete(setup));
      } else if (method === 'Target.detachedFromTarget') this.sessions.delete(data.sessionId);
    };
    this.detach = () => {this.ready = null;this.sessions.clear();this.frames.clear();};
    this.debug.on('message',this.message);this.debug.on('detach',this.detach);
    wc.once('destroyed',()=>{this.debug.removeListener('message',this.message);this.debug.removeListener('detach',this.detach);});
  }
  async setup(sessionId) {
    await this.debug.sendCommand('Page.enable', {}, sessionId);
    await this.debug.sendCommand('Runtime.enable', {}, sessionId);
    await this.debug.sendCommand('Target.setAutoAttach', {autoAttach:true,waitForDebuggerOnStart:false,flatten:true}, sessionId);
  }
  async connect(signal) {
    if (!this.ready) {
      if (!this.debug.isAttached()) this.debug.attach('1.3');
      this.ready = this.setup().catch(error => {this.ready=null;throw error;});
    }
    await bounded(this.ready, signal);
    for(let pass=0;pass<4&&this.pending.size;pass++) await bounded(Promise.all([...this.pending]),signal);
  }
  async list(signal) {
    await this.connect(signal);
    const frames = new Map();
    for (const sessionId of [undefined, ...this.sessions]) {
      let tree;
      try {tree = await bounded(this.debug.sendCommand('Page.getFrameTree', {}, sessionId),signal);} catch(error) {if(!sessionId)throw error;continue;}
      const walk = (node, parentId) => {
        if(frames.size>=64)return;
        const previous=frames.get(node.frame.id);
        frames.set(node.frame.id,{id:node.frame.id,parentId:node.frame.parentId||parentId||previous?.parentId||null,
          url:node.frame.url,name:node.frame.name||'',sessionId,loaderId:node.frame.loaderId});
        for(const child of node.childFrames||[])walk(child,node.frame.id);
      };
      if(tree.frameTree)walk(tree.frameTree,null);
    }
    this.frames=frames;
    return [...frames.values()].map(({id,parentId,url,name})=>({frameId:id,parentId,url,name}));
  }
  async frame(frameId,signal) {
    await this.list(signal);
    const frame = this.frames.get(frameId);
    if(!frame)throw new Error('FRAME_GONE: list frames again; this frame was removed.');
    return frame;
  }
  async evaluate(frame, fn, argument, signal) {
    if(dialogObservation(this.wc)){const error=new Error('BROWSER_DIALOG_OPEN');error.code='BROWSER_DIALOG_OPEN';throw error;}
    const {executionContextId} = await bounded(this.debug.sendCommand('Page.createIsolatedWorld', {frameId:frame.id,worldName:'enigma-frame-tools'},frame.sessionId),signal);
    const expiresAt=Date.now()+4500;
    const result=await bounded(withDialogAwareness(this.wc,this.debug.sendCommand('Runtime.evaluate', {
      contextId:executionContextId,returnByValue:true,awaitPromise:true,timeout:4500,
      expression:`(() => {if(Date.now()>${expiresAt})throw new Error('FRAME_OPERATION_EXPIRED');return (${fn.toString()})(${JSON.stringify(argument)});})()`,
    }, frame.sessionId)),signal);
    if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Frame script failed');
    return result.result.value;
  }
  async snapshot(frameId,signal) {
    const dialog=dialogObservation(this.wc);if(dialog)return dialog;
    const frame=await this.frame(frameId,signal);
    const snapshot=await this.evaluate(frame,collectObservation,randomUUID(),signal);
    return {...snapshot,frameId,text:`FrameId (copy exactly): ${frameId}\n${snapshot.text}`};
  }
  async expose(frame,signal) {
    if(!frame.parentId)return;
    const parent=this.frames.get(frame.parentId);
    if(!parent)throw new Error('FRAME_GONE: frame parent changed; inspect again.');
    await this.expose(parent,signal);
    const owner=await bounded(this.debug.sendCommand('DOM.getFrameOwner',{frameId:frame.id},parent.sessionId),signal);
    await bounded(this.debug.sendCommand('DOM.scrollIntoViewIfNeeded',{backendNodeId:owner.backendNodeId},parent.sessionId),signal);
  }
  async toTopPoint(frame, point, signal, inputPoint, depth=0) {
    if(depth>16)throw new Error('FRAME_DEPTH_EXCEEDED');
    if(!frame.parentId)return {...point,inputPoint:inputPoint||point};
    const parent=this.frames.get(frame.parentId);
    if(!parent)throw new Error('FRAME_GONE: frame parent changed.');
    const {backendNodeId}=await bounded(this.debug.sendCommand('DOM.getFrameOwner',{frameId:frame.id},parent.sessionId),signal);
    const viewport=await this.evaluate(frame,()=>({width:innerWidth,height:innerHeight}),null,signal);
    const {executionContextId}=await bounded(this.debug.sendCommand('Page.createIsolatedWorld',{frameId:parent.id,worldName:'enigma-frame-tools'},parent.sessionId),signal);
    const resolved=await bounded(this.debug.sendCommand('DOM.resolveNode',{backendNodeId,executionContextId},parent.sessionId),signal);
    let next;
    try {
      const hit=await bounded(this.debug.sendCommand('Runtime.callFunctionOn',{
        objectId:resolved.object.objectId,returnByValue:true,arguments:[{value:{point,viewport}}],
        functionDeclaration:`function({point,viewport}){
          const transform=new DOMMatrix(getComputedStyle(this).transform);
          if(Math.abs(transform.b)>.001||Math.abs(transform.c)>.001||!transform.is2D)return {rotated:true};
          const box=this.getBoundingClientRect(),sx=box.width/this.offsetWidth,sy=box.height/this.offsetHeight;
          const x=box.x+this.clientLeft*sx+point.x/viewport.width*this.clientWidth*sx;
          const y=box.y+this.clientTop*sy+point.y/viewport.height*this.clientHeight*sy;
          const hit=document.elementFromPoint(x,y);
          return {x,y,covered:hit!==this&&!this.contains(hit)};
        }`,
      },parent.sessionId),signal);
      next=hit.result.value;
      if(next?.rotated)throw new Error('FRAME_TRANSFORMED: rotated iframe requires visual computer control.');
      if(!next||next.covered||!Number.isFinite(next.x)||!Number.isFinite(next.y))throw new Error('FRAME_COVERED: another surface covers the iframe; inspect the page.');
    } finally {await bounded(this.debug.sendCommand('Runtime.releaseObject',{objectId:resolved.object.objectId},parent.sessionId),undefined,1000).catch(()=>{});}
    if(!inputPoint&&frame.sessionId!==parent.sessionId)inputPoint=point;
    return this.toTopPoint(parent,{x:next.x,y:next.y},signal,inputPoint,depth+1);
  }
  async interact(params,signal) {
    const frame=await this.frame(params.frameId,signal);
    await this.expose(frame,signal);
    const point=await this.evaluate(frame,prepareAction,{...params,validateOnly:true},signal);
    const top=params.action==='key'?null:await this.toTopPoint(frame,point,signal);
    if(params.action==='key')await this.checkFocus(frame,signal);
    await this.evaluate(frame,prepareAction,params,signal);
    signal?.throwIfAborted();
    if(['click','hover','double_click','right_click'].includes(params.action)) {
      const at=top.inputPoint;
      await bounded(this.debug.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',...at},frame.sessionId),signal);
      if(params.action!=='hover')for(let count=1;count<=(params.action==='double_click'?2:1);count++){
        const button=params.action==='right_click'?'right':'left';
        signal?.throwIfAborted();
        try {await bounded(this.debug.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',button,clickCount:count,...at},frame.sessionId),signal);}
        finally {await bounded(this.debug.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',button,clickCount:count,...at},frame.sessionId),undefined,1000).catch(()=>{});}
      }
    } else if(params.action==='type')await bounded(this.debug.sendCommand('Input.insertText',{text:params.text},frame.sessionId),signal);
    if(params.action==='key'||params.action==='type'&&params.pressEnter) {
      const keys=(params.action==='key'?params.key:'Enter').split('+'),key=keys.pop();
      const named={Enter:13,Return:13,Tab:9,Escape:27,Backspace:8,Delete:46,ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40,Home:36,End:35,PageUp:33,PageDown:34};
      const masks={alt:1,control:2,ctrl:2,meta:4,command:4,cmd:4,shift:8};
      if(keys.some(value=>!masks[value.toLowerCase()]))throw new Error('Unsupported keyboard modifier');
      const modifiers=keys.reduce((mask,value)=>mask|masks[value.toLowerCase()],0);
      const windowsVirtualKeyCode=named[key]||(key.length===1?key.toUpperCase().charCodeAt(0):0);
      if(!windowsVirtualKeyCode)throw new Error('Unsupported frame key');
      const event={key:key==='Return'?'Enter':key,windowsVirtualKeyCode,modifiers};
      const text=!(modifiers&7)?(key==='Enter'||key==='Return'?'\r':key.length===1?key:undefined):undefined;
      const code=/^[a-z]$/i.test(key)?'Key'+key.toUpperCase():key==='Return'?'Enter':key;
      const commands=key.toLowerCase()==='a'&&(process.platform==='darwin'?modifiers===4:modifiers===2)?['selectAll']:undefined;
      try {await bounded(this.debug.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',...event,code,...(text?{text}:{}),...(commands?{commands}:{})},frame.sessionId),signal);}
      finally {await bounded(this.debug.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',...event},frame.sessionId),undefined,1000).catch(()=>{});}
    }
    await bounded(new Promise(resolve=>setTimeout(resolve,200)),signal);
    return this.snapshot(params.frameId,signal);
  }
  async checkFocus(frame,signal) {
    if(!frame.parentId)return;
    const parent=this.frames.get(frame.parentId);
    if(!parent)throw new Error('FRAME_GONE');
    const {backendNodeId}=await bounded(this.debug.sendCommand('DOM.getFrameOwner',{frameId:frame.id},parent.sessionId),signal);
    const {executionContextId}=await bounded(this.debug.sendCommand('Page.createIsolatedWorld',{frameId:parent.id,worldName:'enigma-frame-tools'},parent.sessionId),signal);
    const {object}=await bounded(this.debug.sendCommand('DOM.resolveNode',{backendNodeId,executionContextId},parent.sessionId),signal);
    try {
      const result=await bounded(this.debug.sendCommand('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:'function(){return document.activeElement===this;}',returnByValue:true},parent.sessionId),signal);
      if(!result.result.value)throw new Error('FOCUS_CHANGED: another frame has focus; read a fresh snapshot.');
    } finally {await bounded(this.debug.sendCommand('Runtime.releaseObject',{objectId:object.objectId},parent.sessionId),undefined,1000).catch(()=>{});}
    await this.checkFocus(parent,signal);
  }
  async upload(params,signal) {
    const frame=await this.frame(params.frameId,signal);
    await this.evaluate(frame,prepareAction,{...params,action:'upload',fileCount:params.files.length},signal);
    const {executionContextId}=await bounded(this.debug.sendCommand('Page.createIsolatedWorld',{frameId:frame.id,worldName:'enigma-frame-tools'},frame.sessionId),signal);
    const group='enigma-frame-upload-'+randomUUID();
    try {
      const result=await bounded(this.debug.sendCommand('Runtime.evaluate',{contextId:executionContextId,objectGroup:group,
        expression:`window.__enigmaObservation?.id===${JSON.stringify(params.snapshotId)}?window.__enigmaObservation.nodes.get(${Number(params.ref)}):null`,
      },frame.sessionId),signal);
      if(result.result?.subtype!=='node')throw new Error('STALE_UPLOAD_TARGET: inspect the frame again.');
      signal?.throwIfAborted();
      await bounded(this.debug.sendCommand('DOM.setFileInputFiles',{objectId:result.result.objectId,files:params.files},frame.sessionId),signal);
    }finally {await bounded(this.debug.sendCommand('Runtime.releaseObjectGroup',{objectGroup:group},frame.sessionId),undefined,1000).catch(()=>{});}
    await bounded(new Promise(resolve=>setTimeout(resolve,200)),signal);
    return this.snapshot(params.frameId,signal);
  }
  async drag(params,signal) {
    const frame=await this.frame(params.frameId,signal);await this.expose(frame,signal);
    const points=await this.evaluate(frame,prepareDrag,params,signal);
    const source=await this.toTopPoint(frame,points.source,signal),target=await this.toTopPoint(frame,points.target,signal);
    await performBrowserDrag(this.wc,{source:{x:source.x,y:source.y},target:{x:target.x,y:target.y}},signal);
    await bounded(new Promise(resolve=>setTimeout(resolve,200)),signal);return this.snapshot(params.frameId,signal);
  }
}

function forBrowser(wc) {if(!hosts.has(wc))hosts.set(wc,new BrowserFrames(wc));return hosts.get(wc);}
function listBrowserFrames(wc,signal) {return browserOperation(wc,signal,()=>forBrowser(wc).list(signal));}
function runBrowserFrame(wc,params,signal) {return browserOperation(wc,signal,async()=>{
  const host=forBrowser(wc);
  if(params.action==='snapshot')return host.snapshot(params.frameId,signal);
  if(params.action==='upload')return host.upload(params,signal);
  if(params.action==='drag')return host.drag(params,signal);
  if(params.action==='scroll') {
    const frame=await host.frame(params.frameId,signal);
    await host.evaluate(frame,({direction,amount})=>scrollBy({top:(direction==='up'?-1:1)*amount*300,behavior:'instant'}),{direction:params.direction,amount:Math.min(10,Math.max(1,Number(params.amount)||3))},signal);
    return host.snapshot(params.frameId,signal);
  }
  if(params.action==='wait') {
    const until=Date.now()+Math.min(10000,Math.max(100,params.timeout||5000));
    let snapshot;
    do {
      snapshot=await host.snapshot(params.frameId,signal);
      if(!params.text||snapshot.text.includes(params.text))return snapshot;
      await bounded(new Promise(resolve=>setTimeout(resolve,150)),signal);
    } while(Date.now()<until);
    throw new Error('FRAME_WAIT_TIMEOUT: expected text did not appear.');
  }
  if(!['click','hover','double_click','right_click','type','key','select'].includes(params.action))throw new Error('Unsupported frame action');
  return host.interact(params,signal);
});}
module.exports={listBrowserFrames,runBrowserFrame};
