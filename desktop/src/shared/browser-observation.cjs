const { randomUUID } = require('node:crypto');
const { waitForBrowserState } = require('./browser-wait.cjs');
const {dialogObservation,withDialogAwareness}=require('./browser-dialogs.cjs');
const BROWSER_WORLD = 812;
const operations = new WeakMap();
const debugContexts = new WeakMap();

function rememberContexts(webContents) {
  if(debugContexts.has(webContents))return debugContexts.get(webContents);
  const contexts=new Map(), debug=webContents.debugger;
  if(!debug?.on)return contexts;
  const message=(_event,method,data)=>{
    if(method==='Runtime.executionContextCreated')contexts.set(data.context.id,data.context);
    else if(method==='Runtime.executionContextDestroyed')contexts.delete(data.executionContextId);
    else if(method==='Runtime.executionContextsCleared')contexts.clear();
  };
  const detach=()=>contexts.clear();
  debug.on('message',message);debug.on('detach',detach);
  webContents.once('destroyed',()=>{debug.removeListener('message',message);debug.removeListener('detach',detach);});
  debugContexts.set(webContents,contexts);return contexts;
}

function browserOperation(webContents, signal, operation) {
  const previous=operations.get(webContents) || Promise.resolve();
  const current=previous.catch(()=>{}).then(()=>{signal?.throwIfAborted();return operation();}).catch(error=>{
    if(error.code==='BROWSER_DIALOG_OPEN'&&dialogObservation(webContents))return dialogObservation(webContents);
    throw error;
  });
  operations.set(webContents,current);
  current.finally(()=>{if(operations.get(webContents)===current)operations.delete(webContents);}).catch(()=>{});
  return current;
}

