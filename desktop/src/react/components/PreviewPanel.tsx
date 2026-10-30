/**
 * PreviewPanel — PreviewItem 预览/编辑面板
 *
 * 从 Zustand store 读取 previewItem 内容池，以及当前 workspace 恢复出的 activeTabId / previewOpen 状态。
 * 可编辑类型（有 filePath 的 markdown/code/csv）使用 CodeMirror 编辑器。
 *
 * 架构原则：
 * - 文件系统是 source of truth，编辑器直接对接文件
 * - PreviewItem content 仅作为前端视图快照，给复制/临时渲染预览使用
 * - 独立窗口由下阶段的 viewer spawn 机制负责（单向只读副本），本面板不做 detach/dock
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useStore } from '../stores';
import { selectPreviewItems, selectActiveTabId, selectMarkdownPreviewIds, selectPreviewReadingPositions } from '../stores/preview-slice';
import { closePreview, consumePreviewAnchor, setMarkdownPreviewActive, upsertPreviewItem, updatePreviewReadingPosition } from '../stores/preview-actions';
import {alignPreviewAnchor,findPreviewAnchor} from '../utils/preview-anchor';
import { PreviewEditor, type PreviewEditorHandle, type PreviewEditorStats } from './PreviewEditor';
import { PreviewRenderer } from './preview/PreviewRenderer';
import { TabBar } from './preview/TabBar';
import {DocumentNavigation} from './preview/DocumentNavigation';
import { FloatingActions } from './preview/FloatingActions';
import { ChapterRail, ClassicFindBox, LinkDiagnosticsBadge } from './preview/MarkdownChrome';
import {
  clearSelection,
  getSelectionCommitAnchorRect,
  isContextMenuButton,
  quotePreviewRangeToChat,
  scheduleCaptureSelection,
} from '../stores/selection-actions';
import type { PreviewItem } from '../types';
import { isRemoteWorkbenchContentRef, saveRemoteWorkbenchContent } from '../utils/remote-file-preview';
import {findTextMatchPage,createDocumentHighlights} from '../utils/text-search-ranges';
import { applyFindMarks, clearFindMarks } from '../utils/find-marks';
import { OpenPreviewDocumentWatchBridge } from './app/OpenPreviewDocumentWatchBridge';
import {
  extractMarkdownHeadings,
  findCurrentHeading,
  hashMarkdownContent,
  type MarkdownHeading,
} from '../utils/markdown-document';
import type { PreviewScrollSnapshot } from '../../../../shared/preview-reading-position.ts';
import previewStyles from './Preview.module.css';
import { AppIcon } from '../ui/app-icons';

const EDITABLE_TYPES = new Set(['markdown', 'code', 'csv']);
const CHAPTER_RAIL_HOVER_ZONE_PX = 64;
const CHAPTER_RAIL_TOP_OFFSET_PX = 76;
const CHAPTER_RAIL_HEIGHT_RATIO = 0.5;

/** 提纲导轨悬停热区命中判定：右缘（与聊天页 ChatMessageSurface.handleShellPointerMove 一致）。
    抽成纯函数以便单测：PreviewPanel 渲染栈重（platform/store/resource-watch 依赖），
    直接对 pointermove 断言需要 mock 出真实 rect 尺寸，不如把几何判定单独验证。 */
export function chapterRailHoverHit(
  rect: { top: number; right: number; height: number },
  clientX: number,
  clientY: number,
): boolean {
  const xFromRight = rect.right - clientX;
  const yFromTop = clientY - rect.top;
  const inRailX = xFromRight >= 0 && xFromRight <= CHAPTER_RAIL_HOVER_ZONE_PX;
  const inRailY = yFromTop >= CHAPTER_RAIL_TOP_OFFSET_PX
    && yFromTop <= CHAPTER_RAIL_TOP_OFFSET_PX + rect.height * CHAPTER_RAIL_HEIGHT_RATIO;
  return inRailX && inRailY;
}

