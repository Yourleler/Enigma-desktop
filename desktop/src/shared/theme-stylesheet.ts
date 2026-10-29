/** Keep the current palette until the replacement stylesheet has loaded.
 * A newer selection invalidates an older load, including rapid theme taps. */
export function createThemeStylesheetSwitch(doc: Document) {
  let current = doc.getElementById('themeSheet') as HTMLLinkElement | null;
  let pending: HTMLLinkElement | null = null;
  return (href: string, apply: () => void) => {
    const absolute = new URL(href, doc.baseURI).href;
    if (pending?.href === absolute) return;
    pending?.remove(); pending = null;
    if (!current || current.href === absolute) { apply(); return; }
    const next = doc.createElement('link');
    next.rel = 'stylesheet'; next.media = 'not all'; next.href = href;
    next.dataset.pendingTheme = '';
    pending = next;
    next.onload = () => {
      if (pending !== next) return;
      current?.removeAttribute('id'); next.id = 'themeSheet';
      next.media = 'all'; delete next.dataset.pendingTheme;
      current?.remove(); current = next; pending = null;
      apply();
    };
    next.onerror = () => {
      if (pending !== next) return;
      next.remove(); pending = null;
      console.warn('[theme] Theme stylesheet could not load; keeping the current appearance.');
    };
    doc.head.append(next);
  };
}
