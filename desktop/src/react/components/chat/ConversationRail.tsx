import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TimelineAnchor } from './timeline-anchors';
import { formatTimelineAnchorLabel } from './timeline-anchors';
import styles from './ConversationRail.module.css';

interface Props {
  anchors: TimelineAnchor[];
  activeId: string | null;
  onJump: (anchor: TimelineAnchor) => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  onFind?: () => void;
}

export function ConversationRail({ anchors, activeId, onJump, hasMore, loadingMore, onLoadMore, onFind }: Props) {
  const previewId = useId();
  const nav = useRef<HTMLElement>(null), trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null);
  const markers = useRef<HTMLDivElement>(null);
  const [directory, setDirectory] = useState(false), [query, setQuery] = useState('');
  const [hover, setHover] = useState<{ anchor: TimelineAnchor; element: HTMLElement } | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeIndex = anchors.findIndex(anchor => anchor.messageId === activeId);
  const hoverIndex = anchors.findIndex(anchor => anchor.messageId === hover?.anchor.messageId);
  const filtered = useMemo(() => anchors.filter(anchor => (anchor.preview || anchor.label).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [anchors, query]);
  const closeHover = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setHover(null), 140); };
  const closeDirectory = () => { setDirectory(false); trigger.current?.focus(); };
  const jump = (anchor: TimelineAnchor) => { onJump(anchor); setHover(null); if (directory) closeDirectory(); };

  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    const list = markers.current;
    // Scroll only this rail, never the transcript or the whole window. Manual
    // wheel browsing stays put until the reading position actually changes.
    const selected = list?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!list || !selected) return;
    const top = selected.offsetTop;
    if (top < list.scrollTop) list.scrollTop = Math.max(0, top - 12);
    else if (top + selected.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + selected.offsetHeight - list.clientHeight + 12;
  }, [activeId, anchors.length]);
  useEffect(() => {
    if (!directory && !hover) return;
    const outside = (event: PointerEvent) => {
      if (nav.current?.contains(event.target as Node) || popup.current?.contains(event.target as Node)) return;
      setDirectory(false); setHover(null);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      setHover(null); if (directory) closeDirectory();
    };
    const scroll = (event: Event) => { if (!directory && !popup.current?.contains(event.target as Node)) setHover(null); };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', key, true); document.addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key, true); document.removeEventListener('scroll', scroll, true); };
  }, [directory, hover]);
  useLayoutEffect(() => {
    if ((!directory && !hover) || !popup.current) return;
    const place = () => {
      const anchor = (directory ? trigger.current : hover?.element)?.getBoundingClientRect();
      const panel = popup.current?.getBoundingClientRect();
      if (!anchor || !panel) return;
      setPosition({
        left: Math.max(8, Math.min(anchor.left - panel.width - 10, window.innerWidth - panel.width - 8)),
        top: Math.max(8, Math.min(directory ? anchor.top : anchor.top - panel.height / 2, window.innerHeight - panel.height - 8)),
      });
    };
    place(); const observer = new ResizeObserver(place); observer.observe(popup.current);
    window.addEventListener('resize', place);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); };
  }, [directory, hover, filtered.length]);
  useEffect(() => {
    if (directory) popup.current?.querySelector('input')?.focus();
  }, [directory]);
  if (!anchors.length) return null;
  const preview = hover?.anchor;
  return <nav ref={nav} className={styles.rail} aria-label="对话快速跳转">
    <button ref={trigger} type="button" className={styles.directoryTrigger} aria-label="打开对话目录" aria-expanded={directory} aria-haspopup="dialog" data-tooltip={`对话目录 · 已加载 ${anchors.length} 轮\n在刻度上滚动浏览；悬停预览，点击定位`} onClick={() => { setHover(null); setDirectory(value => !value); }}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12M3 6h1M3 12h1M3 18h1"/></svg>
    </button>
    <div ref={markers} className={styles.markers} data-tooltip-managed="" aria-label="滚动浏览对话轮次">
      {anchors.map((anchor,index) => {
        const selected = anchor.messageId === activeId;
        return <button key={anchor.messageId} type="button" className={`${styles.marker} ${selected ? styles.selected : ''}`} data-near={hoverIndex >= 0 && Math.abs(hoverIndex-index) === 1 || undefined} aria-label={`第 ${index + 1} 轮：${anchor.label}`} aria-describedby={hover?.anchor.messageId === anchor.messageId && !directory ? previewId : undefined} aria-current={selected ? 'step' : undefined} tabIndex={selected || (activeIndex < 0 && index === 0) ? 0 : -1}
          onMouseEnter={event => { clearTimeout(timer.current); if (!directory) setHover({ anchor, element: event.currentTarget }); }} onMouseLeave={closeHover}
          onFocus={event => { clearTimeout(timer.current); if (!directory) setHover({ anchor, element: event.currentTarget }); }} onBlur={closeHover}
          onClick={() => jump(anchor)} onKeyDown={event => {
            if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const buttons = [...event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('button')];
            const current = buttons.indexOf(event.currentTarget);
            buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
          }}><span style={{ width: `${Math.max(16, Math.min(26, anchor.markerWidthEm * 26))}px` }}/></button>;
      })}
    </div>
    <span className={styles.counter} aria-label={`当前第 ${Math.max(1,activeIndex + 1)} 轮，共 ${anchors.length} 轮`} data-tooltip="当前阅读位置 / 已加载轮数 · 在刻度上可上下滚动">{Math.max(1, activeIndex + 1)}<span>/{anchors.length}</span></span>
    {(directory || preview) && createPortal(<div ref={popup} id={previewId} style={position} data-liquid="menu" data-menu-surface="" data-menu-position="fixed" className={`${styles.popup} ${directory ? styles.directory : styles.preview}`} role={directory ? 'dialog' : 'tooltip'} aria-label={directory ? '对话目录' : undefined} data-tooltip-managed=""
      onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={() => { if (!directory) closeHover(); }}
      onKeyDown={event => {
        if (event.key !== 'Tab' || !directory) return;
        const controls = [...popup.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input')];
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
      }}>
      {directory ? <>
        <header><div><strong>对话目录</strong><small>{hasMore ? '仅显示已加载的提问' : `${anchors.length} 轮提问 · 按时间排列`}</small></div><button aria-label="关闭对话目录" onClick={closeDirectory}>×</button></header>
        <input aria-label="筛选对话目录" placeholder="搜索提问内容…" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter') {
            // Focus returns to the trigger on close. Suppress the browser's
            // default Enter click so it cannot immediately reopen the panel.
            event.preventDefault(); event.stopPropagation();
            if (filtered[0]) jump(filtered[0]);
          }
          if (event.key === 'ArrowDown') { event.preventDefault(); popup.current?.querySelector<HTMLButtonElement>('[data-turn]')?.focus(); }
        }}/>
        <div className={styles.directoryList}>
          {filtered.map(anchor => <button key={anchor.messageId} data-turn="" aria-current={anchor.messageId === activeId ? 'step' : undefined} onClick={() => jump(anchor)}><small>第 {anchors.indexOf(anchor) + 1} 轮{anchor.timestamp ? ` · ${formatTimelineAnchorLabel(anchor.timestamp)}` : ''}</small><span>{anchor.preview || anchor.label}</span></button>)}
          {!filtered.length && <p>已加载的提问中没有匹配内容。</p>}
        </div>
        <footer>{hasMore && <button disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? '正在加载…' : '加载更早的对话'}</button>}{onFind && <button onClick={() => { closeDirectory(); onFind(); }}>全文查找 <kbd>⌘ / Ctrl F</kbd></button>}</footer>
      </> : preview && <><header><strong>第 {anchors.indexOf(preview) + 1} 轮{preview.messageId===activeId?' · 正在阅读':''}</strong><small>{preview.timestamp ? formatTimelineAnchorLabel(preview.timestamp) : '时间未记录'}</small></header><div className={styles.previewBody}><span className={styles.previewRole}>{preview.role==='user'?'你的输入':'助手回复'}</span><p>{preview.preview || preview.label}</p>{preview.replyPreview&&<><span className={styles.previewRole}>助手回复</span><p>{preview.replyPreview}</p></>}</div><small>滚动浏览轮次 · 点击定位 · ↑ ↓ 切换</small></>}
    </div>, document.body)}
  </nav>;
}