function isEditable(previewItem: PreviewItem | null): boolean {
  if (!previewItem) return false;
  if (previewItem.status === 'missing' || previewItem.status === 'unavailable') return false;
  return EDITABLE_TYPES.has(previewItem.type)
    && (!!previewItem.filePath || isRemoteWorkbenchContentRef(previewItem.remoteContentRef));
}

function isMarkdownFile(previewItem: PreviewItem | null): boolean {
  return !!previewItem
    && previewItem.status !== 'missing'
    && previewItem.type === 'markdown'
    && (!!previewItem.filePath || isRemoteWorkbenchContentRef(previewItem.remoteContentRef));
}

function getEditorMode(previewItem: PreviewItem): 'markdown' | 'code' | 'csv' | 'text' {
  if (previewItem.type === 'markdown') return 'markdown';
  if (previewItem.type === 'csv') return 'csv';
  return 'code';
}

function countPreviewChars(text: string): number {
  return Array.from(text).length;
}

function formatMarkdownEditorStatus(stats: PreviewEditorStats): string {
  const fallback = `选中 ${stats.selectedChars} 字 · 共 ${stats.totalChars} 字`;
  const translated = window.t?.('preview.markdownEditorStatus', {
    selected: stats.selectedChars,
    total: stats.totalChars,
  });
  return translated && translated !== 'preview.markdownEditorStatus' ? translated : fallback;
}

function scrollRatio(scrollTop: number, scrollHeight: number, clientHeight: number): number {
  const max = Math.max(0, scrollHeight - clientHeight);
  return max > 0 ? Math.min(1, Math.max(0, scrollTop / max)) : 0;
}

