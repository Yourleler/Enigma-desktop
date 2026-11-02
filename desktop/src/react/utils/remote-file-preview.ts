import type {
  FileVersion,
  PreviewItem,
  RemoteWorkbenchContentRef,
  VersionedWriteResult,
} from '../types';
import type { DeskFile } from '../types';
import type { FileRef } from '../types/file-ref';
import { hanaFetch } from '../hooks/use-hana-fetch';
import { beginPreviewOpen, openPreview, upsertPreviewItem } from '../stores/preview-actions';
import { useStore } from '../stores';
import { resolveServerConnection } from '../services/server-connection';
import {
  encodeWorkbenchContentPath,
  resolveFileRefPreviewAccess,
  resolveWorkbenchFilePreviewAccess,
} from '../services/resource-access';
import { resolveFileRefUrl } from '../services/resource-url';
import { BINARY_PREVIEW_TYPES, PREVIEWABLE_EXTS, openFilePreview } from './file-preview';
import { extOfName, inferKindByExt, isMediaKind } from './file-kind';
import { openMediaViewerForRef } from './open-media-viewer';
import { showError } from './ui-helpers';
import { isWebRuntime } from './platform-runtime';
import {capturePreviewContext,currentPreviewReadTarget,previewConnectionKey} from './preview-context';
import { openMediaPreview } from './media-preview';

export { isWebRuntime };

export interface WorkbenchPreviewInput {
  placement?: 'files'|'tab';
  anchor?: string;
  file: DeskFile;
  mountId?: string | null;
  rootId?: string | null;
  subdir: string;
  localRootPath?: string | null;
  nativeRootPath?: string | null;
  preferNativePath?: boolean;
}