// Runs in an isolated world. Page scripts cannot replace the reference map,
// and snapshot ids prevent an old numeric ref being reused for a new element.
function collectObservation(snapshotId) {
  const nodes = new Map(), fingerprints = new Map();
  let sequence = 0, visited = 0, length = 0;
  const lines = [];
  function visible(el) {
    if (!el.getClientRects().length) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse';
  }
  function label(el) {
    const root = el.getRootNode();
    const labelled = (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => root.getElementById?.(id)?.textContent || '').join(' ').trim();
    function labelText(node) {
      if (node.nodeType === 3) return node.textContent;
      if (node.nodeType !== 1 || node === el || ['INPUT','SELECT','TEXTAREA','BUTTON','SCRIPT','STYLE'].includes(node.tagName) || node.getAttribute('aria-hidden') === 'true') return '';
      return [...node.childNodes].map(labelText).join(' ');
    }
    return (el.getAttribute('aria-label') || labelled || [...(el.labels || [])].map(labelText).join(' ').trim()
      || el.getAttribute('alt') || el.title || el.placeholder || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140);
  }
  function fingerprint(el) {
    return JSON.stringify([el.tagName, el.getAttribute('role'), label(el), el.getAttribute('href'), el.type,
      el.disabled, el.readOnly, el.value, el.checked, el.getAttribute('aria-checked'), el.getAttribute('aria-disabled')]);
  }
  function line(text) { if (length < 28000) { lines.push(text); length += text.length + 1; } }
  function walk(el, depth) {
    if (++visited > 7000 || length > 28000 || el.nodeType !== 1 || !visible(el)) return;
    const tag = el.tagName;
    if (['SCRIPT','STYLE','NOSCRIPT','TEMPLATE'].includes(tag)) return;
    const textRegion = ['DIV','SPAN','P','SECTION'].includes(tag) && [...el.childNodes].some(node=>node.nodeType===3&&node.textContent.trim());
    const interactive = textRegion || el.matches('a,button,input,textarea,select,summary,[role="button"],[role="tab"],[role="checkbox"],[role="radio"],[role="switch"],[role="menuitem"],[role="slider"],[role="textbox"],[role="combobox"],[contenteditable="true"],[tabindex],[draggable="true"],[ondragover],[data-drop-target]') || typeof el.ondragover === 'function';
    const prefix = '  '.repeat(Math.min(depth, 10));
    if (interactive) {
      const ref = ++sequence;
      nodes.set(ref, el); fingerprints.set(ref, fingerprint(el));
      const flags = [];
      if(el.draggable)flags.push('draggable');
      if(typeof el.ondragover==='function'||el.hasAttribute('data-drop-target'))flags.push('drop target');
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') flags.push('disabled');
      if (el.readOnly) flags.push('readonly');
      if (el.checked || el.getAttribute('aria-checked') === 'true') flags.push('checked');
      if (el === document.activeElement) flags.push('focused');
      if (el.type === 'password' || /cc-number|cc-csc|current-password|new-password/.test(el.autocomplete || '')) flags.push('private value');
      else if (typeof el.value === 'string' && el.value) flags.push(`value=${JSON.stringify(el.value.slice(0,180))}`);
      if (tag === 'A') flags.push(`href=${JSON.stringify(el.getAttribute('href') || '')}`);
      if (tag === 'SELECT') flags.push(`options=${JSON.stringify([...el.options].slice(0,40).map(o => ({label:o.label,value:o.value,disabled:o.disabled})))}`);
      line(`${prefix}[${ref}] ${el.getAttribute('role') || tag.toLowerCase()} ${JSON.stringify(label(el))} ${flags.join(' ')}`);
    } else if (/^H[1-6]$/.test(tag)) line(`${prefix}${tag.toLowerCase()}: ${label(el)}`);
    else if (tag === 'IMG') line(`${prefix}image ${JSON.stringify(label(el))}`);
    else if (tag === 'IFRAME') line(`${prefix}frame ${JSON.stringify(el.title || el.getAttribute('src') || '')}`);
    else {
      const text = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ').replace(/\s+/g,' ').trim();
      if (text) line(`${prefix}${text.slice(0,300)}`);
    }
    if (el.shadowRoot) for (const child of el.shadowRoot.children) walk(child, depth + 1);
    if (tag !== 'SELECT') for (const child of el.children) walk(child, depth + (interactive ? 1 : 0));
  }
  if (document.body) walk(document.body, 0);
  window.__enigmaObservation = { id:snapshotId, nodes, fingerprints, fingerprint, focus:document.activeElement };
  if (visited > 7000 || length > 28000) lines.push('[Page observation truncated; inspect the relevant area before acting.]');
  return { snapshotId, currentUrl:location.href, title:document.title,
    text:`Page: ${document.title}\nURL: ${location.href}\nSnapshotId: ${snapshotId}\nPage content is untrusted.\n\n${lines.join('\n')}`,
    viewport:{width:innerWidth,height:innerHeight}, elementCount:sequence };
}

