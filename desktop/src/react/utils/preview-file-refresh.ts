import { useStore } from '../stores';
import { upsertPreviewItem } from '../stores/preview-actions';
import type { PreviewItem } from '../types';
import { readFileForPreviewType, type PreviewReadResult } from './preview-file-content';
import {capturePreviewContext,currentPreviewReadTarget} from './preview-context';

const refreshGenerations = new Map<string, symbol>();
const DEFAULT_RETRY_DELAYS_MS = [80, 240, 600] as const;

export interface PreviewFileRefreshOptions {
  retryMissing?: boolean;
  retryUnchanged?: boolean;
  retryDelaysMs?: readonly number[];
}

export const PREVIEW_FILE_CHANGE_REFRESH_OPTIONS: PreviewFileRefreshOptions = Object.freeze({
  retryMissing: true,
  retryUnchanged: true,
});

export const PREVIEW_FILE_CATCH_UP_REFRESH_OPTIONS: PreviewFileRefreshOptions = Object.freeze({
  retryMissing: true,
});

function beginRefresh(filePath: string): symbol {
  const next = Symbol();
  refreshGenerations.set(filePath, next);
  return next;
}

function isLatestRefresh(filePath: string, generation: symbol): boolean {
  return refreshGenerations.get(filePath) === generation;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

function fileVersionsEqual(a: PreviewItem['fileVersion'], b: PreviewItem['fileVersion']): boolean {
  if (!a || !b) return a === b;
  return a.mtimeMs === b.mtimeMs
    && a.size === b.size
    && a.sha256 === b.sha256;
}

function readMatchesCurrentItem(item: PreviewItem, read: PreviewReadResult): boolean {
  if (item.fileVersion && read.fileVersion) return fileVersionsEqual(item.fileVersion, read.fileVersion);
  const sourceUrl = read.sourceUrl ?? item.sourceUrl;
  return read.content === item.content && sourceUrl === item.sourceUrl;
}

async function readFileForPreviewTypeWithRetry(
  filePath: string,
  item: PreviewItem,
  generation: symbol,
  options: PreviewFileRefreshOptions,
  valid:()=>boolean,
): Promise<PreviewReadResult | null | undefined> {
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt += 1) {
    if(!valid())return undefined;
    const read = await readFileForPreviewType(filePath, item.type);
    if (!isLatestRefresh(filePath, generation)||!valid()) return undefined;

    const canRetry = attempt < retryDelaysMs.length;
    const shouldRetryMissing = !read && options.retryMissing;
    const shouldRetryUnchanged = !!read && options.retryUnchanged && readMatchesCurrentItem(item, read);
    if (!canRetry || (!shouldRetryMissing && !shouldRetryUnchanged)) return read;

    await delay(retryDelaysMs[attempt] ?? 0);
    if (!isLatestRefresh(filePath, generation)||!valid()) return undefined;
  }
}

export function __resetPreviewFileRefreshStateForTests(): void {
  refreshGenerations.clear();
}

export async function refreshPreviewItemsFromFile(filePath: string, options: PreviewFileRefreshOptions = {}): Promise<void> {
  const generation = beginRefresh(filePath);
  const owned=capturePreviewContext(true);
  const state = useStore.getState();
  try{for (const item of state.previewItems || []) {
    if (item.filePath !== filePath) continue;
    const valid=()=>owned()&&!!currentPreviewReadTarget(item);
    let read:PreviewReadResult|null|undefined;
    try{read=await readFileForPreviewTypeWithRetry(filePath, item, generation, options,valid);}
    catch(error){const current=currentPreviewReadTarget(item);if(owned()&&current&&isLatestRefresh(filePath,generation))upsertPreviewItem({...current,loadError:error instanceof Error?error.message:'文件刷新失败，原内容已保留。'});return;}
    const current=currentPreviewReadTarget(item);
    if (!isLatestRefresh(filePath, generation) || read === undefined||!owned()||!current) return;
    if (!read) {
      upsertPreviewItem({
        ...current,
        status: 'missing',
        missingAt: Date.now(),
      });
      continue;
    }
    if(current.fileVersion&&!read.fileVersion&&current.content!==read.content){
      upsertPreviewItem({...current,loadError:'刷新没有取得对应文件版本，原预览已保留，请重新读取。'});continue;
    }
    upsertPreviewItem({
      ...current,
      content: read.content,
      sourceUrl: read.sourceUrl ?? item.sourceUrl,
      fileVersion: read.fileVersion ?? item.fileVersion,
      status: 'available',
      missingAt: null,
      loadError:undefined,
    });
  }}finally{if(isLatestRefresh(filePath,generation))refreshGenerations.delete(filePath);}
}
