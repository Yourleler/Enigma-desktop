import { hanaFetch } from '../hooks/use-hana-fetch';
import { hasServerConnection } from '../services/server-connection';
import type { PreviewItem, RemoteWorkbenchContentRef, RightWorkspaceTab } from '../types';
import type { FileRef } from '../types/file-ref';
import { readFileForPreviewType } from '../utils/preview-file-content';
import { useStore } from './index';
import { normalizeWorkspacePath } from '../../../../shared/workspace-history.ts';
import { normalizePreviewTab } from '../../../../shared/workspace-ui-state.ts';
import { isWebRuntime } from '../utils/platform-runtime';
import { encodeWorkbenchContentPath } from '../services/resource-access';
import {
  normalizePreviewReadingPosition,
  type PreviewReadingPosition,
} from '../../../../shared/preview-reading-position.ts';

interface PersistedPreviewTab {
  id: string;
  filePath?: string;
  relativePath?: string;
  title?: string;
  type?: string;
  ext?: string;
  language?: string | null;
  sourceRootPath?: string;
  remoteContentRef?: RemoteWorkbenchContentRef;
  mediaRef?: FileRef;
  contentResourceId?: string;
  browserSessionPath?: string | null;
  readingPosition?: PreviewReadingPosition;
}

export interface PersistedWorkspaceUiState {
  updatedAt?: number;
  /** Legacy read-only field from the old folder-navigation desk. New writes omit it. */
  deskCurrentPath?: string;
  deskExpandedPaths?: string[];
  deskSelectedPath?: string;
  rightWorkspaceTab?: RightWorkspaceTab;
  jianView?: string;
  jianDrawerOpen?: boolean;
  previewOpen?: boolean;
  openTabs?: string[];
  activeTabId?: string | null;
  previewTabs?: PersistedPreviewTab[];
}

const SAVE_DEBOUNCE_MS = 350;
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingSaves = new Map<string, PersistedWorkspaceUiState>();
let unloadListenerInstalled = false;

/** Preserve a just-opened tab even if reload happens before the debounce. */
export async function flushPendingWorkspaceUiState(): Promise<void> {
  await Promise.all([...pendingSaves].map(async ([root, state]) => {
    const timer = saveTimers.get(root);
    if (timer) clearTimeout(timer);
    saveTimers.delete(root);
    const saved = await persistWorkspaceUiState(root, state, true);
    if (saved && pendingSaves.get(root) === state) pendingSaves.delete(root);
  }));
}

export type WorkspaceUiSurface = 'electron' | 'pwa';

function normalizeRoot(root: string | null | undefined): string | null {
  return normalizeWorkspacePath(root);
}

