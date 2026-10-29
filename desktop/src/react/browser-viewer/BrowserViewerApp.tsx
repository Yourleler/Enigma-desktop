/**
 * BrowserViewerApp.tsx — 浏览器查看器工具栏
 *
 * 工具栏只负责按钮和标签页显示。
 * WebContentsView 由 main.cjs 管理，attach 在工具栏下方区域。
 */

import { useState, useEffect, useMemo, useRef, type WheelEvent } from 'react';
import type { BrowserViewerTab, BrowserViewerUpdate } from '../types';
import { initTheme } from '../bootstrap';
import {BrowserDialog} from '../components/preview/BrowserDialog';
import type {BrowserPageDialog} from '../types';

declare function t(key: string): string;
declare function setTheme(name: string): void;

initTheme();

function tr(key: string, fallback: string) {
  try {
    const value = typeof t === 'function' ? t(key) : '';
    return value && value !== key ? value : fallback;
  } catch {
    return fallback;
  }
}

function isThemePayload(value: unknown): value is { theme: string } {
  return typeof value === 'object'
    && value !== null
    && 'theme' in value
    && typeof value.theme === 'string';
}

function tabTitle(tab: BrowserViewerTab) {
  const title = tab.title?.trim();
  if (title && title !== 'New Tab') return title;
  if (tab.url) {
    try {
      return new URL(tab.url).hostname || tab.url;
    } catch {
      return tab.url;
    }
  }
  return tr('browser.newTab', '新建网页');
}

