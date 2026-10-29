import { openPreview } from '../stores/preview-actions';
import type { BrowserViewerOpenTarget } from '../types';

// Navigation is an explicit user intent, not persisted file content. Switching
// back to this preview must not reload the page or erase a filled form.
const pending = new Map<string, string>();
export const browserPreviewKey = (sessionPath?: string | null) => `browser:${sessionPath || 'standalone'}`;

export function takeBrowserNavigation(sessionPath?: string | null): string | undefined {
  const key = browserPreviewKey(sessionPath), url = pending.get(key);
  pending.delete(key);
  return url;
}

export function openBrowserPreview(target: BrowserViewerOpenTarget = {}): void {
  if (!window.platform?.sidebarBrowserBind) {
    window.platform?.openBrowserViewer?.(target);
    return;
  }
  const key = browserPreviewKey(target.sessionPath);
  if (target.url) pending.set(key, target.url);
  openPreview({id: key, type: 'browser', title: '网页', content: '', browserSessionPath: target.sessionPath || null});
  window.dispatchEvent(new CustomEvent('enigma-browser-navigation', {detail: key}));
}