export interface FileRefPreviewContext {
  placement?: 'files'|'tab';
  origin: 'desk' | 'session';
  sessionPath?: string;
  messageId?: string;
  blockIdx?: number;
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export { encodeWorkbenchContentPath };

export function isRemoteWorkbenchContentRef(value: unknown): value is RemoteWorkbenchContentRef {
  if (!isRecord(value)) return false;
  return (value.kind === 'workbench-file' || value.kind === 'mobile-workbench')
    && (typeof value.mountId === 'string' || typeof value.rootId === 'string')
    && typeof value.subdir === 'string'
    && typeof value.name === 'string';
}

export function normalizeWorkbenchContentRef(ref: RemoteWorkbenchContentRef): RemoteWorkbenchContentRef {
  const mountId = ref.mountId || ref.rootId || 'default';
  return {
    ...ref,
    kind: 'workbench-file',
    mountId,
    rootId: ref.rootId || mountId,
    subdir: ref.subdir || '',
    name: ref.name,
  };
}

function previewId(prefix: string, key: string): string {
  return `${prefix}-${encodeURIComponent(key)}`;
}

function appendCacheBustQuery(path: string, attempt: number): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}v=${encodeURIComponent(`${Date.now()}-${attempt}`)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeFileVersion(value: unknown): FileVersion | null {
  if (!isRecord(value)) return null;
  const mtimeMs = Number(value.mtimeMs);
  const size = Number(value.size);
  if (!Number.isFinite(mtimeMs) || !Number.isFinite(size)) return null;
  return {
    mtimeMs,
    size,
    sha256: typeof value.sha256 === 'string' ? value.sha256 : undefined,
  };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

interface PreviewContentSnapshot {
  content: string;
  fileVersion?: FileVersion;
}

function fileVersionFromContentHeaders(headers: Headers): FileVersion | undefined {
  if(!headers.has('X-Hana-File-MtimeMs')||!headers.has('X-Hana-File-Size'))return undefined;
  const mtimeMs = Number(headers.get('X-Hana-File-MtimeMs'));
  const size = Number(headers.get('X-Hana-File-Size'));
  if (!Number.isFinite(mtimeMs) || !Number.isFinite(size)) return undefined;
  return { mtimeMs, size };
}

function remoteContentRefWithVersion(
  ref: RemoteWorkbenchContentRef | undefined,
  version: FileVersion | undefined,
): RemoteWorkbenchContentRef | undefined {
  if (!ref) return ref;
  return {
    ...ref,
    version,
  };
}

async function readContentForPreview(contentPath: string, previewType: string): Promise<PreviewContentSnapshot> {
  const res = await hanaFetch(contentPath);
  if (!res.ok) throw new Error(res.status === 403 ? '文件访问权限已变化，请确认权限后重试' : res.status === 404 ? '文件已移动或不存在，请从工作台重新打开' : `文件加载失败（HTTP ${res.status}），请重试`);
  const fileVersion = fileVersionFromContentHeaders(res.headers);
  let content: string;
  if (BINARY_PREVIEW_TYPES.has(previewType)) {
    content = await blobToBase64(await res.blob());
  } else {
    content = await res.text();
  }
  return { content, fileVersion };
}

const REMOTE_REFRESH_RETRY_DELAYS_MS = [80, 240, 600] as const;
const remoteRefreshes=new Map<string,symbol>();

export interface RemoteWorkbenchRefreshOptions {
  retryMissing?: boolean;
  retryUnchanged?: boolean;
  retryDelaysMs?: readonly number[];
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

async function readRemotePreviewContentWithRetry(
  contentPath: string,
  item: PreviewItem,
  options: RemoteWorkbenchRefreshOptions,
  valid:()=>boolean,
): Promise<PreviewContentSnapshot|undefined> {
  const retryDelaysMs = options.retryDelaysMs ?? REMOTE_REFRESH_RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt += 1) {
    if(!valid())return;
    if(item.type==='media'||item.type==='docx'||item.type==='xlsx') {
      const response=await hanaFetch(contentPath,{method:'HEAD'});
      return {content:'',fileVersion:fileVersionFromContentHeaders(response.headers)};
    }
    const nextRead = await readContentForPreview(appendCacheBustQuery(contentPath, attempt), item.type);
    const canRetry = attempt < retryDelaysMs.length;
    if(!valid())return;
    const shouldRetryUnchanged = options.retryUnchanged && nextRead.content === item.content;
    if (!canRetry || !shouldRetryUnchanged) return nextRead;
    await delay(retryDelaysMs[attempt] ?? 0);
  }
}

async function openRemoteContentPreview({
  contentPath,
  id,
  title,
  ext,
  mediaRef,
  mediaContext,
  remoteContentRef,
  resourceId,
  anchor,
  placement,
  isCurrent = beginPreviewOpen(),
}: {
  contentPath: string;
  id: string;
  title: string;
  ext: string;
  mediaRef?: FileRef;
  mediaContext: { origin: 'desk' | 'session'; sessionPath?: string };
  remoteContentRef?: RemoteWorkbenchContentRef;
  resourceId?: string;
  anchor?: string;
  placement?: 'files'|'tab';
  isCurrent?: () => boolean;
}): Promise<void> {
  const mediaKind = inferKindByExt(ext);
  if ((isMediaKind(mediaKind) || mediaKind === 'audio') && mediaRef) {
    if (mediaContext.origin === 'desk' || mediaKind === 'audio' || placement) openMediaPreview(mediaRef, remoteContentRef,placement);
    else openMediaViewerForRef(mediaRef, mediaContext);
    return;
  }

  const previewType = PREVIEWABLE_EXTS[ext];
  if(previewType==='docx'||previewType==='xlsx') {
    const item: PreviewItem={id,type:previewType,title,ext,content:'',remoteContentRef,contentResourceId:resourceId,storageKind:'remote-content'};
    const ready=await readOfficePreviewItem(item);
    if(isCurrent())openPreview(ready,{placement});
    return;
  }
  if (previewType && previewType !== 'docx' && previewType !== 'xlsx') {
    const read = await readContentForPreview(contentPath, previewType);
    if(!isCurrent())return;
    const fileVersion = read.fileVersion;
    const previewItem: PreviewItem = {
      id,
      type: previewType,
      title,
      content: read.content,
      ext,
      language: previewType === 'code' ? ext : undefined,
      storageKind: 'remote-content',
      fileVersion,
      remoteContentRef: remoteContentRefWithVersion(remoteContentRef, fileVersion),
      contentResourceId: resourceId,
    };
    openPreview(previewItem,{anchor,placement});
    return;
  }

  openPreview({
    id,
    type: 'file-info',
    title,
    content: '',
    ext,
    storageKind: 'remote-content',
    remoteContentRef,
  },{placement});
}

/** Restore content without activating tabs or changing the user's selection. */
export async function readRemotePreviewItem(item: PreviewItem): Promise<PreviewItem> {
  const ref = item.remoteContentRef;
  if(item.type==='docx'||item.type==='xlsx')return readOfficePreviewItem(item);
  if (!isRemoteWorkbenchContentRef(ref)&&!item.contentResourceId) return item;
  const contentPath = isRemoteWorkbenchContentRef(ref)?encodeWorkbenchContentPath(ref):`/api/resources/${encodeURIComponent(item.contentResourceId!)}/content`;
  if (item.type === 'media' || item.type === 'file-info') return {...item, status: 'available', remoteContentRef: ref?{...ref, contentPath}:undefined};
  const read = await readContentForPreview(contentPath, item.type);
  return {...item, content: read.content, status: 'available', fileVersion: read.fileVersion,
    remoteContentRef: ref?{...ref, contentPath, version: read.fileVersion}:undefined};
}

async function readOfficePreviewItem(item: PreviewItem): Promise<PreviewItem> {
  if(item.type==='docx'||item.type==='xlsx'){
    const ref=item.remoteContentRef;const contentPath=isRemoteWorkbenchContentRef(ref)?encodeWorkbenchContentPath(ref):item.contentResourceId?`/api/resources/${encodeURIComponent(item.contentResourceId)}/content`:null;
    if(!contentPath)throw new Error('文档缺少读取入口，请从工作台重新打开');
    const response=await hanaFetch(contentPath,{method:'HEAD'});
    return {...item,content:'',fileVersion:fileVersionFromContentHeaders(response.headers),status:'available'};
  }
  const response=await hanaFetch('/api/preview/office',{throwOnHttpError:false,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({format:item.type,remoteContentRef:item.remoteContentRef,resourceId:item.contentResourceId})});
  const data=await response.json();
  if(!response.ok||typeof data.html!=='string')throw new Error(data.error||'文档预览失败，请重试');
  return {...item,content:data.html,fileVersion:data.version,status:'available'};
}

export async function saveRemoteWorkbenchContent(
  ref: RemoteWorkbenchContentRef,
  content: string,
  expectedVersion?: FileVersion | null,
): Promise<VersionedWriteResult> {
  const normalized = normalizeWorkbenchContentRef(ref);
  const res = await hanaFetch('/api/workbench/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'writeText',
      mountId: normalized.mountId || 'default',
      subdir: normalized.subdir || '',
      name: normalized.name,
      content,
      expectedVersion: expectedVersion ?? null,
    }),
  });
  const data: unknown = await res.json();
  if (!isRecord(data)) throw new Error('invalid remote write response');
  return {
    ok: data.ok === true,
    conflict: data.conflict === true,
    version: normalizeFileVersion(data.version),
  };
}