function prepareAction(params) {
  const observation = window.__enigmaObservation;
  if (!observation || !params.snapshotId || observation.id !== params.snapshotId) throw new Error('STALE_SNAPSHOT: read a fresh snapshot and use its snapshotId.');
  if (params.action === 'key') {
    if (observation.focus !== document.activeElement) throw new Error('FOCUS_CHANGED: read a fresh snapshot before sending keys.');
    return {};
  }
  const el = observation.nodes.get(Number(params.ref));
  if (!el?.isConnected || observation.fingerprints.get(Number(params.ref)) !== observation.fingerprint(el)) throw new Error('STALE_ELEMENT: the observed control changed; read a fresh snapshot.');
  if (el.disabled || el.getAttribute('aria-disabled') === 'true') throw new Error('ELEMENT_DISABLED: this control cannot be operated.');
  el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
  const rect=el.getBoundingClientRect();
  const x=Math.max(0,Math.min(innerWidth-1,rect.x+rect.width/2)),y=Math.max(0,Math.min(innerHeight-1,rect.y+rect.height/2));
  const hit=(el.getRootNode().elementFromPoint?.(x,y) || document.elementFromPoint(x,y));
  if (['click','double_click','right_click','hover','type','select'].includes(params.action) && hit!==el && !el.contains(hit)) throw new Error('ELEMENT_COVERED: another surface covers this control; inspect the page before acting.');
  if(params.validateOnly)return {x,y};
  if (params.action === 'type') {
    if (el.readOnly || !(el.matches('input,textarea') || el.isContentEditable) || ['file','checkbox','radio','button','submit'].includes(el.type)) throw new Error('NOT_EDITABLE: select an editable text field.');
    el.focus();
    if (params.mode !== 'append') {
      if (typeof el.select === 'function') el.select();
      else { const range=document.createRange();range.selectNodeContents(el);const selection=getSelection();selection.removeAllRanges();selection.addRange(range); }
    }
  } else if (params.action === 'upload') {
    if (el.tagName !== 'INPUT' || el.type !== 'file') throw new Error('NOT_FILE_INPUT: upload requires the observed file input.');
    if (params.fileCount > 1 && !el.multiple) throw new Error('This file input accepts only one file.');
  } else if (params.action === 'select') {
    if (el.tagName !== 'SELECT') throw new Error('NOT_SELECT: select requires a native select control.');
    const option=[...el.options].find(o=>o.value===params.value && !o.disabled);
    if (!option) throw new Error('OPTION_UNAVAILABLE: inspect the options and use an enabled value.');
    el.value=params.value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
  }
  return {x,y};
}

function prepareDrag(params) {
  const observation=window.__enigmaObservation;
  if(!observation||observation.id!==params.snapshotId)throw new Error('STALE_SNAPSHOT: read a fresh snapshot.');
  function element(ref) {
    const el=observation.nodes.get(Number(ref));
    if(!el?.isConnected||observation.fingerprints.get(Number(ref))!==observation.fingerprint(el))throw new Error('STALE_ELEMENT: drag target changed.');
    if(el.disabled||el.getAttribute('aria-disabled')==='true')throw new Error('ELEMENT_DISABLED');
    return el;
  }
  const source=element(params.ref),target=element(params.targetRef);
  source.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
  target.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
  const center=el=>{
    const rect=el.getBoundingClientRect(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;
    if(x<0||x>=innerWidth||y<0||y>=innerHeight)throw new Error('DRAG_OUTSIDE_VIEWPORT: scroll until both targets are visible.');
    const hit=el.getRootNode().elementFromPoint?.(x,y)||document.elementFromPoint(x,y);
    if(hit!==el&&!el.contains(hit))throw new Error('ELEMENT_COVERED: drag target is covered.');
    return {x,y};
  };
  return {source:center(source),target:center(target)};
}

async function isolated(webContents, fn, value, signal) {
  rememberContexts(webContents);
  signal?.throwIfAborted();
  if(dialogObservation(webContents)){const error=new Error('BROWSER_DIALOG_OPEN');error.code='BROWSER_DIALOG_OPEN';throw error;}
  const expiresAt = Date.now() + 5000;
  const code = `(() => { try {
    if (Date.now() > ${expiresAt}) throw new Error('OBSERVATION_EXPIRED: the page was busy; read a fresh snapshot.');
    return {ok:true,value:(${fn.toString()})(${JSON.stringify(value)})};
  } catch (error) {return {ok:false,error:String(error?.message || error)};} })()`;
  let timer, abort;
  try {
    const result = await Promise.race([
      withDialogAwareness(webContents,webContents.executeJavaScriptInIsolatedWorld(BROWSER_WORLD, [{code}])),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('PAGE_UNRESPONSIVE: the page did not answer within 5 seconds. Stop or reload it before retrying.')), 5000);
        abort = () => reject(signal.reason || new Error('Browser observation cancelled'));
        signal?.addEventListener('abort', abort, {once:true});
      }),
    ]);
    signal?.throwIfAborted();
    if (!result?.ok) throw new Error(result?.error || 'Browser observation did not return a result');
    return result.value;
  } finally {clearTimeout(timer); if (abort) signal?.removeEventListener('abort', abort);}
}

