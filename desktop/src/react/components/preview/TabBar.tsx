import { useStore } from '../../stores';
import { selectPreviewItems, selectOpenTabs, selectActiveTabId } from '../../stores/preview-slice';
import { closeTab, closePreview, setActiveTab } from '../../stores/preview-actions';
import type { PreviewItem } from '../../types';
import styles from './TabBar.module.css';
import { AppIcon } from '../../ui/app-icons';
import { openBrowserPreview } from '../../utils/browser-preview';
import {useLayoutEffect,useRef} from 'react';

function wheelDeltaToPixels(event: React.WheelEvent<HTMLElement>): number {
  const dominantDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return dominantDelta * 32;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return dominantDelta * event.currentTarget.clientWidth;
  return dominantDelta;
}

export function TabBar() {
  const strip=useRef<HTMLDivElement>(null);
  const openTabs = useStore(selectOpenTabs);
  const activeTabId = useStore(selectActiveTabId);
  const previewItems = useStore(selectPreviewItems);
  useLayoutEffect(()=>{
    const list=strip.current,active=list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if(!list||!active)return;
    const box=list.getBoundingClientRect(),tab=active.getBoundingClientRect();
    if(tab.right>box.right)list.scrollLeft+=tab.right-box.right+4;
    else if(tab.left<box.left)list.scrollLeft-=box.left-tab.left+4;
  },[activeTabId,openTabs.length]);

  const getPreviewItem = (id: string): PreviewItem | undefined =>
    previewItems.find((item: PreviewItem) => item.id === id);

  const getTitle = (id: string): string => {
    const a = getPreviewItem(id);
    return a?.title ?? id;
  };

  const handleCloseTab = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    closeTab(id);
    const { openTabs: after } = useStore.getState();
    if (after.length === 0) closePreview();
  };

  const handleSetActive = (id: string) => {
    setActiveTab(id);
  };

  const handleTabListWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const tabList = event.currentTarget;
    const maxScrollLeft = Math.max(0, tabList.scrollWidth - tabList.clientWidth);
    if (maxScrollLeft <= 0) return;

    const delta = wheelDeltaToPixels(event);
    if (delta === 0) return;

    const nextScrollLeft = Math.min(maxScrollLeft, Math.max(0, tabList.scrollLeft + delta));
    if (nextScrollLeft === tabList.scrollLeft) return;

    event.preventDefault();
    tabList.scrollLeft = nextScrollLeft;
  };

  return (
    <div className={styles.tabBar}>
      <div
        className={styles.tabList}
        ref={strip}
        role="tablist"
        aria-label="已打开的预览"
        data-testid="preview-tab-list"
        onWheel={handleTabListWheel}
      >
        {openTabs.map(id => (
          <div
            key={id}
            className={`${styles.tab}${id === activeTabId ? ` ${styles.tabActive}` : ''}`}
            role="tab"
            aria-selected={id === activeTabId}
            tabIndex={0}
            title={getTitle(id)}
            onClick={() => handleSetActive(id)}
            onDoubleClick={e => handleCloseTab(e, id)}
            onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); handleSetActive(id); } }}
          >
            <span className={styles.tabTitle}>{getTitle(id)}</span>
            <button
              type="button"
              className={styles.tabClose}
              aria-label={`关闭预览：${getTitle(id)}`}
              title={`关闭预览：${getTitle(id)}`}
              onClick={e => handleCloseTab(e, id)}
              onDoubleClick={e => e.stopPropagation()}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ))}
      </div>
      {window.platform?.sidebarBrowserBind && <button className={styles.closePanel} aria-label="打开网页浏览器" title="打开网页浏览器" onClick={() => openBrowserPreview({sessionPath: useStore.getState().currentSessionPath})}><AppIcon name="link" size={15}/></button>}
      <button className={styles.closePanel} aria-label="收起预览面板" title="收起预览面板，保留已打开的内容" onClick={closePreview}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </div>
  );
}