function refsPointToSameWorkbenchFile(
  left: RemoteWorkbenchContentRef | null | undefined,
  right: RemoteWorkbenchContentRef,
): boolean {
  if (!isRemoteWorkbenchContentRef(left)) return false;
  const normalizedLeft = normalizeWorkbenchContentRef(left);
  const normalizedRight = normalizeWorkbenchContentRef(right);
  return (normalizedLeft.mountId || 'default') === (normalizedRight.mountId || 'default')
    && (normalizedLeft.subdir || '') === (normalizedRight.subdir || '')
    && normalizedLeft.name === normalizedRight.name;
}

export async function refreshPreviewItemsFromRemoteWorkbenchTarget(
  target: RemoteWorkbenchContentRef,
  options: RemoteWorkbenchRefreshOptions = {},
): Promise<void> {
  const normalized = normalizeWorkbenchContentRef(target);
  const owned=capturePreviewContext(true),key=JSON.stringify([previewConnectionKey(),normalized.mountId,normalized.subdir,normalized.name]),token=Symbol();
  remoteRefreshes.set(key,token);
  const state = useStore.getState();
  const matching = (state.previewItems || []).filter(item =>
    refsPointToSameWorkbenchFile(item.remoteContentRef, normalized));
  try{for (const item of matching) {
    const valid=()=>owned()&&remoteRefreshes.get(key)===token&&!!currentPreviewReadTarget(item);
    const contentPath = item.remoteContentRef?.contentPath || encodeWorkbenchContentPath(normalized);
    let read:PreviewContentSnapshot|undefined;
    try{read=await readRemotePreviewContentWithRetry(contentPath, item, options,valid);}catch(error){const current=currentPreviewReadTarget(item);if(valid()&&current)upsertPreviewItem({...current,loadError:getErrorMessage(error)});continue;}
    if(!read||!valid())return;
    const current=currentPreviewReadTarget(item)!;
    // Content and version must come from the same response. A list/watcher
    // version cannot safely stamp bytes returned from another point in time.
    const nextVersion=read.fileVersion;
    if(['markdown','code','csv','text'].includes(item.type)&&!nextVersion){upsertPreviewItem({...current,loadError:'刷新没有取得对应文件版本，原预览已保留，请重新读取。'});continue;}
    const remoteContentRef = item.remoteContentRef
      ? {
          ...item.remoteContentRef,
          version: nextVersion,
        }
      : item.remoteContentRef;
    upsertPreviewItem({
      ...current,
      content: read.content,
      fileVersion: nextVersion,
      remoteContentRef,
      status: 'available',
      missingAt: null,
      loadError:undefined,
    });
  }}finally{if(remoteRefreshes.get(key)===token)remoteRefreshes.delete(key);}
}

