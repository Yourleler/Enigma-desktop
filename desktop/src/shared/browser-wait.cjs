const DEFAULT_TIMEOUT_MS = 5000;
const {browserDialog,withDialogAwareness}=require('./browser-dialogs.cjs');
const DEFAULT_POLL_MS = 100;
const DEFAULT_QUIET_MS = 500;
const DEFAULT_STABLE_SAMPLES = 3;

const READ_BROWSER_STATE_SCRIPT = `
(() => {
  if (!window.__hanaBrowserWaitState) {
    const state = { mutationAt: Date.now(), observer: null };
    try {
      state.observer = new MutationObserver(() => {
        state.mutationAt = Date.now();
      });
      state.observer.observe(document.documentElement || document, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
    } catch {}
    window.__hanaBrowserWaitState = state;
  }
  const body = document.body;
  const root = document.documentElement;
  const text = ((body && body.innerText) || (root && root.innerText) || "").trim();
  const height = Math.max(
    body ? body.scrollHeight || 0 : 0,
    root ? root.scrollHeight || 0 : 0
  );
  const mutationAt = window.__hanaBrowserWaitState.mutationAt || Date.now();
  return {
    readyState: document.readyState,
    elementCount: document.getElementsByTagName("*").length,
    textLength: text.length,
    bodyHeight: height,
    mutationAgeMs: Date.now() - mutationAt,
  };
})()
`;

function normalizeWaitState(state) {
  const value = String(state || "").toLowerCase();
  if (value === "idle") return "stable";
  if (value === "domcontentloaded" || value === "load" || value === "stable" || value === "networkidle") {
    return value;
  }
  return "stable";
}

function signatureOf(sample) {
  return [
    sample?.readyState || "",
    sample?.elementCount || 0,
    sample?.textLength || 0,
    sample?.bodyHeight || 0,
  ].join(":");
}

function isReadyForState(sample, state) {
  if (!sample) return false;
  if (state === "domcontentloaded") return sample.readyState === "interactive" || sample.readyState === "complete";
  if (state === "load") return sample.readyState === "complete";
  return sample.readyState !== "loading";
}

async function readWaitScript(webContents,code,signal,timeoutMs) {
  signal?.throwIfAborted();
  if(browserDialog(webContents)){const error=new Error('BROWSER_DIALOG_OPEN');error.code='BROWSER_DIALOG_OPEN';throw error;}
  let timer,abort;
  try{return await Promise.race([
    withDialogAwareness(webContents,typeof webContents.executeJavaScriptInIsolatedWorld==='function'?webContents.executeJavaScriptInIsolatedWorld(812,[{code}]):webContents.executeJavaScript(code)),
    new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error('PAGE_UNRESPONSIVE: page observation timed out.')),Math.max(1,timeoutMs));
      abort=()=>reject(signal.reason||new Error('Browser wait cancelled'));signal?.addEventListener('abort',abort,{once:true});
    }),
  ]);}finally{clearTimeout(timer);if(abort)signal?.removeEventListener('abort',abort);}
}

async function waitForBrowserState(webContents, opts = {}) {
  const state = normalizeWaitState(opts.state);
  const timeoutMs = Math.max(0, Number(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
  const pollMs = Math.max(25, Number(opts.pollMs ?? DEFAULT_POLL_MS) || DEFAULT_POLL_MS);
  const quietMs = Math.max(0, Number(opts.quietMs ?? DEFAULT_QUIET_MS) || DEFAULT_QUIET_MS);
  const stableSamples = Math.max(1, Number(opts.stableSamples ?? DEFAULT_STABLE_SAMPLES) || DEFAULT_STABLE_SAMPLES);
  const started = Date.now();
  const minWaitMs = Math.max(0, Number(opts.minWaitMs) || 0);
  let last = null;
  let lastSignature = "";
  let sameCount = 0;

  while (Date.now() - started <= timeoutMs) {
    opts.signal?.throwIfAborted();
    if(browserDialog(webContents))return buildDiagnostics({state,started,last,timedOut:false,reason:'dialog-open'});
    try {
      last = await readWaitScript(webContents,READ_BROWSER_STATE_SCRIPT,opts.signal,timeoutMs-(Date.now()-started));
    } catch (error) {
      opts.signal?.throwIfAborted();
      if(error.code==='BROWSER_DIALOG_OPEN')return buildDiagnostics({state,started,last,timedOut:false,reason:'dialog-open'});
      if (!/context.*destroy|navigation|loading/i.test(error?.message || '')) throw error;
      last = null;
    }
    opts.signal?.throwIfAborted();
    if (opts.text && last) {
      const code = `((document.body && document.body.innerText) || '').includes(${JSON.stringify(String(opts.text))})`;
      try {last.textMatched=await readWaitScript(webContents,code,opts.signal,timeoutMs-(Date.now()-started));}
      catch(error){if(error.code==='BROWSER_DIALOG_OPEN')return buildDiagnostics({state,started,last,timedOut:false,reason:'dialog-open'});throw error;}
    }
    const ready = isReadyForState(last, state) && Date.now() - started >= minWaitMs && (!opts.text || last?.textMatched === true);
    if (ready && opts.text) return buildDiagnostics({state,started,last,timedOut:false,reason:'text-observed'});
    if (ready && (state === "domcontentloaded" || state === "load")) {
      return buildDiagnostics({ state, started, last, timedOut: false, reason: "state-ready" });
    }

    if (ready) {
      const signature = signatureOf(last);
      sameCount = signature === lastSignature ? sameCount + 1 : 1;
      lastSignature = signature;
      if (sameCount >= stableSamples || Number(last.mutationAgeMs || 0) >= quietMs) {
        return buildDiagnostics({ state, started, last, timedOut: false, reason: state === "networkidle" ? "stable-fallback" : "dom-stable" });
      }
    }

    await new Promise((resolve, reject) => {
      const finish = () => { opts.signal?.removeEventListener('abort', abort); resolve(); };
      const timer = setTimeout(finish, pollMs);
      const abort = () => { clearTimeout(timer); opts.signal?.removeEventListener('abort', abort); reject(opts.signal.reason || new Error('Browser operation cancelled')); };
      opts.signal?.addEventListener('abort', abort, {once:true});
      if (opts.signal?.aborted) abort();
    });
  }

  return buildDiagnostics({ state, started, last, timedOut: true, reason: "timeout" });
}

function buildDiagnostics({ state, started, last, timedOut, reason }) {
  return {
    state,
    timedOut,
    reason,
    elapsedMs: Date.now() - started,
    lastReadyState: last?.readyState || "",
    lastElementCount: Number(last?.elementCount || 0),
    lastTextLength: Number(last?.textLength || 0),
    lastBodyHeight: Number(last?.bodyHeight || 0),
    lastMutationAgeMs: Number(last?.mutationAgeMs || 0),
    textMatched: last?.textMatched === true,
  };
}

module.exports = {
  READ_BROWSER_STATE_SCRIPT,
  normalizeWaitState,
  waitForBrowserState,
};