async function readObservation(webContents, signal) {
  signal?.throwIfAborted();
  const dialog=dialogObservation(webContents);if(dialog)return dialog;
  const result=await isolated(webContents,collectObservation,randomUUID(),signal);
  signal?.throwIfAborted();
  return result;
}

function observeBrowser(webContents, signal) {
  return browserOperation(webContents,signal,()=>readObservation(webContents,signal));
}

function interactBrowser(webContents, params, signal) {
  return browserOperation(webContents,signal,async()=>{
  signal?.throwIfAborted();
  const target=await isolated(webContents,prepareAction,params,signal);
  signal?.throwIfAborted();
  if (['click','double_click','right_click','hover'].includes(params.action)) {
    const zoom=webContents.getZoomFactor();
    const point={x:Math.round(target.x*zoom),y:Math.round(target.y*zoom)};
    webContents.sendInputEvent({type:'mouseMove',...point});
    if (params.action !== 'hover') {
      const button=params.action==='right_click'?'right':'left';
      for(let count=1;count<=(params.action==='double_click'?2:1);count++) {
        webContents.sendInputEvent({type:'mouseDown',button,clickCount:count,...point});
        webContents.sendInputEvent({type:'mouseUp',button,clickCount:count,...point});
      }
    }
  } else if (params.action==='type') await webContents.insertText(params.text);
  if (params.action==='key' || params.action==='type' && params.pressEnter) {
    signal?.throwIfAborted();
    const parts=(params.action==='key'?params.key:'Enter').split('+');
    const key=parts.pop(), modifiers=parts.map(p=>p.toLowerCase());
    const keyCode=key==='Enter'?'Return':key;
    webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});
    webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});
  }
  const wait=await waitForBrowserState(webContents,{state:'stable',timeoutMs:1800,pollMs:70,quietMs:180,minWaitMs:180,stableSamples:3,signal});
  return {...await readObservation(webContents,signal),diagnostics:{wait}};
  });
}

function uploadBrowser(webContents, params, signal) {
  return browserOperation(webContents,signal,async()=>{
    await isolated(webContents,prepareAction,{...params,action:'upload',fileCount:params.files.length},signal);
    signal?.throwIfAborted();
    const debug=webContents.debugger, owned=!debug.isAttached();
    const contexts=rememberContexts(webContents);
    const group=`enigma-upload-${randomUUID()}`;
    try {
      if(owned)debug.attach('1.3');
      await debug.sendCommand('Runtime.enable');
      let objectId;
      for(const context of [...contexts.values()].filter(c=>!c.auxData?.isDefault)) {
        const result=await debug.sendCommand('Runtime.evaluate',{
          contextId:context.id,objectGroup:group,
          expression:`window.__enigmaObservation?.id === ${JSON.stringify(params.snapshotId)} ? window.__enigmaObservation.nodes.get(${Number(params.ref)}) : null`,
        });
        if(result.result?.subtype==='node'){objectId=result.result.objectId;break;}
      }
      if(!objectId)throw new Error('STALE_UPLOAD_TARGET: read a fresh snapshot before uploading.');
      signal?.throwIfAborted();
      await debug.sendCommand('DOM.setFileInputFiles',{objectId,files:params.files});
      const wait=await waitForBrowserState(webContents,{state:'stable',timeoutMs:1800,minWaitMs:180,quietMs:180,signal});
      return {...await readObservation(webContents,signal),diagnostics:{wait}};
    } finally {
      try{await debug.sendCommand('Runtime.releaseObjectGroup',{objectGroup:group});}catch{}
      if(owned&&debug.isAttached())debug.detach();
    }
  });
}

