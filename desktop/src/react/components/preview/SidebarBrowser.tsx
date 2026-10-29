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

export function SidebarBrowser({sessionPath}: {sessionPath?: string | null}) {
  const isCurrentSession = useStore(store => store.currentSessionPath === sessionPath);
  const [state, setState] = useState<SidebarBrowserState | null>(null);
  const current = useRef<SidebarBrowserState | null>(null);
  const [address, setAddress] = useState('');
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
      if ((event as CustomEvent).detail === browserPreviewKey(sessionPath)) navigatePending();
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

  useEffect(() => { setAddress(state?.url === 'about:blank' ? '' : state?.url || ''); }, [state?.url, state?.activeTabId]);

  const navigate = () => {
    const raw = address.trim();
    if (!raw) return;
    let url: URL;
    try { url = new URL(/^https?:\/\//i.test(raw) ? raw : /^[\w.-]+(?::\d+)?(?:\/|$)/.test(raw) ? `https://${raw}` : raw); }
    catch { setError('请输入完整网址，例如 https://example.com'); return; }
    if (!['http:', 'https:'].includes(url.protocol)) { setError('只支持 http 和 https 网页'); return; }
    void command('navigate', {url: url.href});
  };

  if (!window.platform?.sidebarBrowserBind) return <div className="enigma-browser-empty" role="status">内置浏览器需要桌面应用。请在桌面打开，或使用系统浏览器。</div>;
  const ready = !!state && !state.detached;
  const tabs = state?.tabs || [];
  const downloads=state?.downloads||[];
  const downloading=downloads.filter(download=>download.state==='progress').length;
  return <section className="enigma-sidebar-browser" aria-label="网页浏览器">
    <div className="enigma-browser-tabs" role="tablist" aria-label="网页标签">
      {tabs.map(tab => <div className="enigma-browser-tab" key={tab.tabId} data-active={tab.tabId === state?.activeTabId}>
        <button role="tab" aria-selected={tab.tabId === state?.activeTabId} title={tab.title || tab.url || '空白页'} disabled={!ready} onClick={() => void command('switchTab', {tabId: tab.tabId})}>{tab.title === 'New Tab' ? '空白页' : tab.title || '空白页'}</button>
        <button aria-label={`关闭网页：${tab.title || '空白页'}`} title="关闭此网页" disabled={!ready} onClick={() => void command('closeTab', {tabId: tab.tabId})}>×</button>
      </div>)}
      <button aria-label="新建网页标签" title="新建网页标签" disabled={!ready} onClick={() => void command('newTab')}><AppIcon name="add" size={15}/></button>
    </div>
    <form className="enigma-browser-toolbar" onSubmit={event => {event.preventDefault(); navigate();}}>
      <button type="button" aria-label="后退" title="后退" disabled={!ready || !state?.canGoBack} onClick={() => void command('back')}><AppIcon name="chevronLeft" size={16}/></button>
      <button type="button" aria-label="前进" title="前进" disabled={!ready || !state?.canGoForward} onClick={() => void command('forward')}><AppIcon name="chevronRight" size={16}/></button>
      <button type="button" aria-label={state?.loading ? '停止加载' : '刷新网页'} title={state?.loading ? '停止加载，不停止 Agent' : '刷新网页'} disabled={!ready || !state?.activeTabId} onClick={() => void command(state?.loading ? 'stop' : 'reload')}><AppIcon name={state?.loading ? 'compact' : 'loop'} size={16}/></button>
      <input aria-label="网页地址" placeholder="输入网址并按回车" value={address} disabled={!ready} onChange={event => setAddress(event.target.value)} onFocus={event => event.currentTarget.select()}/>
      <button type="submit" aria-label="访问网址" title="访问网址" disabled={!ready || !address.trim()}><AppIcon name="arrowEnter" size={15}/></button>
    </form>
    <div className="enigma-browser-status"><span role="status" title={sessionPath?state?.sessionTitle || undefined:'此浏览器未绑定对话，可以手动浏览网页。'}>{!ready ? state?.detached ? '已移至独立窗口' : error ? '连接失败' : '正在连接浏览器…' : state?.loading ? '正在加载…' : state?.error ? '加载失败' : sessionPath ? isCurrentSession ? '本对话的浏览器' : state?.sessionTitle || '另一对话的浏览器' : '手动浏览'}</span>
      {ready && <><button title="在独立窗口继续查看同一页面" onClick={() => void command('detach')}>独立窗口</button>{sessionPath&&<button title="停止所属对话的浏览器操作并撤回 Agent 授权，直到下次发送消息" onClick={() => void command('emergencyStop')}>停止控制</button>}</>}
    </div>
    {(error || state?.error) && <div className="enigma-browser-error" role="alert">{error || state?.error}<button onClick={() => ready ? void command('reload') : setConnection(value => value + 1)}>重试</button></div>}
    {!!downloads.length && <details className="enigma-browser-downloads">
      <summary>下载（{downloads.length}）<span>{downloading?`${downloading} 项进行中`:downloads[0]?.state==='completed'?'已完成':'查看记录'}</span></summary>
      {downloads.map(download=><div key={download.id} className="enigma-browser-download-row">
        <span title={download.filename}>{download.filename}<small>{download.state==='completed'?'已完成':download.state==='progress'?`${Math.round(download.receivedBytes/1024)} KB · 下载中`:download.state==='cancelled'?'已取消':download.state==='missing'?'文件已移除':'下载中断，请重新下载'}</small></span>
        {download.state==='completed'&&download.filePath&&<><button onClick={()=>void openFilePreview(download.filePath!,download.filename,extOfName(download.filename)||'',{origin:'desk'})}>预览</button><button title="在文件管理器中显示" onClick={()=>void command('revealDownload',{downloadId:download.id})}>位置</button></>}
        {download.state==='progress'&&<button onClick={()=>void command('cancelDownload',{downloadId:download.id})}>取消</button>}
      </div>)}
    </details>}
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
