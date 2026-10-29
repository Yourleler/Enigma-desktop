import { useLayoutEffect, useState, type RefObject } from 'react';

const OCCLUDERS = '[data-native-browser-occluder],[data-menu-surface],[role="dialog"],[role="menu"],[role="listbox"],[role="tooltip"],.enigma-modal-backdrop,.enigma-surface-menu,.enigma-drawer-scrim,[data-testid="settings-modal-overlay"]';

export function browserDockVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  if (document.hidden || rect.width < 40 || rect.height < 40 || element.closest('[inert],[aria-hidden="true"]')) return false;
  for (const overlay of document.querySelectorAll<HTMLElement>(OCCLUDERS)) {
    if (overlay.contains(element)) continue;
    const style = getComputedStyle(overlay);
    if (style.visibility === 'hidden' || style.display === 'none' || overlay.hidden) continue;
    const box = overlay.getBoundingClientRect();
    if (box.width && box.height && box.left < rect.right && box.right > rect.left && box.top < rect.bottom && box.bottom > rect.top) return false;
  }
  return true;
}

/** Native child views ignore DOM z-index. Send only changed geometry/visibility
 * and hide them before showing menus; the page itself keeps running. */
export function useBrowserDock(ref: RefObject<HTMLDivElement | null>, surfaceId: string | null) {
  const [visible, setVisible] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !surfaceId) { setVisible(false); return; }
    let sequence = 0, last = '', frame = 0;
    const sync = () => {
      frame = 0;
      const rect = element.getBoundingClientRect();
      const show = browserDockVisible(element);
      const bounds = {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
      const key = JSON.stringify([bounds, show]);
      if (last === key) return;
      last = key; setVisible(show);
      window.platform?.sidebarBrowserLayout?.({surfaceId, sequence: ++sequence, bounds, visible: show});
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };
    const mutations = new MutationObserver(records => {
      if (records.some(record => record.attributeName !== 'style' || record.target instanceof Element && record.target.matches(OCCLUDERS))) sync();
    });
    mutations.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'inert', 'open']});
    const resize = new ResizeObserver(schedule);
    resize.observe(element);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    document.addEventListener('transitionend', schedule, true);
    // Pointer entry can reveal a tooltip without changing layout.
    document.addEventListener('pointerover', schedule, true);
    sync();
    return () => {
      cancelAnimationFrame(frame); mutations.disconnect(); resize.disconnect();
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      document.removeEventListener('transitionend', schedule, true);
      document.removeEventListener('pointerover', schedule, true);
      window.platform?.sidebarBrowserLayout?.({surfaceId, sequence: ++sequence, bounds: {x: 0, y: 0, width: 0, height: 0}, visible: false});
    };
  }, [ref, surfaceId]);
  return visible;
}
