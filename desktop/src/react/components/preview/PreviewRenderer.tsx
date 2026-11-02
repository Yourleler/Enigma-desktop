/**
 * PreviewRenderer — PreviewItem 内容的声明式渲染
 *
 * 替代 PreviewPanel 中命令式 DOM 构建的 switch/case useEffect。
 * 每种 previewItem 类型对应一个 JSX 分支或子组件。
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react';
import {openMarkdownCoverMenu} from '../../utils/markdown-cover-menu';
import { renderMarkdownPreview } from '../../utils/markdown';
import {
  parseMarkdownCover,
  resolveMarkdownCoverImagePath,
  stripMarkdownFrontMatterForPreview,
  type MarkdownCover,
} from '../../utils/markdown-cover';
import {
  dispatchCoverNotice,
  type MarkdownCoverTargetInput,
} from '../../utils/markdown-cover-generation';
import {
  isExternalCoverImagePath,
  regenerateMarkdownCoverWithPrompt,
  saveMarkdownCoverImage,
} from '../../utils/markdown-cover-actions';
import {
  applyMarkdownCoverImageDrop,
  hasMarkdownCoverDropImage,
} from '../../utils/markdown-cover-drop';
import { injectCopyButtons } from '../../utils/format';
import { observeMarkdownRhythmSnap } from '../../utils/markdown-rhythm';
import { fileIconSvg } from '../../utils/icons';
import { openFilePreview } from '../../utils/file-preview';
import { openInternalLink, resolveLinkTarget, type LinkOpenContext } from '../../utils/link-open';
import { showError } from '../../utils/ui-helpers';
import { hanaFetch } from '../../hooks/use-hana-fetch';
import { useStore } from '../../stores';
import {upsertPreviewItem} from '../../stores/preview-actions';
import {capturePreviewContext,previewConnectionKey} from '../../utils/preview-context';
import {beginMarkdownCoverDrag,type CoverLayout} from '../../utils/markdown-cover-drag';
import {mutateMarkdownCover,markdownCoverFileIdentity,type CoverMutation} from '../../utils/markdown-cover-mutation';
import { isRemoteWorkbenchContentRef, normalizeWorkbenchContentRef } from '../../utils/remote-file-preview';
import { useMermaidDiagrams } from '../../hooks/use-mermaid-diagrams';
import { LinkContextMenu, type LinkContextMenuState } from '../shared/LinkContextMenu';
import { DocumentReferencesBlock, MarkdownPropertiesBlock } from './MarkdownChrome';
import type { PreviewItem } from '../../types';
import previewStyles from '../Preview.module.css';
import { SidebarBrowser } from './SidebarBrowser';
import { MediaPreview } from './MediaPreview';
import './PdfReader.css';
import { workbenchMarkdownOptions } from '../../utils/workbench-markdown';
import { resolveServerConnection } from '../../services/server-connection';

declare function t(key: string, vars?: Record<string, string | number>): string;

// ── LegacyMediaFallback ──
// image / svg 旧类型 previewItem 的隔离渲染组件。
// currentSessionPath 订阅收窄到此组件，不影响 html/markdown/code/csv 等主流路径。

function LegacyMediaFallback({ previewItem }: { previewItem: PreviewItem }) {
  const currentSessionPath = useStore(s => s.currentSessionPath);

  if (process.env.NODE_ENV !== 'production') {
    console.warn('[PreviewRenderer] 旧类型 image/svg previewItem，走 fallback，请通过文件重新打开以使用新 MediaViewer');
  }

  const onOpen = () => {
    if (!previewItem.filePath || !previewItem.ext) return;
    const context = currentSessionPath
      ? { origin: 'session' as const, sessionPath: currentSessionPath }
      : { origin: 'desk' as const };
    openFilePreview(previewItem.filePath, previewItem.title, previewItem.ext, context);
  };

  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 200,
        color: 'var(--text-muted)',
        cursor: 'default',
        fontSize: '0.85rem',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
    >
      <span>{window.t?.('preview.legacyImageUpgrade') ?? 'This image preview has been upgraded. Click to open in the new viewer.'}</span>
    </div>
  );
}

export type HtmlFindState={open:boolean;query:string;index:number;onResult:(count:number,truncated:boolean)=>void;onOpen:()=>void};
interface PreviewRendererProps {
  htmlFind?:HtmlFindState;
  previewItem: PreviewItem;
}

function missingPreviewTitle(): string {
  const translated = window.t?.('preview.fileMovedOrDeleted');
  return translated && translated !== 'preview.fileMovedOrDeleted'
    ? translated
    : 'The original draft was moved or deleted';
}

function MissingPreviewTarget({ previewItem }: { previewItem: PreviewItem }) {
  const label = previewItem.title || previewItem.filePath || '';

  return (
    <div className={previewStyles.previewUnavailable} role="status" data-testid="preview-missing-target">
      <p>{missingPreviewTitle()}</p>
      {label && <span title={label}>{label}</span>}
    </div>
  );
}

function UnavailablePreviewTarget({previewItem}: {previewItem: PreviewItem}) {
  const [loading, setLoading] = useState(false);
  const retry = async () => {
    setLoading(true);
    try {
      const {hydratePersistedPreviewItems} = await import('../../stores/workspace-ui-state-actions');
      const items = await hydratePersistedPreviewItems(useStore.getState().deskBasePath || '/', {previewTabs: [{...previewItem, remoteContentRef: isRemoteWorkbenchContentRef(previewItem.remoteContentRef) ? previewItem.remoteContentRef : undefined}]});
      if (items[0]) upsertPreviewItem(items[0]);
    } finally {setLoading(false);}
  };
  return <div className={previewStyles.previewUnavailable} role="alert"><p>{previewItem.loadError || '暂时无法加载预览'}</p><span>{previewItem.title}</span><button disabled={loading} onClick={() => void retry()}>{loading ? '正在重试…' : '重新加载'}</button></div>;
}

// ── HtmlPreview ──
// HTML 内容由 server 注册为 token 化短期文档；右侧 Preview 只承载本地
// artifact/file-backed HTML，用 DOM iframe 渲染，外部网页访问交给内置浏览器。

function HtmlPreview({ previewItem,htmlFind }: { previewItem: PreviewItem;htmlFind?:HtmlFindState }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const frame=useRef<HTMLIFrameElement>(null),search=useRef(htmlFind),request=useRef('');search.current=htmlFind;
  const [loaded,setLoaded]=useState(0),searchEnabled=!!htmlFind;
  useEffect(()=>{
    const receive=(event:MessageEvent)=>{
      if(event.source!==frame.current?.contentWindow)return;const data=event.data;
      if(data?.type==='enigma-preview-find-open'){search.current?.onOpen();return;}
      if(data?.type==='enigma-preview-find-result'&&data.id===request.current&&Number.isInteger(data.count)&&data.count>=0&&data.count<=2000)search.current?.onResult(data.count,data.truncated===true);
    };window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);
  },[]);
  useEffect(()=>{
    if(!searchEnabled||!previewUrl||!loaded)return;request.current=crypto.randomUUID();
    frame.current?.contentWindow?.postMessage({type:'enigma-preview-find',id:request.current,query:htmlFind?.open?htmlFind.query:'',index:htmlFind?.index||0},'*');
  },[previewUrl,loaded,searchEnabled,htmlFind?.query,htmlFind?.index,htmlFind?.open]);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const ref=previewItem.remoteContentRef;
  const sourceKey=isRemoteWorkbenchContentRef(ref)?JSON.stringify({kind:ref.kind,mountId:ref.mountId,rootId:ref.rootId,subdir:ref.subdir,name:ref.name}):'';

  useEffect(() => {
    let cancelled = false;
    setPreviewUrl(null);
    setError(null);

    hanaFetch('/api/preview/html', {
      throwOnHttpError: false,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: previewItem.title,
        content: previewItem.content,
        ...(searchEnabled?{enableDocumentSearch:true}:{}),
        sourceFilePath: previewItem.filePath,
        sourceRootPath: previewItem.sourceRootPath,
        ...(sourceKey ? {remoteContentRef: JSON.parse(sourceKey)} : {}),
      }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok || !data || typeof data.previewUrl !== 'string' || !data.previewUrl) {
          throw new Error(data?.error || '无法加载 HTML 预览，请确认文件仍存在后重试');
        }
        if (!cancelled) setPreviewUrl(data.previewUrl);
      })
      .catch((err) => {
        console.error('[PreviewRenderer] HTML preview registration failed:', err);
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [previewItem.content, previewItem.filePath, previewItem.sourceRootPath, sourceKey, previewItem.title, attempt, searchEnabled]);

  if (error) {
    return <div className={previewStyles.previewUnavailable} role="alert"><p>{error}</p><button onClick={() => setAttempt(value => value + 1)}>重新加载</button></div>;
  }

  return (
    <div style={{height: '100%', position: 'relative'}}>
    <iframe
      className="preview-html-frame"
      data-html-preview-frame=""
      ref={frame} onLoad={()=>setLoaded(value=>value+1)}
      title={previewItem.title}
      src={previewUrl || 'about:blank'}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
    />
    {!previewUrl && <div className={previewStyles.previewUnavailable} role="status" style={{position: 'absolute', inset: 0}}>正在加载 HTML 预览…</div>}
    </div>
  );
}

// ── MarkdownPreview ──

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function coverLayout(cover: MarkdownCover): CoverLayout {
  return {
    displayWidth: clamp(cover.displayWidth ?? 100, 40, 100),
    displayHeight: clamp(cover.displayHeight ?? 320, 160, 720),
    positionX: clamp(cover.positionX ?? 50, 0, 100),
    positionY: clamp(cover.positionY ?? 50, 0, 100),
  };
}

function remoteWorkbenchCoverImageUrl(previewItem: PreviewItem, image: string | null | undefined): string | null {
  if (!image || !isRemoteWorkbenchContentRef(previewItem.remoteContentRef)) return null;
  if (isExternalCoverImagePath(image)) return image;
  const connection=resolveServerConnection(useStore.getState());
  if(!connection)return null;
  const context=workbenchMarkdownOptions(previewItem.remoteContentRef,connection);
  const path=resolveMarkdownCoverImagePath(context.filePath||undefined,image);
  return path?context.getFileUrl?.(path)||null:null;
}

function markdownCoverTargetForPreviewItem(previewItem: PreviewItem): MarkdownCoverTargetInput | null {
  if (previewItem.filePath) return { filePath: previewItem.filePath };
  if (!isRemoteWorkbenchContentRef(previewItem.remoteContentRef)) return null;
  const normalized = normalizeWorkbenchContentRef(previewItem.remoteContentRef);
  return {
    target: {
      kind: 'workbench-file',
      mountId: normalized.mountId || normalized.rootId || 'default',
      rootId: normalized.rootId || normalized.mountId || 'default',
      subdir: normalized.subdir || '',
      name: normalized.name,
    },
  };
}

function MarkdownCoverView({ previewItem, cover }: { previewItem: PreviewItem; cover: MarkdownCover }) {
  const connectionKey=useStore(previewConnectionKey);
  const coverIdentity=JSON.stringify([previewItem.id,markdownCoverFileIdentity(previewItem),cover.image]);
  const owns=useMemo(()=>capturePreviewContext(),[connectionKey,coverIdentity]);
  const [layout, setLayout] = useState(() => coverLayout(cover));
  const closeMenu=useRef<()=>void>(()=>{});
  const [coverDropActive, setCoverDropActive] = useState(false);
  const layoutRef = useRef(layout);
  const dragCancel=useRef<()=>void>(()=>{}),dragging=useRef(false),pending=useRef(false),request=useRef(0),mounted=useRef(false);
  const committed=useRef(layout),lastMutation=useRef<CoverMutation|null>(null);
  const [saveError,setSaveError]=useState(''),[saving,setSaving]=useState(false);
  useEffect(()=>{mounted.current=true;pending.current=false;setSaving(false);setSaveError('');return()=>{mounted.current=false;request.current++;dragCancel.current();closeMenu.current();};},[connectionKey,coverIdentity]);
  useEffect(()=>{committed.current=coverLayout(cover);if(!pending.current&&!dragging.current){layoutRef.current=committed.current;setLayout(committed.current);}},[cover.displayHeight,cover.displayWidth,cover.positionX,cover.positionY,cover.image]);

  const remoteImageUrl = remoteWorkbenchCoverImageUrl(previewItem, cover.image);
  const imagePath = remoteImageUrl ? null : resolveMarkdownCoverImagePath(previewItem.filePath, cover.image);
  const imageUrl = remoteImageUrl || (imagePath && isExternalCoverImagePath(imagePath)
    ? imagePath
    : imagePath ? window.platform?.getFileUrl?.(imagePath) || imagePath : null);
  const coverTarget = useMemo(() => markdownCoverTargetForPreviewItem(previewItem), [previewItem]);

  const submit=useCallback(async(mutation:CoverMutation)=>{
    if(!owns())return;
    const serial=++request.current;lastMutation.current=mutation;pending.current=true;setSaving(true);setSaveError('');
    try{
      const result=await mutateMarkdownCover(previewItem,mutation);
      if(!mounted.current||serial!==request.current)return;
      if(result){const savedCover=parseMarkdownCover(result.content);if(savedCover){committed.current=coverLayout(savedCover);layoutRef.current=committed.current;setLayout(committed.current);}}
    }catch(error){if(mounted.current&&serial===request.current){layoutRef.current=committed.current;setLayout(committed.current);const message=error instanceof Error?error.message:'';setSaveError(/hanaFetch|EACCES|EPERM|Failed to fetch|NetworkError/.test(message)?'封面未保存。请检查文件写入权限和连接后重试。':message||'封面保存未确认，请重试。');}}
    finally{if(mounted.current&&serial===request.current){pending.current=false;setSaving(false);}}
  },[previewItem,owns]);
  const deleteCover=()=>{closeMenu.current();void submit({kind:'remove'});};
  const beginDrag=useCallback((kind:'position'|'height',event:React.PointerEvent)=>{
    if(event.button!==0)return;
    dragCancel.current();closeMenu.current();dragging.current=true;
    dragCancel.current=beginMarkdownCoverDrag(event.nativeEvent,{kind,layout:layoutRef.current,
      preview:next=>{layoutRef.current=next;if(mounted.current)setLayout(next);},
      commit:next=>{void submit({kind:'layout',layout:next});},end:()=>{dragging.current=false;},
    });
  },[submit]);
  const cancelDrag=()=>{dragCancel.current();dragging.current=false;};

  const saveImage = useCallback(async () => {
    closeMenu.current();
    await saveMarkdownCoverImage(imagePath,remoteImageUrl?{url:remoteImageUrl,name:cover.image.split('/').pop()||'cover.png'}:undefined);
  }, [imagePath,remoteImageUrl,cover.image]);

  const regenerateWithPrompt = useCallback(async () => {
    closeMenu.current();
    await regenerateMarkdownCoverWithPrompt(coverTarget);
  }, [coverTarget]);

  const handleCoverDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!coverTarget || !hasMarkdownCoverDropImage(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    setCoverDropActive(true);
  }, [coverTarget]);

  const handleCoverDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setCoverDropActive(false);
  }, []);

  const handleCoverDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!coverTarget || !hasMarkdownCoverDropImage(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    setCoverDropActive(false);
    void applyMarkdownCoverImageDrop({
      ...coverTarget,
      dataTransfer: event.dataTransfer,
    });
  }, [coverTarget]);

  if (!imageUrl) return null;

  return (
    <>
    <div
      className={`markdown-cover${coverDropActive ? ' markdown-cover-drop-active' : ''}`}
      style={{
        width: `${layout.displayWidth}%`,
        height: `${layout.displayHeight}px`,
        marginLeft: 'auto',
        marginRight: 'auto',
      }}
      onContextMenu={(event) => {
        cancelDrag();event.preventDefault();
        event.stopPropagation();
        closeMenu.current();
        closeMenu.current=openMarkdownCoverMenu(event.currentTarget,{x:event.clientX,y:event.clientY},[
          {label:'保存图片',run:()=>{void saveImage();}},
          {label:'重新生成封面',run:()=>{void regenerateWithPrompt();}},
          {label:'删除封面',danger:true,run:deleteCover},
        ]);
      }}
      onDragOver={handleCoverDragOver}
      onDragLeave={handleCoverDragLeave}
      onDrop={handleCoverDrop}
    >
      <img
        src={imageUrl}
        alt=""
        draggable={false}
        style={{ objectPosition: `${layout.positionX}% ${layout.positionY}%` }}
        onPointerDown={(event) => beginDrag('position', event)}
      />
      <div
        className="markdown-cover-resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label="调整封面高度" aria-valuemin={160} aria-valuemax={720} aria-valuenow={layout.displayHeight} tabIndex={0}
        title="拖动调整高度；方向键微调，Esc取消拖动"
        onKeyDown={event=>{if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;event.preventDefault();const next={...layoutRef.current,displayHeight:clamp(event.key==='Home'?160:event.key==='End'?720:layoutRef.current.displayHeight+(event.key==='ArrowUp'?-16:16),160,720)};layoutRef.current=next;setLayout(next);void submit({kind:'layout',layout:next});}}
        onPointerDown={(event) => beginDrag('height', event)}
      />
    </div>
    {(saving||saveError)&&<div className="markdown-cover-save-notice" role={saveError?'alert':'status'}>{saving?'正在保存封面…':saveError}{saveError&&<button onClick={()=>lastMutation.current&&void submit(lastMutation.current)}>重试保存封面</button>}</div>}
    </>
  );
}

function isMarkdownTopCoverDrop(event: DragEvent<HTMLElement>): boolean {
  const rect = event.currentTarget.getBoundingClientRect();
  const y = Number.isFinite(event.clientY) ? event.clientY : rect.top;
  return y >= rect.top && y <= rect.top + 40;
}

function MarkdownCoverDropRail({ active }: { active: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={`markdown-cover-drop-rail${active ? ' markdown-cover-drop-rail-active' : ''}`}
    />
  );
}

function MarkdownNoCoverDropHost({ coverTarget, children }: { coverTarget: MarkdownCoverTargetInput | null; children: ReactNode }) {
  const [active, setActive] = useState(false);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!coverTarget || !hasMarkdownCoverDropImage(event.dataTransfer) || !isMarkdownTopCoverDrop(event)) {
      setActive(false);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    setActive(true);
  }, [coverTarget]);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setActive(false);
  }, []);

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!coverTarget || !hasMarkdownCoverDropImage(event.dataTransfer) || !isMarkdownTopCoverDrop(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setActive(false);
    void applyMarkdownCoverImageDrop({
      ...coverTarget,
      dataTransfer: event.dataTransfer,
    });
  }, [coverTarget]);

  if (!coverTarget) return <>{children}</>;
  return (
    <div
      className="markdown-cover-drop-host"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <MarkdownCoverDropRail active={active} />
      {children}
    </div>
  );
}

function MarkdownPreview({ previewItem }: { previewItem: PreviewItem }) {
  const divRef = useRef<HTMLDivElement>(null);
  const [linkMenu, setLinkMenu] = useState<LinkContextMenuState | null>(null);
  const cover = useMemo(() => parseMarkdownCover(previewItem.content), [previewItem.content]);
  const coverTarget = useMemo(() => markdownCoverTargetForPreviewItem(previewItem), [previewItem]);
  const body = useMemo(() => stripMarkdownFrontMatterForPreview(previewItem.content), [previewItem.content]);
  const serverPort = useStore(s => s.serverPort);
  const serverToken = useStore(s => s.serverToken);
  const activeServerConnectionId = useStore(s => s.activeServerConnectionId);
  const activeServerConnection = useStore(s => s.activeServerConnection);
  const serverConnections = useStore(s => s.serverConnections);
  const connection = useMemo(() => resolveServerConnection({serverPort,serverToken,activeServerConnectionId,activeServerConnection,serverConnections}),
    [serverPort,serverToken,activeServerConnectionId,activeServerConnection,serverConnections]);
  const remoteRef = !previewItem.filePath && isRemoteWorkbenchContentRef(previewItem.remoteContentRef) ? previewItem.remoteContentRef : null;
  const markdownOptions = useMemo(() => remoteRef && connection ? workbenchMarkdownOptions(remoteRef, connection)
    : {filePath:previewItem.filePath,getFileUrl:window.platform?.getFileUrl}, [remoteRef,connection,previewItem.filePath]);
  const linkContext = useMemo<LinkOpenContext>(() => ({
    origin: 'desk',
    baseFilePath: previewItem.filePath,
    ...(remoteRef && connection ? {workbenchScope:{ref:remoteRef,baseUrl:connection.baseUrl}} : {}),
  }), [previewItem.filePath,remoteRef,connection]);

  const findAnchor = useCallback((event: MouseEvent): HTMLAnchorElement | null => {
    const root = divRef.current;
    const target = event.target;
    if (!root || !(target instanceof Element)) return null;
    const anchor = target.closest<HTMLAnchorElement>('a[href]');
    if (!anchor || !root.contains(anchor)) return null;
    return anchor;
  }, []);

  const handleLinkClick = useCallback((event: MouseEvent) => {
    const anchor = findAnchor(event);
    if (!anchor) return;
    const href = anchor.getAttribute('href') || '';
    const context = {
      ...linkContext,
      label: anchor.textContent?.trim() || undefined,
    };
    const target = resolveLinkTarget(href, context);
    if (target.kind === 'anchor') return;
    event.preventDefault();
    event.stopPropagation();
    void (async () => {
      await openInternalLink(href, context);
    })();
  }, [findAnchor, linkContext]);

  const handleLinkContextMenu = useCallback((event: MouseEvent) => {
    const anchor = findAnchor(event);
    if (!anchor) return;
    event.preventDefault();
    event.stopPropagation();
    setLinkMenu({
      href: anchor.getAttribute('href') || '',
      context: {
        ...linkContext,
        label: anchor.textContent?.trim() || undefined,
      },
      position: { x: event.clientX, y: event.clientY },
    });
  }, [findAnchor, linkContext]);

  useEffect(() => {
    if (divRef.current) {
      injectCopyButtons(divRef.current);
      return observeMarkdownRhythmSnap(divRef.current);
    }
  }, [body]);
  useMermaidDiagrams(divRef, [body]);

  return (
    <>
      <div className={previewStyles.markdownPreviewDocument}>
        {cover && <MarkdownCoverView previewItem={previewItem} cover={cover} />}
        {cover ? (
          <>
            <MarkdownPropertiesBlock content={previewItem.content} />
            <div
              ref={divRef}
              className="preview-markdown md-content markdown-has-cover"
              onClick={handleLinkClick}
              onContextMenu={handleLinkContextMenu}
              dangerouslySetInnerHTML={{
                __html: renderMarkdownPreview(body, markdownOptions),
              }}
            />
            <DocumentReferencesBlock previewItem={previewItem} />
          </>
        ) : (
          <MarkdownNoCoverDropHost coverTarget={coverTarget}>
            <MarkdownPropertiesBlock content={previewItem.content} />
            <div
              ref={divRef}
              className="preview-markdown md-content"
              onClick={handleLinkClick}
              onContextMenu={handleLinkContextMenu}
              dangerouslySetInnerHTML={{
                __html: renderMarkdownPreview(body, markdownOptions),
              }}
            />
            <DocumentReferencesBlock previewItem={previewItem} />
          </MarkdownNoCoverDropHost>
        )}
      </div>
      {linkMenu && (
        <LinkContextMenu
          state={linkMenu}
          onClose={() => setLinkMenu(null)}
        />
      )}
    </>
  );
}

// ── CsvPreview ──

const SpreadsheetPreview = lazy(() => import('./SpreadsheetPreview'));
const DocxPreview = lazy(() => import('./DocxPreview'));
const PdfReader = lazy(() => import('./PdfReader'));

// ── PdfPreview ──
// sourceUrl 是新路径；content/base64 只保留给旧 previewItem 兼容。

function appendPdfViewerHash(url: string): string {
  if (!url || url === 'about:blank') return url;
  const params = 'toolbar=1&navpanes=0';
  const hashIndex = url.indexOf('#');
  if (hashIndex < 0) return `${url}#${params}`;
  const prefix = url.slice(0, hashIndex + 1);
  const hash = url.slice(hashIndex + 1);
  return `${prefix}${hash ? `${hash}&` : ''}${params}`;
}

function PdfPreview({ previewItem }: { previewItem: PreviewItem }) {
  const [systemReader,setSystemReader]=useState(false);
  useEffect(()=>setSystemReader(false),[previewItem.id]);
  const [inspection,setInspection]=useState<{pages?:number;error?:string}|null>(null);
  const [attempt,setAttempt]=useState(0);
  const sourceKey=JSON.stringify({sourceFilePath:previewItem.filePath,remoteContentRef:previewItem.remoteContentRef,resourceId:previewItem.contentResourceId});
  const versionKey=JSON.stringify(previewItem.fileVersion||null);
  const inspectable=!!(previewItem.filePath||previewItem.remoteContentRef||previewItem.contentResourceId);
  useEffect(()=>{
    if(!inspectable)return;
    let cancelled=false;setInspection(null);
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),20000);
    void hanaFetch('/api/preview/pdf',{throwOnHttpError:false,method:'POST',headers:{'Content-Type':'application/json'},body:sourceKey,signal:controller.signal}).then(async response=>{
      const data=await response.json();if(!response.ok)throw new Error(data.error||'PDF 无法加载');
      if(!cancelled)setInspection({pages:data.pages});
    }).catch(error=>{if(!cancelled)setInspection({error:error.name==='AbortError'?'PDF 检查超时，请重试或使用系统应用打开':error.message});}).finally(()=>clearTimeout(timer));
    return()=>{cancelled=true;clearTimeout(timer);controller.abort();};
  },[sourceKey,versionKey,inspectable,attempt]);
  const [source,setSource]=useState<{url:string;revoke:boolean;error?:string}>({url:'about:blank',revoke:false});
  useEffect(() => {
    const next = (() => {
    if (previewItem.sourceUrl) {
      return { url: previewItem.sourceUrl, revoke: false };
    }
    if (!previewItem.content) {
      return { url: 'about:blank', revoke: false };
    }
    let raw;
    try{raw=atob(previewItem.content);}catch{return {url:'about:blank',revoke:false,error:'PDF 数据已损坏'};}
    if(!raw.slice(0,1024).includes('%PDF-'))return {url:'about:blank',revoke:false,error:'PDF 数据格式不正确'};
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    if (typeof URL.createObjectURL !== 'function') {
      return { url: `data:application/pdf;base64,${previewItem.content}`, revoke: false };
    }
    return { url: URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })), revoke: true };
    })();
    setSource(next);
    return () => {if(next.revoke)URL.revokeObjectURL(next.url);};
  }, [previewItem.content,previewItem.sourceUrl]);

  const error=inspection?.error||source.error;
  if(error&&!systemReader)return <div className={previewStyles.previewUnavailable} role="alert"><p>{error}</p><button onClick={()=>setAttempt(value=>value+1)}>重新加载</button>{!source.error&&source.url!=='about:blank'&&<button onClick={()=>setSystemReader(true)}>系统阅读器</button>}{previewItem.filePath&&<button onClick={()=>window.platform.openFile(previewItem.filePath!)}>系统打开</button>}</div>;
  if(inspectable&&!inspection||source.url==='about:blank')return <div className={previewStyles.previewUnavailable} role="status">正在检查 PDF…</div>;
  if(!systemReader)return <Suspense fallback={<div role="status">正在加载 PDF 阅读器…</div>}><PdfReader key={`${previewItem.id}:${versionKey}:${attempt}`} restoreKey={`${previewItem.id}:${versionKey}`} url={source.url} base64={previewItem.sourceUrl?undefined:previewItem.content} name={previewItem.title || 'PDF 预览'} onSystemReader={()=>setSystemReader(true)}/></Suspense>;
  return <div className="enigma-pdf-system">
    <div className="enigma-pdf-system-header"><small>系统阅读器{inspection?.pages?` · ${inspection.pages} 页`:''} · 打印、下载与表单</small><div><a href={source.url} download={previewItem.title||'document.pdf'}>下载 PDF</a><button onClick={()=>setSystemReader(false)}>返回阅读</button></div></div>
    <small className="enigma-pdf-hint">若无法显示，可下载后用系统应用打开。</small>
    <iframe key={attempt} className="preview-pdf" title={previewItem.title || 'PDF 预览'} src={appendPdfViewerHash(source.url)} />
  </div>;
}

// ── FileInfoPreview ──

function FileInfoPreview({ previewItem }: { previewItem: PreviewItem }) {
  const t = window.t ?? ((p: string) => p);
  const ext = previewItem.ext || '';

  return (
    <div className="preview-file-info">
      <div
        className="preview-file-icon"
        dangerouslySetInnerHTML={{ __html: fileIconSvg(ext) }}
      />
      <div className="preview-file-name">{previewItem.title}</div>
      <div className="preview-file-ext">
        {ext.toUpperCase()} {t('desk.fileLabel')}
      </div>
      <button
        className="preview-file-open-btn"
        onClick={() => {
          if (previewItem.filePath) window.platform?.openFile?.(previewItem.filePath);
        }}
      >
        {t('desk.openWithDefault')}
      </button>
    </div>
  );
}

// ── PreviewRenderer ──

export function PreviewRenderer({ previewItem,htmlFind }: PreviewRendererProps) {
  if (previewItem.status === 'unavailable') return <UnavailablePreviewTarget previewItem={previewItem}/>;
  if (previewItem.status === 'missing') {
    return <MissingPreviewTarget previewItem={previewItem} />;
  }

  switch (previewItem.type) {
    case 'media':
      return <MediaPreview key={previewItem.id} previewItem={previewItem}/>;
    case 'browser':
      return <SidebarBrowser key={previewItem.id} sessionPath={previewItem.browserSessionPath} />;
    case 'html':
      return <HtmlPreview previewItem={previewItem} htmlFind={htmlFind}/>;

    case 'markdown':
      return <MarkdownPreview previewItem={previewItem} />;

    case 'code':
      return (
        <pre className="preview-code">
          <code className={previewItem.language ? `language-${previewItem.language}` : undefined}>
            {previewItem.content}
          </code>
        </pre>
      );

    case 'csv':
      return <Suspense fallback={<div role="status">正在加载表格…</div>}><SpreadsheetPreview key={previewItem.id} previewItem={previewItem}/></Suspense>;

    // image / svg：旧类型 previewItem 的 fallback。新路径不再产生此类 previewItem，
    // 持久化或旧 session 恢复时可能命中。点击后按 owner 路由到统一的 MediaViewer。
    case 'image':
    case 'svg':
      return <LegacyMediaFallback previewItem={previewItem} />;

    case 'pdf':
      return <PdfPreview previewItem={previewItem} />;

    case 'docx':
      return <Suspense fallback={<div role="status">正在加载 Word 阅读器…</div>}><DocxPreview key={previewItem.id} previewItem={previewItem}/></Suspense>;
    case 'xlsx':
      return <Suspense fallback={<div role="status">正在加载表格…</div>}><SpreadsheetPreview key={previewItem.id} previewItem={previewItem}/></Suspense>;

    case 'file-info':
      return <FileInfoPreview previewItem={previewItem} />;

    default:
      return (
        <pre className="preview-code">{previewItem.content}</pre>
      );
  }
}