export async function openWorkbenchFilePreview(input: WorkbenchPreviewInput): Promise<void> {
  if (input.file.isDir) return;
  const isCurrent=beginPreviewOpen();
  const name = input.file.name;
  const connection = resolveServerConnection(useStore.getState());
  const access = resolveWorkbenchFilePreviewAccess(input, { connection }, {
    preferNativePath: !isWebRuntime() && input.preferNativePath !== false,
  });
  if (access.mode === 'unsupported') return;
  if (access.mode === 'native-path') {
    await openFilePreview(access.path, name, access.ext, {
      origin: 'desk',
      sourceRootPath: access.sourceRootPath,
      anchor:input.anchor,
      placement:input.placement,
    });
    return;
  }
  const studioId = connection?.studioId || 'default';
  const mediaKind = inferKindByExt(access.ext);
  const mediaRef: FileRef | undefined = (isMediaKind(mediaKind) || mediaKind === 'audio')
    ? {
        id: `workbench:${access.mountId}:${access.subdir}:${name}`,
        kind: mediaKind,
        source: 'desk',
        name,
        path: '',
        ext: access.ext,
        version: access.version,
        workbenchScope:{mountId:access.mountId,subdir:access.subdir,rootKey:useStore.getState().deskBasePath},
        resource: {
          resourceId: `workbench:${access.mountId}:${access.subdir}:${name}`,
          studioId,
          links: { self: access.contentPath, content: access.contentPath },
        },
      }
    : undefined;

  try {
    await openRemoteContentPreview({
      contentPath: access.versionedContentPath,
      id: previewId('workbench', `${access.mountId}:${access.subdir}:${name}`),
      title: name,
      ext: access.ext,
      mediaRef,
      mediaContext: { origin: 'desk' },
      remoteContentRef: access.remoteContentRef,
      anchor: input.anchor,
      placement: input.placement,
      isCurrent,
    });
  } catch (err) {
    if(!isCurrent())return;
    console.error('[remote-preview] workbench preview failed:', err);
    showError(getErrorMessage(err));
  }
}

export async function openMobileWorkbenchPreview(input: WorkbenchPreviewInput): Promise<void> {
  await openWorkbenchFilePreview(input);
}

export async function openFileRefPreview(file: FileRef, context: FileRefPreviewContext): Promise<void> {
  if (file.status === 'expired') return;
  if (isMediaKind(file.kind) || file.kind === 'audio') {
    if (context.origin === 'desk' || file.kind === 'audio' || context.placement) openMediaPreview(file,undefined,context.placement);
    else openMediaViewerForRef(file, {
      origin: context.origin,
      sessionPath: context.sessionPath,
    });
    return;
  }

  const connection = resolveServerConnection(useStore.getState());
  const access = resolveFileRefPreviewAccess(file, { connection }, {preferNativePath: !isWebRuntime()});
  if (access.mode === 'native-path') {
    await openFilePreview(access.path, file.name, file.ext || extOfName(file.name) || '', {
      origin: context.origin,
      sessionPath: context.sessionPath,
      messageId: context.messageId,
      fileId: file.fileId,
      blockIdx: context.blockIdx,
      placement:context.placement,
    });
    return;
  }
  if (access.mode !== 'resource-content') return;

  try {
    await openRemoteContentPreview({
      contentPath: access.contentPath,
      id: previewId('resource', access.resourceId),
      resourceId: access.resourceId,
      title: file.name,
      ext: file.ext || extOfName(file.name) || '',
      placement:context.placement,
      mediaContext: {
        origin: context.origin,
        sessionPath: context.sessionPath,
      },
    });
  } catch (err) {
    console.error('[remote-preview] session file preview failed:', err);
    showError(getErrorMessage(err));
  }
}

export function fileRefDownloadUrl(file: FileRef): string | null {
  if (file.status === 'expired') return null;
  try {
    const resolved = resolveFileRefUrl(file, {
      connection: resolveServerConnection(useStore.getState()),
      platform: typeof window !== 'undefined' ? window.platform : null,
      preferLocalFile: false,
    });
    return resolved.mode === 'local-file' ? null : resolved.url;
  } catch {
    return null;
  }
}
