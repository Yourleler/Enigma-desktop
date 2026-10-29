import { useCallback, useEffect, useRef, useState } from 'react';
import type { SidebarBrowserCommand, SidebarBrowserState } from '../../types';
import { AppIcon } from '../../ui/app-icons';
import { useBrowserDock } from '../../hooks/use-browser-dock';
import { browserPreviewKey, takeBrowserNavigation } from '../../utils/browser-preview';
import './SidebarBrowser.css';
import { useStore } from '../../stores';
import {BrowserDialog} from './BrowserDialog';
import {openFilePreview} from '../../utils/file-preview';
import {extOfName} from '../../utils/file-kind';
import {BrowserChrome} from '../../browser/BrowserChrome';

export function SidebarBrowser({sessionPath}: {sessionPath?: string | null}) {
  const isCurrentSession = useStore(store => store.currentSessionPath === sessionPath);
  const [state, setState] = useState<SidebarBrowserState | null>(null);
  const current = useRef<SidebarBrowserState | null>(null);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const live = useRef<string | null>(null);
  const visible = useBrowserDock(viewport, state && !state.detached && !state.dialog ? state.surfaceId : null);
  const accept = useCallback((update: SidebarBrowserState) => {
    if (update.surfaceId !== live.current) return;
    const next = {...current.current, ...update};
    current.current = next; setState(next);
  }, []);

  const command = useCallback(async (action: SidebarBrowserCommand['action'], extra: Partial<SidebarBrowserCommand> = {}) => {
    const surfaceId = live.current;
    if (!surfaceId || !window.platform.sidebarBrowserCommand) return;
    setError('');
    try {
      const update = await window.platform.sidebarBrowserCommand({surfaceId, action, tabId: current.current?.activeTabId, ...extra});
      accept(update);
    } catch (failure) {
      if (live.current === surfaceId) setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [accept]);

  useEffect(() => {
    const platform = window.platform;
    if (!platform.sidebarBrowserBind) return;
    const surfaceId = crypto.randomUUID();
    live.current = surfaceId; current.current = null; setState(null); setError('');
    const unsubscribe = platform.onSidebarBrowserUpdate?.(accept);
    const navigatePending = () => {
      if (live.current !== surfaceId || !current.current || current.current.detached) return;
      const url = takeBrowserNavigation(sessionPath);
      if (url) void command('newTab', {url});
    };
    const onNavigation = (event: Event) => {
      if ((event as CustomEvent).detail === browserPreviewKey(sessionPath)) {if(current.current?.detached)setConnection(value=>value+1);else navigatePending();}
    };
    window.addEventListener('enigma-browser-navigation', onNavigation);
    void platform.sidebarBrowserBind({surfaceId, sessionPath}).then(update => {
      if (live.current !== surfaceId) return;
      accept(update); navigatePending();
    }).catch(failure => {
      if (live.current === surfaceId) setError(failure instanceof Error ? failure.message : String(failure));
    });
    return () => {
      if (live.current === surfaceId) live.current = null;
      unsubscribe?.(); window.removeEventListener('enigma-browser-navigation', onNavigation);
      void platform.sidebarBrowserRelease?.(surfaceId).catch(() => {});
    };
  }, [accept, command, connection, sessionPath]);

  if (!window.platform?.sidebarBrowserBind) return <div className="enigma-browser-empty" role="status">内置浏览器需要桌面应用。请在桌面打开，或使用系统浏览器。</div>;
  const ready = !!state && !state.detached;
  const tabs = state?.tabs || [];
  return <section className="enigma-sidebar-browser" aria-label="网页浏览器">
    <BrowserChrome state={{...state,sessionPath:sessionPath||null}} ready={ready} surfaceId={state?.surfaceId} onCommand={command}
      status={!ready?state?.detached?'已移至独立窗口':error?'连接失败':'正在连接浏览器…':state?.loading?'正在加载…':state?.error?'加载失败':sessionPath?isCurrentSession?'本对话的浏览器':state?.sessionTitle||'另一对话的浏览器':'手动浏览'}
      actions={ready&&<button title="在独立窗口继续查看同一页面" onClick={()=>void command('detach')}>独立窗口</button>}
      onPreview={download=>{if(download.filePath)void openFilePreview(download.filePath,download.filename,extOfName(download.filename)||'',{origin:'desk'});}}/>
    {error&&<div role="alert" className="enigma-browser-error">{error}<button onClick={()=>setConnection(value=>value+1)}>重新连接</button></div>}
    {state?.dialog&&<BrowserDialog key={state.dialog.dialogId} dialog={state.dialog} onRespond={async(confirmed,text)=>{
      const update=await window.platform.sidebarBrowserCommand!({surfaceId:state.surfaceId,action:'handleDialog',tabId:state.activeTabId,dialogId:state.dialog!.dialogId,accept:confirmed,text});accept(update);
    }}/>}
    {state?.detached && <div className="enigma-browser-empty"><p>网页已移至独立窗口，页面内容和输入仍保留。</p><button onClick={() => setConnection(value => value + 1)}>放回侧栏</button></div>}
    <div className="enigma-browser-viewport" ref={viewport} hidden={!!state?.detached}>
      {state?.previewImage && !visible && <img src={state.previewImage} alt="暂时隐藏的网页画面" className="enigma-browser-placeholder"/>}
      {ready && !tabs.length && <div className="enigma-browser-empty"><AppIcon name="link" size={24}/><p>在上方输入网址，或新建网页标签。</p><small>收起面板会保留网页。{sessionPath?'“停止控制”会结束该对话的浏览器操作。':''}</small></div>}
    </div>
  </section>;
}
