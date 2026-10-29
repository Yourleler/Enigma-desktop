import type { RemoteWorkbenchContentRef } from '../types';
import type { MarkdownPreviewOptions } from './markdown';
import { encodeWorkbenchContentPath } from '../services/resource-access';
import { buildConnectionUrl, type ServerConnection } from '../services/server-connection';

export interface WorkbenchLinkScope {
  ref: RemoteWorkbenchContentRef;
  baseUrl: string;
}

/** Canonical paths stay within the selected mount. No native filesystem path
 * is inferred from a remote document's relative reference. */
function canonicalParts(value: string): string[] | null {
  const parts: string[] = [];
  for (const part of value.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else if (part.includes('\0')) return null;
    else parts.push(part);
  }
  return parts.length ? parts : null;
}

export function workbenchMarkdownOptions(ref: RemoteWorkbenchContentRef, connection: ServerConnection): MarkdownPreviewOptions {
  const root = canonicalParts(`${ref.subdir}/${ref.name}`);
  if (!root) return {allowLocalImages:false};
  const resolve = (filePath: string, includeTokenQuery: boolean) => {
    const parts = canonicalParts(filePath);
    if (!parts) return undefined;
    const name = parts.pop()!;
    const contentPath = encodeWorkbenchContentPath({mountId: ref.mountId || ref.rootId, subdir: parts.join('/'), name});
    return buildConnectionUrl(connection, contentPath, {includeTokenQuery});
  };
  return {
    filePath: '/' + root.join('/'),
    allowLocalImages: false,
    getFileUrl: filePath => resolve(filePath, true),
    getLinkUrl: filePath => resolve(filePath, false),
  };
}

export function resolveWorkbenchMarkdownLink(href: string, scope?: WorkbenchLinkScope): RemoteWorkbenchContentRef | null {
  if (!scope) return null;
  try {
    const url = new URL(href), expected = new URL(scope.baseUrl.replace(/\/+$/, '') + '/api/workbench/content');
    if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.username || url.password) return null;
    const mountId = scope.ref.mountId || scope.ref.rootId || 'default';
    if (url.searchParams.get('mountId') !== mountId) return null;
    const name = url.searchParams.get('name'), subdir = url.searchParams.get('subdir') || '';
    if (!name || /[\\/\0]/.test(name) || name === '.' || name === '..') return null;
    const parts = canonicalParts(`${subdir}/${name}`);
    if (!parts || parts.at(-1) !== name) return null;
    const normalized = {kind:'workbench-file' as const,mountId,rootId:scope.ref.rootId || mountId,subdir:parts.slice(0,-1).join('/'),name};
    return {...normalized,contentPath:encodeWorkbenchContentPath(normalized)};
  } catch { return null; }
}