function normalizeSubdir(value: string | null | undefined): string {
  return (value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function joinWorkspacePath(root: string, relativePath: string): string {
  const base = root.replace(/[\\/]+$/g, '');
  const rel = normalizeSubdir(relativePath);
  return rel ? `${base}/${rel}` : base;
}

function relativePathFor(root: string, filePath: string | undefined): string {
  if (!filePath) return '';
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/g, '');
  const normalizedPath = filePath.replace(/\\/g, '/');
  if (normalizedPath === normalizedRoot) return '';
  const prefix = `${normalizedRoot}/`;
  return normalizedPath.startsWith(prefix) ? normalizedPath.slice(prefix.length) : '';
}

function previewTabFromItem(root: string, item: PreviewItem, readingPosition?: PreviewReadingPosition): PersistedPreviewTab | null {
  const relativePath = relativePathFor(root, item.filePath);
  const normalizedReadingPosition = normalizePreviewReadingPosition(readingPosition);
  return normalizePreviewTab({
    id: item.id,
    filePath: item.filePath,
    ...(relativePath ? { relativePath } : {}),
    title: item.title,
    type: item.type,
    ext: item.ext,
    language: item.language ?? null,
    ...(item.sourceRootPath ? { sourceRootPath: item.sourceRootPath } : {}),
    remoteContentRef: item.remoteContentRef,
    mediaRef: item.mediaRef,
    contentResourceId: item.contentResourceId,
    browserSessionPath: item.browserSessionPath,
    ...(normalizedReadingPosition ? { readingPosition: normalizedReadingPosition } : {}),
  }) as PersistedPreviewTab | null;
}

function restoredSourceRootPath(tab: PersistedPreviewTab, normalizedRoot: string, type: string): string | undefined {
  const explicitRoot = normalizeRoot(tab.sourceRootPath);
  if (explicitRoot) return explicitRoot;
  return type === 'html' && tab.relativePath ? normalizedRoot : undefined;
}

export function resolveWorkspaceUiSurface(): WorkspaceUiSurface {
  if (typeof document !== 'undefined' && document.documentElement.getAttribute('data-platform') === 'web') {
    return 'pwa';
  }
  if (typeof window !== 'undefined' && window.location?.pathname?.startsWith('/mobile')) {
    return 'pwa';
  }
  return 'electron';
}

function workspaceUiStateUrl(root: string): string {
  const params = new URLSearchParams();
  params.set('workspace', root);
  params.set('surface', resolveWorkspaceUiSurface());
  return `/api/preferences/workspace-ui-state?${params.toString()}`;
}

export function buildPersistedWorkspaceUiState(root: string): PersistedWorkspaceUiState {
  const state = useStore.getState();
  const previewItemsById = new Map(state.previewItems.map(item => [item.id, item]));
  const previewTabs = (state.openTabs || [])
    .map(id => previewItemsById.get(id))
    .filter((item): item is PreviewItem => !!item)
    .map(item => previewTabFromItem(root, item, state.previewReadingPositions?.[item.id]))
    .filter((item): item is PersistedPreviewTab => !!item);
  const persistedIds = new Set(previewTabs.map(tab => tab.id));
  const openTabs = (state.openTabs || []).filter(id => persistedIds.has(id));
  const activeTabId = state.activeTabId && openTabs.includes(state.activeTabId)
    ? state.activeTabId
    : (openTabs[0] || null);

  return {
    deskExpandedPaths: [...(state.deskExpandedPaths || [])].map(normalizeSubdir).filter(Boolean),
    deskSelectedPath: normalizeSubdir(state.deskSelectedPath),
    rightWorkspaceTab: state.rightWorkspaceTab,
    jianView: state.jianView,
    jianDrawerOpen: !!state.jianDrawerOpen,
    previewOpen: !!state.previewOpen,
    openTabs,
    activeTabId,
    previewTabs,
  };
}

export function readingPositionsFromPersistedWorkspaceUiState(
  persisted: PersistedWorkspaceUiState | null,
  allowedIds?: Iterable<string>,
): Record<string, PreviewReadingPosition> {
  if (!persisted?.previewTabs?.length) return {};
  const allowed = allowedIds ? new Set(allowedIds) : null;
  const out: Record<string, PreviewReadingPosition> = {};
  for (const tab of persisted.previewTabs) {
    if (!tab.id || (allowed && !allowed.has(tab.id))) continue;
    const normalized = normalizePreviewReadingPosition(tab.readingPosition);
    if (normalized) out[tab.id] = normalized;
  }
  return out;
}

export async function loadPersistedWorkspaceUiState(root: string): Promise<PersistedWorkspaceUiState | null> {
  const normalized = normalizeRoot(root);
  const state = useStore.getState();
  if (!normalized || !hasServerConnection(state)) return null;
  try {
    const res = await hanaFetch(workspaceUiStateUrl(normalized));
    const data = await res.json().catch(() => null);
    return data?.state && typeof data.state === 'object' ? data.state as PersistedWorkspaceUiState : null;
  } catch (err) {
    console.warn('[workspace-ui-state] load failed:', err);
    return null;
  }
}

export async function hydratePersistedPreviewItems(
  root: string,
  persisted: PersistedWorkspaceUiState | null,
): Promise<PreviewItem[]> {
  const normalizedRoot = normalizeRoot(root);
  if (!normalizedRoot || !persisted?.previewTabs?.length) return [];
  const items: PreviewItem[] = [];
  for (const rawTab of persisted.previewTabs) {
    const tab = normalizePreviewTab(rawTab) as PersistedPreviewTab | null;
    if (!tab) continue;
    const type = tab.type || 'file-info';
    if (type === 'browser') {
      // Restoring the panel attaches existing pages; it does not navigate.
      items.push({id: tab.id, type, title: tab.title || '网页', content: '', browserSessionPath: tab.browserSessionPath || null});
      continue;
    }
    const filePath = tab.relativePath
      ? joinWorkspacePath(normalizedRoot, tab.relativePath)
      : (tab.filePath || '');
    if (!tab.id) continue;
    let remoteContentRef = tab.remoteContentRef;
    if (isWebRuntime() && !remoteContentRef && tab.relativePath) {
      const parts = tab.relativePath.split('/');
      const name = parts.pop()!;
      const target = {mountId: normalizedRoot.startsWith('studio:') ? normalizedRoot.slice(7) : 'default', subdir: parts.join('/'), name};
      remoteContentRef = {kind: 'workbench-file', ...target, contentPath: encodeWorkbenchContentPath(target)};
    }
    const base: PreviewItem = {id: tab.id, type, title: tab.title || filePath.split('/').pop() || tab.id,
      content: '', ext: tab.ext, language: tab.language, mediaRef: tab.mediaRef, remoteContentRef,
      contentResourceId: tab.contentResourceId,
      ...(filePath && !isWebRuntime() ? {filePath} : {})};
    if (type === 'media' && remoteContentRef && !base.mediaRef) {
      const {inferKindByExt} = await import('../utils/file-kind');
      const contentPath = encodeWorkbenchContentPath(remoteContentRef);
      base.mediaRef = {id: tab.id, name: base.title, path: '', kind: inferKindByExt(tab.ext), source: 'desk', ext: tab.ext,
        resource: {resourceId: tab.id, studioId: 'default', links: {self: contentPath, content: contentPath}}};
    }
    if(type==='media'&&base.mediaRef&&remoteContentRef?.kind==='workbench-file'){
      base.mediaRef={...base.mediaRef,workbenchScope:{mountId:remoteContentRef.mountId||remoteContentRef.rootId||'default',subdir:remoteContentRef.subdir,rootKey:normalizedRoot}};
    }
    try {
      if (remoteContentRef || tab.contentResourceId) {
        const {readRemotePreviewItem} = await import('../utils/remote-file-preview');
        items.push(await readRemotePreviewItem(base));
        continue;
      }
      if (type === 'media' && tab.mediaRef) {items.push(base); continue;}
      if (!filePath || isWebRuntime()) {
        items.push({...base, status: 'unavailable', loadError: '请从工作台重新打开此文件，以确认它的当前位置和访问权限。'});
        continue;
      }
      const read = await readFileForPreviewType(filePath, type);
      if (!read) {items.push({...base, status: 'missing'}); continue;}
      items.push({
        ...base,
        content: read.content,
        filePath,
        ext: tab.ext,
        language: tab.language,
        sourceUrl: read.sourceUrl,
        sourceRootPath: restoredSourceRootPath(tab, normalizedRoot, type),
        fileVersion: read.fileVersion,
      });
    } catch (err) {
      console.warn('[workspace-ui-state] preview tab restore failed:', err);
      items.push({...base, status: 'unavailable', loadError: err instanceof Error ? err.message : '暂时无法加载文件，请重试'});
    }
  }
  return items;
}

export function schedulePersistCurrentWorkspaceUiState(root?: string | null): void {
  const normalized = normalizeRoot(root ?? useStore.getState().deskBasePath);
  if (!normalized || !hasServerConnection(useStore.getState())) return;
  const state = buildPersistedWorkspaceUiState(normalized);
  if (!unloadListenerInstalled && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', () => { void flushPendingWorkspaceUiState(); });
    unloadListenerInstalled = true;
  }
  pendingSaves.set(normalized, state);
  const existing = saveTimers.get(normalized);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    saveTimers.delete(normalized);
    void persistWorkspaceUiState(normalized, state).then(saved => {
      if (saved && pendingSaves.get(normalized) === state) pendingSaves.delete(normalized);
    });
  }, SAVE_DEBOUNCE_MS);
  saveTimers.set(normalized, timer);
}

export async function persistCurrentWorkspaceUiStateNow(root?: string | null): Promise<void> {
  const normalized = normalizeRoot(root ?? useStore.getState().deskBasePath);
  if (!normalized || !hasServerConnection(useStore.getState())) return;
  const state = buildPersistedWorkspaceUiState(normalized);
  const timer = saveTimers.get(normalized);
  if (timer) clearTimeout(timer);
  saveTimers.delete(normalized);
  pendingSaves.set(normalized, state);
  const saved = await persistWorkspaceUiState(normalized, state);
  if (saved && pendingSaves.get(normalized) === state) pendingSaves.delete(normalized);
}

async function persistWorkspaceUiState(root: string, state: PersistedWorkspaceUiState, keepalive = false): Promise<boolean> {
  const surface = resolveWorkspaceUiSurface();
  try {
    await hanaFetch('/api/preferences/workspace-ui-state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace: root, surface, state }),
      keepalive,
    });
    return true;
  } catch (err) {
    console.warn('[workspace-ui-state] save failed:', err);
    return false;
  }
}