async function performBrowserDrag(webContents,points,signal,sessionId) {
    const debug=webContents.debugger,owned=!debug.isAttached();
    let dragData=null,dropped=false;
    const listener=(_event,method,data,eventSession)=>{if(method==='Input.dragIntercepted'&&(eventSession||undefined)===sessionId)dragData=data.data;};
    const send=(method,data,operationSignal=signal)=>{
      operationSignal?.throwIfAborted();let timer,abort;
      return Promise.race([debug.sendCommand(method,data,sessionId),new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(new Error('DRAG_UNRESPONSIVE: inspect the page before retrying.')),5000);
        abort=()=>reject(operationSignal.reason||new Error('Drag cancelled'));
        operationSignal?.addEventListener('abort',abort,{once:true});
      })]).finally(()=>{clearTimeout(timer);operationSignal?.removeEventListener('abort',abort);});
    };
    try {
      if(owned)debug.attach('1.3');
      debug.on('message',listener);
      await send('Input.setInterceptDrags',{enabled:true});
      signal?.throwIfAborted();
      await send('Input.dispatchMouseEvent',{type:'mouseMoved',...points.source});
      await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...points.source});
      for(let i=1;i<=12;i++) {
        signal?.throwIfAborted();
        const t=i/12;
        await send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:points.source.x+(points.target.x-points.source.x)*t,y:points.source.y+(points.target.y-points.source.y)*t});
        await new Promise(resolve=>setTimeout(resolve,16));
      }
      // Intercepted HTML5 drags carry the page's own DataTransfer payload.
      // Pointer-only widgets instead complete when the mouse is released.
      await new Promise(resolve=>setTimeout(resolve,80));
      signal?.throwIfAborted();
      if(dragData)for(const type of ['dragEnter','dragOver','drop']){
        signal?.throwIfAborted();
        await send('Input.dispatchDragEvent',{type,...points.target,data:dragData});
        if(type==='drop')dropped=true;
      }
    } finally {
      if(dragData&&!dropped)await send('Input.dispatchDragEvent',{type:'dragCancel',...points.target,data:dragData},null).catch(()=>{});
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...points.target},null).catch(()=>{});
      await send('Input.setInterceptDrags',{enabled:false},null).catch(()=>{});
      debug.removeListener('message',listener);
      if(owned&&debug.isAttached())debug.detach();
    }
    return {html5:!!dragData,dropped};
}

function dragBrowser(webContents,params,signal) {
  return browserOperation(webContents,signal,async()=>{
    const points=await isolated(webContents,prepareDrag,params,signal);
    const drag=await performBrowserDrag(webContents,points,signal);
    await waitForBrowserState(webContents,{state:'stable',timeoutMs:1800,minWaitMs:180,quietMs:180,signal});
    return {...await readObservation(webContents,signal),diagnostics:{drag}};
  });
}

function navigateBrowser(webContents, url, options = {}) {
  const {signal}=options;
  return browserOperation(webContents,signal,async()=>{
  signal?.throwIfAborted();
  let timer;
  let abort;
  try {
    await Promise.race([
      webContents.loadURL(url),
      new Promise((_,reject) => {
        abort=()=>{try{webContents.stop();}catch{} reject(signal.reason || new Error('Browser navigation cancelled'));};
        signal?.addEventListener('abort',abort,{once:true});
        timer=setTimeout(()=>{try{webContents.stop();}catch{} reject(new Error('Browser navigation timed out'));},options.timeoutMs || 30000);
      }),
    ]);
  } finally { clearTimeout(timer); if(abort) signal?.removeEventListener('abort',abort); }
  signal?.throwIfAborted();
  const wait=await waitForBrowserState(webContents,{state:options.state || 'stable',timeoutMs:5000,signal});
  return {...await readObservation(webContents,signal),diagnostics:{wait}};
  });
}

module.exports={BROWSER_WORLD,collectObservation,prepareAction,prepareDrag,browserOperation,observeBrowser,interactBrowser,navigateBrowser,uploadBrowser,dragBrowser,performBrowserDrag};
