import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {BrowserViewerUpdate,SidebarBrowserCommand} from '../types';
import {initTheme} from '../bootstrap';
import {BrowserChrome,type BrowserAction} from '../browser/BrowserChrome';
import {BrowserDialog} from '../components/preview/BrowserDialog';
import '../components/preview/SidebarBrowser.css';

declare function setTheme(name:string):void;
initTheme();
export function BrowserViewerApp(){
  const [state,setState]=useState<BrowserViewerUpdate|null>(null),[error,setError]=useState('');
  const header=useRef<HTMLDivElement>(null),live=useRef(state);live.current=state;
  useEffect(()=>{
    const off=window.hana?.onBrowserUpdate?.(value=>setState(value));let alive=true;
    void window.hana?.browserViewerState?.().then(value=>{if(alive)setState(value);}).catch(()=>{if(alive)setError('无法连接浏览器，请关闭窗口后重新打开。');});
    const themeOff=window.hana?.onSettingsChanged?.((type,data)=>{if(type==='theme-changed'&&data&&typeof data==='object'&&'theme' in data&&typeof data.theme==='string')setTheme(data.theme);});
    document.title='网页浏览器';return()=>{alive=false;if(typeof off==='function')off();if(typeof themeOff==='function')themeOff();};
  },[]);
  useLayoutEffect(()=>{
    const element=header.current;if(!element)return;const sync=()=>window.hana?.browserViewerLayout?.(Math.ceil(element.getBoundingClientRect().height));
    const observer=new ResizeObserver(sync);observer.observe(element);sync();return()=>observer.disconnect();
  },[]);
  const command=useCallback(async(action:BrowserAction,extra:Partial<SidebarBrowserCommand>={})=>{
    const before=live.current;if(!before||!window.hana?.browserViewerCommand)throw new Error('请使用匹配的最新桌面应用');
    const value=await window.hana.browserViewerCommand({action,sessionPath:before.sessionPath||null,tabId:before.activeTabId,...extra});
    if(live.current?.sessionPath===before.sessionPath)setState(value);
  },[]);
  return <section className="enigma-browser-window" aria-label="独立网页浏览器">
    <div ref={header} className="enigma-browser-window-header"><BrowserChrome state={state} ready={!!state&&!error} status={state?.loading?'正在加载…':state?.sessionPath?state.sessionTitle||'对话浏览器':'手动浏览'} onCommand={command}
      actions={<><button title="在主窗口继续查看同一网页" onClick={()=>void command('dock')}>放回侧栏</button><button aria-label="关闭独立窗口" title="关闭独立窗口，保留网页" onClick={()=>window.hana?.closeBrowserViewer?.()}>×</button></>}
      onPreview={download=>void command('previewDownload',{downloadId:download.id})}/>
      {error&&<div role="alert">{error}</div>}
      {state?.dialog&&<BrowserDialog key={state.dialog.dialogId} dialog={state.dialog} onRespond={async(accept,text)=>{await command('handleDialog',{dialogId:state.dialog!.dialogId,accept,text});}}/>}
    </div>
    <div className="enigma-browser-window-body">{!state?.tabs?.length&&<div className="enigma-browser-empty">输入网址或新建网页标签</div>}</div>
  </section>;
}
