/** Wait for the selected settings page, then reveal the exact named control.
 * No control values are changed, and observers stop after finding the target. */
export function focusSettingsSearchResult(root: HTMLElement, title: string): () => void {
  let hit: HTMLElement | null = null, timer: ReturnType<typeof setTimeout> | undefined;
  const find = () => {
    if (hit) return;
    const candidates = [...root.querySelectorAll<HTMLElement>('h2,h3,[data-settings-label]')];
    hit = candidates.find(item => item.textContent?.trim() === title && !item.closest('[hidden]')) || null;
    if (!hit) return;
    observer.disconnect(); clearTimeout(timer);
    hit.setAttribute('data-settings-search-hit', '');
    hit.setAttribute('tabindex', '-1');
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    hit.scrollIntoView({block:'start', behavior: reduce ? 'instant' : 'smooth'});
    hit.focus({preventScroll:true});
    timer = setTimeout(() => hit?.removeAttribute('data-settings-search-hit'), 2400);
  };
  const observer = new MutationObserver(find);
  observer.observe(root, {childList:true, subtree:true});
  timer = setTimeout(() => observer.disconnect(), 4000);
  find();
  return () => {observer.disconnect(); clearTimeout(timer); hit?.removeAttribute('data-settings-search-hit');};
}
