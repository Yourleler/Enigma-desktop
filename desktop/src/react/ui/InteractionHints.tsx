import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './Tooltip.module.css';

/** One delegated hint layer also covers host controls and portalled menus.
 * Explicit Tooltip components retain ownership of their own descriptions. */
export function InteractionHints() {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [hint, setHint] = useState<{ anchor: HTMLElement; text: string } | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  useEffect(() => {
    let target: HTMLElement | null = null;
    let originalTitle: string | null = null;
    let temporaryLabel: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    let keyboard = true;
    const hide = () => {
      clearTimeout(timer); clearTimeout(closeTimer);
      if (target) {
        if (originalTitle !== null && !target.hasAttribute('title')) target.setAttribute('title', originalTitle);
        if (temporaryLabel && target.getAttribute('aria-label') === temporaryLabel) target.removeAttribute('aria-label');
        const descriptions = (target.getAttribute('aria-describedby') || '').split(/\s+/).filter(value => value && value !== id);
        if (descriptions.length) target.setAttribute('aria-describedby', descriptions.join(' '));
        else target.removeAttribute('aria-describedby');
      }
      target = null; originalTitle = null; temporaryLabel = null; setHint(null);
    };
    const show = (event: Event) => {
      if (event.type === 'focusin' && !keyboard) return;
      const element = event.target instanceof Element ? event.target : null;
      if (element && target?.contains(element)) { clearTimeout(closeTimer); return; }
      // Embedded documents own their content interactions. Their title is an
      // accessible document name, not a hover hint to remove or float above it.
      if (element?.matches('iframe,object,embed')) { hide(); return; }
      if (element?.closest('[data-interaction-hint]')) { clearTimeout(closeTimer); return; }
      const anchor = element?.closest<HTMLElement>('[data-tooltip], [title], button, [role="button"], a[href], summary, select');
      if (!anchor || anchor.closest('[data-tooltip-managed], [inert], [aria-hidden="true"], .enigma-drawer-scrim, .mobile-drawer-scrim')) { hide(); return; }
      if (anchor === target) { clearTimeout(closeTimer); return; }
      // A menu already shows its labels and descriptions. Don't cover adjacent
      // choices with a second copy on keyboard focus; keep explicit help and
      // full text for genuinely clipped labels.
      const menu=anchor.closest('[data-menu-surface]');
      const explicit=anchor.dataset.tooltip??anchor.getAttribute('title');
      const clipped=[anchor,...anchor.querySelectorAll<HTMLElement>('span')].some(node=>node.clientWidth>0&&node.scrollWidth>node.clientWidth+1);
      if(menu&&explicit==null&&anchor.textContent?.trim()&&!clipped){hide();return;}
      const text = anchor.dataset.tooltip ?? anchor.getAttribute('title') ?? anchor.getAttribute('aria-label') ?? (anchor instanceof HTMLSelectElement ? anchor.labels?.[0]?.textContent?.trim() : anchor.textContent?.trim());
      if (!text?.trim()) { hide(); return; }
      hide(); target = anchor; originalTitle = anchor.getAttribute('title');
      if (originalTitle && !anchor.getAttribute('aria-label') && !anchor.textContent?.trim()) {
        temporaryLabel = originalTitle; anchor.setAttribute('aria-label', originalTitle);
      }
      if (originalTitle !== null) anchor.removeAttribute('title');
      timer = setTimeout(() => {
        if (!anchor.isConnected) { hide(); return; }
        anchor.setAttribute('aria-describedby', [anchor.getAttribute('aria-describedby'), id].filter(Boolean).join(' '));
        setHint({ anchor, text });
      }, event.type === 'focusin' ? 0 : 400);
    };
    const leave = (event: Event) => {
      const next = (event as MouseEvent).relatedTarget;
      if (next instanceof Node && (target?.contains(next) || panel.current?.contains(next))) return;
      clearTimeout(timer); clearTimeout(closeTimer);
      closeTimer = setTimeout(hide, 140);
    };
    const key = (event: KeyboardEvent) => { keyboard = true; if (event.key === 'Escape') hide(); };
    const pointer = () => { keyboard = false; hide(); };
    const scroll = (event: Event) => { if (!panel.current?.contains(event.target as Node)) hide(); };
    document.addEventListener('pointerover', show);
    document.addEventListener('focusin', show);
    document.addEventListener('pointerout', leave);
    document.addEventListener('focusout', leave);
    document.addEventListener('pointerdown', pointer, true);
    document.addEventListener('keydown', key, true);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', hide);
    return () => {
      hide();
      document.removeEventListener('pointerover', show); document.removeEventListener('focusin', show);
      document.removeEventListener('pointerout', leave); document.removeEventListener('focusout', leave);
      document.removeEventListener('pointerdown', pointer, true); document.removeEventListener('keydown', key, true);
      document.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', hide);
    };
  }, [id]);
  useLayoutEffect(() => {
    if (!hint || !panel.current) return;
    const place = () => {
      const a = hint.anchor.getBoundingClientRect(), p = panel.current!.getBoundingClientRect();
      setPosition({
        left: Math.max(8, Math.min(a.left + (a.width - p.width) / 2, window.innerWidth - p.width - 8)),
        top: Math.max(8, Math.min(a.top >= p.height + 16 ? a.top - p.height - 8 : a.bottom + 8, window.innerHeight - p.height - 8)),
      });
    };
    place();
    const observer = new ResizeObserver(place); observer.observe(panel.current);
    return () => observer.disconnect();
  }, [hint]);
  return hint && createPortal(<div ref={panel} id={id} role="tooltip" data-glass-frame="hint" data-interaction-hint="" className={`${styles.tooltip} ${styles.interactionHint}`} style={position}>{hint.text}</div>, document.body);
}