export function BrowserViewerApp() {
  const [,setLocaleVersion]=useState(0);
  const [dialog,setDialog]=useState<BrowserPageDialog|null>(null);
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);
  const [sessionPath, setSessionPath] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const [tabs, setTabs] = useState<BrowserViewerTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const tabListRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const hana = window.hana;

    // 监听主题切换
    const unsubscribeSettings=hana?.onSettingsChanged?.((type: string, data: unknown) => {
      if (type === 'theme-changed' && isThemePayload(data)) setTheme(data.theme);
    });

    // 接收浏览器状态更新
    const apply=(data: BrowserViewerUpdate) => {
      if(data.dialog!==undefined)setDialog(data.dialog);
      if (Array.isArray(data.tabs)) setTabs(data.tabs);
      if (data.activeTabId !== undefined) setActiveTabId(data.activeTabId);
      if (data.canGoBack !== undefined) setCanBack(data.canGoBack);
      if (data.canGoForward !== undefined) setCanForward(data.canGoForward);
      if (data.sessionPath !== undefined) setSessionPath(data.sessionPath || null);
      if (data.sessionTitle !== undefined) setSessionTitle(data.sessionTitle || null);
      if (data.running === false) {
        setDialog(null);
        setCanBack(false);
        setCanForward(false);
        setTabs([]);
        setActiveTabId(null);
        setSessionPath(data.sessionPath || null);
        setSessionTitle(data.sessionTitle || null);
      }
    };
    const unsubscribe=hana?.onBrowserUpdate?.(apply);
    let alive=true;
    void hana?.browserViewerState?.().then(state=>{if(alive)apply(state);}).catch(()=>{});

    // i18n
    void (async()=>{const info=await hana?.getSplashInfo?.().catch(()=>null);await window.i18n?.load?.(info?.locale || 'zh');if(alive){document.title=tr('browser.title','网页浏览器');setLocaleVersion(value=>value+1);}})();
    return()=>{alive=false;if(typeof unsubscribe==='function')unsubscribe();if(typeof unsubscribeSettings==='function')unsubscribeSettings();};
  }, []);

  const hana = window.hana;
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.tabId === activeTabId) || tabs[0] || null,
    [tabs, activeTabId],
  );

  useEffect(() => {
    if (!activeTab) return;
    if (typeof activeTab.canGoBack === 'boolean') setCanBack(activeTab.canGoBack);
    if (typeof activeTab.canGoForward === 'boolean') setCanForward(activeTab.canGoForward);
  }, [activeTab]);

  useEffect(()=>{tabListRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({block:'nearest',inline:'nearest'});},[activeTabId]);

  const closeTab=async(tabId:string)=>{
    await hana?.browserCloseTab?.(tabId,sessionPath);
    // Older shells omit a viewer push when an inactive tab is closed. Read
    // authoritative workspace state so the removed tab cannot linger in UI.
    const current=await hana?.browserViewerState?.();
    if(current&&Array.isArray(current.tabs)){setTabs(current.tabs);setActiveTabId(current.activeTabId||null);}
  };

  const handleTabWheel = (event: WheelEvent<HTMLDivElement>) => {
    const el = tabListRef.current;
    if (!el) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ? event.deltaX
      : event.deltaY;
    if (!delta) return;
    el.scrollLeft += delta;
    event.preventDefault();
  };

  return (
    <>
      {dialog&&<div style={{position:'absolute',top:44,left:0,right:0,zIndex:100}}><BrowserDialog key={dialog.dialogId} dialog={dialog} onRespond={async(accept,text)=>{
        if(!activeTabId||!hana?.browserHandleDialog)throw new Error('标签页已关闭');
        await hana.browserHandleDialog({sessionPath,tabId:activeTabId,dialogId:dialog.dialogId,accept,text});setDialog(null);
      }}/></div>}
      <div className="toolbar">
        <div className="toolbar-left">
          {/* Close */}
          <button
            className="tb-btn close-btn"
            title="关闭独立窗口"
            onClick={() => hana?.closeBrowserViewer?.()}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
              <path d="M4 4l6 6M10 4l-6 6" />
            </svg>
          </button>

          {/* Only a conversation owns Agent control; manual browsing has no revocation. */}
          {sessionPath && <button
            className="stop-btn"
            title="停止控制：撤回所属对话的浏览器操作授权"
            onClick={() => hana?.browserEmergencyStop?.(sessionPath)}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <rect x="3" y="3" width="8" height="8" rx="1" fill="currentColor" stroke="none" />
            </svg>
          </button>}

          <div className="nav-sep" />

          {/* Back */}
          <button
            className={`tb-btn${canBack ? '' : ' disabled'}`}
            title={tr('browser.back', '后退')} disabled={!canBack}
            onClick={() => hana?.browserGoBack?.(sessionPath)}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8.5 2.5L4.5 7l4 4.5" />
            </svg>
          </button>

          {/* Forward */}
          <button
            className={`tb-btn${canForward ? '' : ' disabled'}`}
            title={tr('browser.forward', '前进')} disabled={!canForward}
            onClick={() => hana?.browserGoForward?.(sessionPath)}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5.5 2.5L9.5 7l-4 4.5" />
            </svg>
          </button>

          {/* Reload */}
          <button
            className="tb-btn"
            title={tr('browser.reload', '刷新网页')} disabled={!activeTab}
            onClick={() => hana?.browserReload?.(sessionPath)}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 7a4 4 0 1 1-4-4" />
              <path d="M11 3v2.5H8.5" />
            </svg>
          </button>
        </div>

        <div className="browser-tab-strip">
          {sessionTitle && (
            <span className="browser-session-label" title={sessionTitle}>
              {sessionTitle}
            </span>
          )}

          <div
            ref={tabListRef}
            className="browser-tab-list" role="tablist" aria-label="网页标签"
            onWheel={handleTabWheel}
          >
            {tabs.map((tab) => {
              const isActive = tab.tabId === (activeTab?.tabId || activeTabId);
              return (
                <div key={tab.tabId} className={`browser-tab${isActive ? ' active' : ''}`}>
                  <button className="browser-tab-title" role="tab" aria-selected={isActive} tabIndex={isActive?0:-1} title={tabTitle(tab)}
                    onClick={()=>hana?.browserSwitchTab?.(tab.tabId,sessionPath)}
                    onKeyDown={event=>{
                      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
                      event.preventDefault();const index=tabs.findIndex(item=>item.tabId===tab.tabId);
                      const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
                      tabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
                      hana?.browserSwitchTab?.(tabs[next].tabId,sessionPath);
                    }}>{tabTitle(tab)}</button>
                  <button
                    className="browser-tab-close"
                    title={tr('browser.closeTab', '关闭网页')} aria-label={`关闭网页：${tabTitle(tab)}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void closeTab(tab.tabId);
                    }}
                  >
                    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                      <path d="M4.5 4.5l5 5M9.5 4.5l-5 5" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>

          <button
            className="tb-btn new-tab-btn"
            title={tr('browser.newTab', '新建网页')}
            onClick={() => hana?.browserNewTab?.(sessionPath)}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <path d="M7 3v8M3 7h8" />
            </svg>
          </button>
        </div>

        <div className="toolbar-drag" />
      </div>

      {/* Card shadow frame (WebContentsView sits on top) */}
      <div className="card-frame">
        {tabs.length === 0 && (
          <div className="browser-empty-state">
            <p className="browser-empty-text">{tr('browser.emptyWorkspace', '没有打开的网页')}</p>
            <button
              className="browser-empty-action"
              onClick={() => hana?.browserNewTab?.(sessionPath)}
            >
              {tr('browser.newTab', '新建网页')}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