function escapeCssId(id: string): string {
  const css = (globalThis as { CSS?: { escape?: (value: string) => string } }).CSS;
  if (typeof css?.escape === 'function') return css.escape(id);
  return id.replace(/["\\#.:,[\]=]/g, '\\$&');
}


export function PreviewPanel({embedded=false,visible=true,itemId}:{embedded?:boolean;visible?:boolean;itemId?:string|null}={}) {
  const previewOpen = useStore(s => s.previewOpen);
  const previewExpanded = useStore(s => s.previewExpanded);
  const layoutDrawer = useStore(s => s.layoutDrawer);
  const storedActiveTabId = useStore(selectActiveTabId);
  const activeTabId = embedded ? itemId : storedActiveTabId;
  const previewItems = useStore(selectPreviewItems);
  const markdownPreviewIds = useStore(selectMarkdownPreviewIds);
  const previewReadingPositions = useStore(selectPreviewReadingPositions);
  const anchorRequest = useStore(s=>activeTabId?s.previewAnchorRequests[activeTabId]:undefined);
  const [anchorMessage,setAnchorMessage]=useState('');
  const [anchorHighlight,setAnchorHighlight]=useState<{itemId:string;id:string;token:string}|null>(null);
  const [editorStats, setEditorStats] = useState<PreviewEditorStats>({ selectedChars: 0, totalChars: 0 });
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [wrapLines,setWrapLines]=useState(()=>{try{return localStorage.getItem('enigma-preview-wrap')!=='false';}catch{return true;}});
  const [findQuery, setFindQuery] = useState('');
  const [findIndex, setFindIndex] = useState(0);
  const [findCount, setFindCount] = useState(0);
  const [findTruncated,setFindTruncated]=useState(false);
  const [chapterRailVisible, setChapterRailVisible] = useState(false);
  const previewBodyRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<PreviewEditorHandle | null>(null);
  const previewScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredPreviewKeyRef = useRef('');
  const activeHeadingRef = useRef<string | null>(null);
  const previewFindMarksRef = useRef<HTMLElement[]>([]);
  const nativeFindRef=useRef<{ranges:Range[];highlight:NonNullable<ReturnType<typeof createDocumentHighlights>>}|null>(null);

  useEffect(()=>{if(embedded&&!visible)previewBodyRef.current?.querySelectorAll<HTMLMediaElement>('video,audio').forEach(media=>media.pause());},[embedded,visible]);
  const [csvSource,setCsvSource]=useState(false);
  useEffect(()=>setCsvSource(false),[activeTabId]);
  const previewItem = previewItems.find(a => a.id === activeTabId) ?? null;
  const markdownPreviewActive = !!previewItem && markdownPreviewIds.includes(previewItem.id);
  const editable = isEditable(previewItem) && !markdownPreviewActive && (previewItem?.type!=='csv'||csvSource);
  const markdownFile = isMarkdownFile(previewItem);
  const showMarkdownEditorStatus = editable && previewItem?.type === 'markdown';
  const contentHash = useMemo(() => previewItem&&['markdown','code','csv','text'].includes(previewItem.type) ? hashMarkdownContent(previewItem.content) : '', [previewItem?.content, previewItem?.type]);
  const markdownHeadings = useMemo(
    () => previewItem?.type === 'markdown' ? extractMarkdownHeadings(previewItem.content, 6) : [],
    [previewItem?.content, previewItem?.type],
  );
  const readingPosition = previewItem ? previewReadingPositions[previewItem.id] || null : null;
  const saveDocument = useMemo(() => {
    const remoteRef = previewItem?.remoteContentRef;
    if (!isRemoteWorkbenchContentRef(remoteRef)) return undefined;
    return (content: string, expectedVersion?: PreviewItem['fileVersion']) =>
      saveRemoteWorkbenchContent(remoteRef, content, expectedVersion ?? null);
  }, [previewItem?.remoteContentRef]);

  const handleToggleMarkdownPreview = useCallback(() => {
    if (!previewItem || !isMarkdownFile(previewItem)) return;
    setMarkdownPreviewActive(previewItem.id, !markdownPreviewActive);
  }, [previewItem, markdownPreviewActive]);

  const handleEditorContentChange = useCallback((content: string, fileVersion?: PreviewItem['fileVersion']) => {
    if (!previewItem) return;
    upsertPreviewItem({
      ...previewItem,
      content,
      fileVersion: fileVersion === undefined ? previewItem.fileVersion : fileVersion,
    });
  }, [previewItem]);

  const handleEditorStatsChange = useCallback((stats: PreviewEditorStats) => {
    setEditorStats(stats);
  }, []);

  const currentPreviewHeading = useCallback((): MarkdownHeading | null => {
    const body = previewBodyRef.current;
    if (!body || markdownHeadings.length === 0) return null;
    const bodyTop = body.getBoundingClientRect().top + 56;
    let current: MarkdownHeading | null = markdownHeadings[0] || null;
    for (const heading of markdownHeadings) {
      const el = body.querySelector<HTMLElement>(`.preview-markdown #${escapeCssId(heading.id)}`);
      if (!el) continue;
      if (el.getBoundingClientRect().top <= bodyTop) current = heading;
      else break;
    }
    return current;
  }, [markdownHeadings]);

  const publishPreviewScrollSnapshot = useCallback(() => {
    previewScrollTimerRef.current = null;
    if (!previewItem || !markdownFile || editable) return;
    const body = previewBodyRef.current;
    if (!body) return;
    const heading = currentPreviewHeading();
    if (heading?.id !== activeHeadingRef.current) {
      activeHeadingRef.current = heading?.id ?? null;
      setActiveHeadingId(heading?.id ?? null);
    }
    updatePreviewReadingPosition(previewItem.id, 'preview', {
      scrollTop: body.scrollTop,
      scrollLeft: body.scrollLeft,
      scrollHeight: body.scrollHeight,
      clientHeight: body.clientHeight,
      ratio: scrollRatio(body.scrollTop, body.scrollHeight, body.clientHeight),
      ...(heading ? { anchorId: heading.id, anchorText: heading.text } : {}),
      contentHash,
    }, heading ? { id: heading.id, text: heading.text } : null);
  }, [contentHash, currentPreviewHeading, editable, markdownFile, previewItem]);

  const schedulePreviewScrollSnapshot = useCallback(() => {
    if (previewScrollTimerRef.current) clearTimeout(previewScrollTimerRef.current);
    previewScrollTimerRef.current = setTimeout(publishPreviewScrollSnapshot, 160);
  }, [publishPreviewScrollSnapshot]);

  const handleEditorScrollSnapshot = useCallback((snapshot: PreviewScrollSnapshot, topVisibleLine: number) => {
    if (!previewItem) return;
    const heading = findCurrentHeading(markdownHeadings, topVisibleLine);
    if (heading?.id !== activeHeadingRef.current) {
      activeHeadingRef.current = heading?.id ?? null;
      setActiveHeadingId(heading?.id ?? null);
    }
    updatePreviewReadingPosition(previewItem.id, 'edit', {
      ...snapshot,
      ...(heading ? { anchorId: heading.id, anchorText: heading.text } : {}),
      contentHash,
    }, heading ? { id: heading.id, text: heading.text } : null);
  }, [contentHash, markdownFile, markdownHeadings, previewItem]);

  const restorePreviewScroll = useCallback(() => {
    if (!previewItem || editable || !markdownFile || anchorRequest || !readingPosition?.preview) return;
    const body = previewBodyRef.current;
    if (!body) return;
    const snapshot = readingPosition.preview;
    const key = `${previewItem.id}:preview:${contentHash}:${snapshot.updatedAt || ''}:${snapshot.scrollTop}:${snapshot.anchorId || ''}`;
    if (restoredPreviewKeyRef.current === key) return;
    restoredPreviewKeyRef.current = key;
    let cancelled=false;
    const restore = () => {
      if(cancelled||useStore.getState().activeTabId!==previewItem.id||useStore.getState().previewAnchorRequests[previewItem.id])return;
      if (snapshot.contentHash === contentHash && Number.isFinite(snapshot.scrollTop)) {
        body.scrollTop = Math.max(0, snapshot.scrollTop);
        body.scrollLeft = Math.max(0, snapshot.scrollLeft || 0);
        return;
      }
      if (snapshot.anchorId) {
        const el = body.querySelector<HTMLElement>(`.preview-markdown #${escapeCssId(snapshot.anchorId)}`);
        if (el) {
          body.scrollTop += el.getBoundingClientRect().top - body.getBoundingClientRect().top - 56;
          return;
        }
      }
      if (Number.isFinite(snapshot.ratio)) {
        body.scrollTop = Math.max(0, (snapshot.ratio || 0) * Math.max(0, body.scrollHeight - body.clientHeight));
      }
    };
    restore();
    queueMicrotask(restore);
    const frame=window.requestAnimationFrame?.(restore);
    return()=>{cancelled=true;if(frame)window.cancelAnimationFrame(frame);};
  }, [anchorRequest, contentHash, editable, markdownFile, previewItem, readingPosition?.preview]);

  const handleJumpHeading = useCallback((heading: MarkdownHeading) => {
    if (editable) {
      editorRef.current?.scrollToLine(heading.line);
    } else {
      const body = previewBodyRef.current;
      const el = body?.querySelector<HTMLElement>(`.preview-markdown #${escapeCssId(heading.id)}`);
      if (body && el) {
        body.scrollTop += el.getBoundingClientRect().top - body.getBoundingClientRect().top - 56;
      }
    }
    activeHeadingRef.current = heading.id;
    setActiveHeadingId(heading.id);
  }, [editable]);

  useLayoutEffect(()=>{
    if(!previewOpen||!previewItem||!markdownFile||editable||!anchorRequest)return;
    const body=previewBodyRef.current;if(!body)return;
    const target=findPreviewAnchor(body,anchorRequest.anchor);
    setAnchorMessage(target?'':`未找到章节“${anchorRequest.anchor}”，已打开文档，可通过目录选择位置。`);
    setAnchorHighlight(target?{itemId:previewItem.id,id:target.id,token:anchorRequest.token}:null);
    if(target){
      alignPreviewAnchor(body,target);
      activeHeadingRef.current=target.id;setActiveHeadingId(target.id);
      updatePreviewReadingPosition(previewItem.id,'preview',{
        scrollTop:body.scrollTop,scrollLeft:body.scrollLeft,ratio:scrollRatio(body.scrollTop,body.scrollHeight,body.clientHeight),
        contentHash,updatedAt:Date.now(),anchorId:target.id,anchorText:target.textContent||'',
      },{id:target.id,text:target.textContent||''});
    }
    consumePreviewAnchor(previewItem.id,anchorRequest.token);
  },[previewOpen,previewItem,markdownFile,editable,anchorRequest,contentHash]);

  useLayoutEffect(()=>{
    const body=previewBodyRef.current;
    if(!body||!anchorHighlight||previewItem?.id!==anchorHighlight.itemId)return;
    const mark=()=>{const target=findPreviewAnchor(body,anchorHighlight.id);if(target)target.dataset.previewAnchorTarget='';};
    mark();
    // A Markdown subtree may refresh after its reference metadata arrives.
    // Reapply the short-lived cue to the current node, not a detached one.
    const observer=new MutationObserver(mark);observer.observe(body,{childList:true,subtree:true});
    const timer=setTimeout(()=>setAnchorHighlight(current=>current?.token===anchorHighlight.token?null:current),1600);
    return()=>{clearTimeout(timer);observer.disconnect();body.querySelectorAll<HTMLElement>('[data-preview-anchor-target]').forEach(target=>delete target.dataset.previewAnchorTarget);};
  },[anchorHighlight,previewItem?.id]);

  const handleBodyShellPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setChapterRailVisible(chapterRailHoverHit(rect, event.clientX, event.clientY));
  }, []);

  const handleBodyShellPointerLeave = useCallback(() => {
    setChapterRailVisible(false);
  }, []);

  // DOM 模式选区捕获（非编辑模式下 mouseup 时检测选中文本）
  const handleMouseUp = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!previewItem || editable) return;
    if (isContextMenuButton(event.nativeEvent)) return;
    scheduleCaptureSelection(previewItem, undefined, getSelectionCommitAnchorRect(event.nativeEvent));
  }, [previewItem, editable]);

  // 切换 tab 时清除选区
  useEffect(() => {
    clearSelection({ sourceKind: 'preview' });
    setEditorStats({
      selectedChars: 0,
      totalChars: previewItem?.type === 'markdown' ? countPreviewChars(previewItem.content) : 0,
    });
    if(!anchorRequest){activeHeadingRef.current = readingPosition?.currentHeadingId || null;setActiveHeadingId(readingPosition?.currentHeadingId || null);setAnchorMessage('');}
  }, [activeTabId]); // eslint-disable-line react-hooks/exhaustive-deps -- tab 切换时用当前 active previewItem 初始化状态栏，后续由 PreviewEditor 回调接管

  useEffect(() => {
    if (!previewOpen || !previewItem || !markdownFile || editable) return undefined;
    const body = previewBodyRef.current;
    if (!body) return undefined;
    const onScroll = () => schedulePreviewScrollSnapshot();
    body.addEventListener('scroll', onScroll, { passive: true });
    const cancelRestore=restorePreviewScroll();
    return () => {
      cancelRestore?.();
      body.removeEventListener('scroll', onScroll);
      if (previewScrollTimerRef.current) {
        clearTimeout(previewScrollTimerRef.current);
        publishPreviewScrollSnapshot();
      }
    };
  }, [editable, markdownFile, previewItem, previewOpen, publishPreviewScrollSnapshot, restorePreviewScroll, schedulePreviewScrollSnapshot]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!visible || !previewOpen || !['markdown','code','text','html'].includes(previewItem?.type || '') || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'f') return;
      const panel=previewBodyRef.current?.closest('#previewPanel');
      if(!panel?.contains(event.target as Node)||editable)return;
      event.preventDefault();
      event.stopPropagation();
      setFindOpen(true);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [previewOpen, previewItem?.type,csvSource,editable]);

  useEffect(() => {
    setFindIndex(0);
  }, [findQuery, activeTabId, editable]);
  useEffect(()=>setFindOpen(false),[activeTabId,editable]);

  useEffect(() => {
    clearFindMarks(previewBodyRef.current, 'preview-find-mark');
    previewFindMarksRef.current = [];
    if (!findOpen || !findQuery || !previewItem) {
      setFindCount(0);setFindTruncated(false);
      return undefined;
    }
    if (editable) return;
    const root=previewBodyRef.current?.querySelector<HTMLElement>('.preview-markdown')||previewBodyRef.current;
    const highlight=root?createDocumentHighlights(root):null;
    if(root&&highlight){
      const refresh=()=>{const {ranges,truncated}=findTextMatchPage(root,findQuery);setFindTruncated(truncated);nativeFindRef.current={ranges,highlight};setFindCount(ranges.length);highlight.set(ranges,Math.min(findIndex,Math.max(0,ranges.length-1)));};
      refresh();highlight.scroll(nativeFindRef.current?.ranges[findIndex]);
      const observer=new MutationObserver(refresh);observer.observe(root,{childList:true,subtree:true,characterData:true});
      return()=>{observer.disconnect();highlight.clear();nativeFindRef.current=null;};
    }
    const marks = applyFindMarks(previewBodyRef.current, [findQuery], 'preview-find-mark',{maxMatches:2001});
    setFindTruncated(marks.length>2000);marks.splice(2000).forEach(mark=>mark.replaceWith(...mark.childNodes));
    previewFindMarksRef.current = marks;
    setFindCount(marks.length);
    return () => {
      clearFindMarks(previewBodyRef.current, 'preview-find-mark');
      previewFindMarksRef.current = [];
    };
  }, [activeTabId, editable, findIndex, findOpen, findQuery, previewItem]);

  useEffect(() => {
    const native=nativeFindRef.current;if(native){native.highlight.set(native.ranges,findIndex);native.highlight.scroll(native.ranges[findIndex]);return;}
    const marks = previewFindMarksRef.current;
    for (const mark of marks) mark.classList.remove('preview-find-mark-active');
    const active = marks[Math.min(findIndex, Math.max(0, marks.length - 1))];
    if (active) {
      active.classList.add('preview-find-mark-active');
      active.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
  }, [findIndex, findCount]);

  const goFind = useCallback((direction: 1 | -1) => {
    setFindIndex(index => {
      if (findCount <= 0) return 0;
      return (index + direction + findCount) % findCount;
    });
  }, [findCount]);

  return (
    <div
      className={`${previewStyles.previewPanel}${previewOpen ? '' : ` ${previewStyles.previewPanelCollapsed}`}`}
      id="previewPanel"
      data-layout-managed=""
      inert={!previewOpen || (embedded ? !visible || layoutDrawer==='sidebar' : !!layoutDrawer)}
      hidden={embedded&&!visible}
      data-dock-preview={embedded||undefined}
      aria-hidden={!previewOpen || embedded&&!visible}
      data-preview-open={previewOpen ? 'true' : 'false'}
    >
      <OpenPreviewDocumentWatchBridge />
      {!embedded&&<div className="resize-handle resize-handle-left" id="previewResizeHandle"></div>}
      <div className={previewStyles.previewPanelInner} data-preview-panel-inner="">
        {!embedded&&previewExpanded && <button className="enigma-preview-return" onClick={() => closePreview()}><AppIcon name="chevronLeft" size={16}/>返回对话<span>已打开的文件会保留</span></button>}
        {!embedded&&<TabBar />}
        {previewItem?.type==='csv'&&isEditable(previewItem)&&<div className="enigma-csv-mode" role="group" aria-label="CSV 显示方式"><button aria-pressed={!csvSource} onClick={()=>setCsvSource(false)}>表格预览</button><button aria-pressed={csvSource} onClick={()=>setCsvSource(true)}>编辑 CSV</button></div>}
        {previewOpen&&previewItem&&['markdown','code','text','html'].includes(previewItem.type)&&!['missing','unavailable'].includes(previewItem.status||'')&&<DocumentNavigation
          documentId={previewItem.id} headings={markdownHeadings} activeHeadingId={activeHeadingId} editable={editable} wrapLines={wrapLines}
          onJump={handleJumpHeading} onFind={()=>{if(editable)editorRef.current?.openSearch();else setFindOpen(true);}}
          onGotoLine={()=>editorRef.current?.gotoLine()} onToggleWrap={()=>setWrapLines(value=>{try{localStorage.setItem('enigma-preview-wrap',String(!value));}catch{}return !value;})}
          onFold={editable?()=>editorRef.current?.foldAll():undefined} onUnfold={editable?()=>editorRef.current?.unfoldAll():undefined}>
          {previewOpen && previewItem && !['browser', 'media', 'pdf', 'docx', 'xlsx', 'csv', 'file-info'].includes(previewItem.type) && !['missing','unavailable'].includes(previewItem.status||'') && (
            <FloatingActions inline
              content={previewItem.content}
              filePath={previewItem.filePath}
              remoteContentRef={previewItem.remoteContentRef}
              contentType={previewItem.type}
              language={previewItem.language}
              showMarkdownPreviewToggle={isMarkdownFile(previewItem)}
              markdownPreviewActive={markdownPreviewActive}
              onToggleMarkdownPreview={handleToggleMarkdownPreview}
            />
          )}
        </DocumentNavigation>}
        <div
          className={previewStyles.previewBodyShell}
          data-preview-body-shell=""
          onPointerMove={handleBodyShellPointerMove}
          onPointerLeave={handleBodyShellPointerLeave}
        >
          {previewOpen && previewItem && markdownFile && (
            <ChapterRail
              headings={markdownHeadings}
              activeHeadingId={activeHeadingId}
              railVisible={chapterRailVisible}
              onJump={handleJumpHeading}
            />
          )}
          <ClassicFindBox
            inline
            ariaLabel="查找文档正文" placeholder="查找正文…" labels={{previous:'上一个匹配',next:'下一个匹配',close:'关闭查找'}}
            open={findOpen && !editable && !['browser','pdf','docx','xlsx'].includes(previewItem?.type||'') && (previewItem?.type!=='csv'||csvSource)}
            query={findQuery}
            resultIndex={Math.min(findIndex, Math.max(0, findCount - 1))}
            resultCount={findCount}
            truncated={findTruncated}
            onQueryChange={setFindQuery}
            onPrevious={() => goFind(-1)}
            onNext={() => goFind(1)}
            onClose={() => setFindOpen(false)}
          />
          {previewOpen && anchorMessage && <div role="status" className={previewStyles.previewAnchorMessage}>{anchorMessage}<button type="button" aria-label="关闭章节提示" onClick={()=>setAnchorMessage('')}>×</button></div>}
          <div ref={previewBodyRef} className={`universal-card ${previewStyles.previewPanelBody}`} id="previewBody" data-preview-panel-body="" onMouseUp={handleMouseUp}>
            {previewOpen && previewItem && !editable && (
              <PreviewRenderer previewItem={previewItem} />
            )}
            {previewOpen && previewItem && editable && (
              <PreviewEditor key={previewItem.id}
                ref={editorRef}
                content={previewItem.content}
                filePath={previewItem.filePath}
                remoteContentRef={previewItem.remoteContentRef}
                fileVersion={previewItem.fileVersion ?? previewItem.remoteContentRef?.version ?? null}
                saveDocument={saveDocument}
                mode={getEditorMode(previewItem)}
                wrapLines={wrapLines}
                language={previewItem.language}
                onSelectionCommit={(view) => {
                  if (previewItem) scheduleCaptureSelection(previewItem, view);
                }}
                onQuoteRange={(view, range) => {
                  if (previewItem) quotePreviewRangeToChat(previewItem, view, range);
                }}
                onStatsChange={handleEditorStatsChange}
                onContentChange={handleEditorContentChange}
                initialScrollSnapshot={readingPosition?.edit ?? null}
                contentHash={contentHash}
                onScrollSnapshotChange={handleEditorScrollSnapshot}
              />
            )}
            {previewOpen && previewItem && editable && previewItem.type === 'markdown' && (
              <LinkDiagnosticsBadge previewItem={previewItem} headings={markdownHeadings} />
            )}
            {previewOpen && previewItem && showMarkdownEditorStatus && (
              <div
                className={previewStyles.markdownEditorStatus}
                data-testid="markdown-editor-status"
                aria-live="polite"
              >
                {formatMarkdownEditorStatus(editorStats)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
