import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import type {BrowserViewerUpdate,SidebarBrowserCommand} from '../types';
import {AppIcon} from '../ui/app-icons';
import {resolveBrowserAddress} from '../utils/browser-address';
import './BrowserChrome.css';

export type BrowserAction=SidebarBrowserCommand['action'];
interface Props {
  state:BrowserViewerUpdate|null;ready:boolean;status:string;surfaceId?:string|null;
  onCommand:(action:BrowserAction,extra?:Partial<SidebarBrowserCommand>)=>Promise<unknown>;
  onPreview:(download:NonNullable<BrowserViewerUpdate['downloads']>[number])=>void;
  actions?:ReactNode;
}
/** Shared browser chrome: the host supplies real state and scoped commands. */
export function BrowserChrome({state,ready,status,surfaceId,onCommand,onPreview,actions}:Props) {
  const [address,setAddress]=useState(''),[error,setError]=useState(''),[findOpen,setFindOpen]=useState(false),[query,setQuery]=useState(''),[matchCase,setMatchCase]=useState(false);
  const findTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const addressEditing=useRef(false),addressInput=useRef<HTMLInputElement>(null),findInput=useRef<HTMLInputElement>(null),tabStrip=useRef<HTMLDivElement>(null);
  const previousUrl=useRef<string|null|undefined>(undefined),previousTab=useRef<string|null|undefined>(undefined),live=useRef({state,ready,onCommand});live.current={state,ready,onCommand};
  const tabs=state?.tabs||[],downloads=state?.downloads||[],factor=state?.zoomFactor||1;
  const command=useCallback(async(action:BrowserAction,extra:Partial<SidebarBrowserCommand>={})=>{
    setError('');try{await onCommand(action,extra);}catch(reason){setError(reason instanceof Error?reason.message:'网页操作失败，请重试');}
  },[onCommand]);
  useEffect(()=>{
    const changed=previousTab.current!==state?.activeTabId;
    if(changed||!addressEditing.current)setAddress(state?.url==='about:blank'?'':state?.url||'');
    if(!changed&&previousUrl.current!==state?.url){setFindOpen(false);setQuery('');}
    previousUrl.current=state?.url;
    if(changed){previousTab.current=state?.activeTabId;addressEditing.current=false;setQuery(state?.find?.query||'');setMatchCase(state?.find?.matchCase||false);setFindOpen(!!state?.find?.query);}
  },[state?.url,state?.activeTabId]);
  useEffect(()=>{tabStrip.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({block:'nearest',inline:'nearest'});},[state?.activeTabId]);
  const focusFind=()=>{setFindOpen(true);requestAnimationFrame(()=>{findInput.current?.focus();findInput.current?.select();});};
  const focusAddress=()=>{addressInput.current?.focus();addressInput.current?.select();};
  useEffect(()=>window.platform?.onBrowserShortcut?.(event=>{
    if(!live.current.ready||event.tabId!==live.current.state?.activeTabId||(event.surfaceId||null)!==(surfaceId||null))return;
    if(event.key==='f')focusFind();else if(event.key==='l')focusAddress();
    else if(event.key==='t')void command('newTab');else if(event.key==='w')void command('closeTab',{tabId:event.tabId});
  }),[surfaceId,command]);
  // Debounce is bound to the active tab; switching cancels the old search.
  useEffect(()=>{
    if(!ready||!findOpen||!state?.activeTabId)return;
    if(state.find?.query===query&&state.find.matchCase===matchCase&&!state.find.pending)return;
    const tabId=state.activeTabId;
    const timer=setTimeout(()=>{if(live.current.state?.activeTabId===tabId)void command('find',{query,matchCase,tabId});},180);
    findTimer.current=timer;return()=>{clearTimeout(timer);if(findTimer.current===timer)findTimer.current=null;};
  },[query,matchCase,findOpen,state?.activeTabId,ready,command]);
  const navigate=()=>{try{const url=resolveBrowserAddress(address);addressEditing.current=false;setAddress(url);void command('navigate',{url});}catch(reason){setError((reason as Error).message);}};
  const closeFind=()=>{setFindOpen(false);setQuery('');void command('stopFind');void command('focusPage');};
  const advance=(forward:boolean)=>{if(findTimer.current){clearTimeout(findTimer.current);findTimer.current=null;}void command('find',{query,matchCase,next:true,forward});};
  return <div className="enigma-browser-chrome" onKeyDown={event=>{
    const mod=event.ctrlKey||event.metaKey;
    if(mod&&['l','f','t','w'].includes(event.key.toLowerCase())){event.preventDefault();event.stopPropagation();const key=event.key.toLowerCase();if(key==='l')focusAddress();else if(key==='f')focusFind();else if(key==='t')void command('newTab');else if(state?.activeTabId)void command('closeTab',{tabId:state.activeTabId});}
  }}>
    <div className="enigma-browser-tabbar"><span className="enigma-browser-label" title="这里管理网页标签；外层标签用于切换文件与浏览器">网页</span><div ref={tabStrip} className="enigma-browser-tabs" role="tablist" aria-label="网页标签">
      {tabs.map((tab,index)=><div key={tab.tabId} className="enigma-browser-tab" data-active={tab.tabId===state?.activeTabId}>
        <button role="tab" tabIndex={tab.tabId===state?.activeTabId?0:-1} aria-selected={tab.tabId===state?.activeTabId} disabled={!ready} title={tab.title||tab.url||'空白页'} onClick={()=>void command('switchTab',{tabId:tab.tabId})} onKeyDown={event=>{
          if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
          event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
          tabStrip.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();void command('switchTab',{tabId:tabs[next].tabId});
        }}>{tab.loading&&<span className="enigma-browser-loading-dot" aria-label="加载中"/>}{!tab.title||tab.title==='New Tab'?'空白页':tab.title}</button>
        <button aria-label={`关闭网页：${tab.title||'空白页'}`} title="关闭此网页" disabled={!ready} onClick={()=>void command('closeTab',{tabId:tab.tabId})}>×</button>
      </div>)}
    </div><button aria-label="新建网页标签" title="新建网页 · Cmd/Ctrl+T" disabled={!ready} onClick={()=>void command('newTab')}><AppIcon name="add" size={16}/></button>{actions}</div>
    <form className="enigma-browser-toolbar" onSubmit={event=>{event.preventDefault();navigate();}}>
      <button type="button" aria-label="后退" title="后退" disabled={!ready||!state?.canGoBack} onClick={()=>void command('back')}><AppIcon name="chevronLeft" size={16}/></button>
      <button type="button" aria-label="前进" title="前进" disabled={!ready||!state?.canGoForward} onClick={()=>void command('forward')}><AppIcon name="chevronRight" size={16}/></button>
      <button type="button" aria-label={state?.loading?'停止加载':'刷新网页'} title={state?.loading?'停止网页加载；不会停止 Agent':'刷新网页'} disabled={!ready||!state?.activeTabId} onClick={()=>void command(state?.loading?'stop':'reload')}><AppIcon name={state?.loading?'compact':'loop'} size={16}/></button>
      <input ref={addressInput} aria-label="网页地址" placeholder="输入网址 · Cmd/Ctrl+L" value={address} disabled={!ready} onFocus={event=>{addressEditing.current=true;event.currentTarget.select();}} onChange={event=>{addressEditing.current=true;setAddress(event.target.value);}} onBlur={()=>{addressEditing.current=false;}} onKeyDown={event=>{if(event.key==='Escape'){addressEditing.current=false;setAddress(state?.url||'');event.currentTarget.blur();}}}/>
      <button type="submit" aria-label="访问网址" title="访问网址" disabled={!ready||!address.trim()}><AppIcon name="arrowEnter" size={16}/></button>
      <button type="button" aria-label="查找网页内容" title="查找网页内容 · Cmd/Ctrl+F" aria-pressed={findOpen} disabled={!ready||!state?.activeTabId} onClick={()=>findOpen?closeFind():focusFind()}><AppIcon name="read" size={16}/></button>
    </form>
    <div className="enigma-browser-status"><span role="status" title={state?.sessionTitle||status}>{status}</span>
      <div className="enigma-browser-zoom"><button aria-label="缩小网页" title="缩小网页 · Cmd/Ctrl+-" disabled={!ready||!state?.activeTabId||factor<=.25} onClick={()=>void command('zoom',{zoomFactor:Math.max(.25,factor/1.1)})}>−</button><button title="恢复网页为 100%" aria-label={`页面缩放 ${Math.round(factor*100)}%，点击恢复`} disabled={!ready||!state?.activeTabId} onClick={()=>void command('zoom',{zoomFactor:1})}>{Math.round(factor*100)}%</button><button aria-label="放大网页" title="放大网页 · Cmd/Ctrl++" disabled={!ready||!state?.activeTabId||factor>=3} onClick={()=>void command('zoom',{zoomFactor:Math.min(3,factor*1.1)})}>＋</button></div>
      <button title="使用系统默认浏览器打开当前网址" disabled={!ready||!/^https?:/.test(state?.url||'')} onClick={()=>void command('openExternal')}>系统浏览器</button>
      {state?.sessionPath&&<button title="停止所属对话的浏览器操作并撤回 Agent 授权" disabled={!ready} onClick={()=>void command('emergencyStop')}>停止控制</button>}
    </div>
    {findOpen&&<div className="enigma-browser-find" role="search" aria-label="页内查找"><input ref={findInput} aria-label="查找网页内容" placeholder="在当前网页中查找" value={query} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();advance(!event.shiftKey);}else if(event.key==='Escape')closeFind();}}/><span role="status">{query?(state?.find?.query!==query||state.find.matchCase!==matchCase||state.find.pending?'查找中':state.find.matches?`${state.find.active} / ${state.find.matches}`:'未找到'):''}</span><button title="区分大小写" aria-label="区分大小写" aria-pressed={matchCase} onClick={()=>setMatchCase(value=>!value)}>Aa</button><button aria-label="上一个匹配" disabled={!query} onClick={()=>advance(false)}>↑</button><button aria-label="下一个匹配" disabled={!query} onClick={()=>advance(true)}>↓</button><button aria-label="关闭查找" onClick={closeFind}>×</button></div>}
    {(error||state?.error)&&<div className="enigma-browser-error" role="alert">{error||state?.error}<button onClick={()=>void command('reload')}>重试</button></div>}
    {!!downloads.length&&<details className="enigma-browser-downloads"><summary>下载（{downloads.length}）<span>{downloads.some(download=>download.state==='progress')?'下载中':'查看记录'}</span></summary>{downloads.map(download=><div key={download.id} className="enigma-browser-download-row"><span title={download.filename}>{download.filename}<small>{download.state==='completed'?'已完成':download.state==='progress'?`${Math.round(download.receivedBytes/1024)} KB · 下载中`:download.state==='cancelled'?'已取消':download.state==='missing'?'文件已移除':'下载中断，请重试'}</small></span>{download.state==='completed'&&<><button onClick={()=>onPreview(download)}>预览</button><button title="在文件管理器中显示" onClick={()=>void command('revealDownload',{downloadId:download.id})}>位置</button></>}{download.state==='progress'&&<button onClick={()=>void command('cancelDownload',{downloadId:download.id})}>取消</button>}</div>)}</details>}
  </div>;
}
