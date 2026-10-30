import { useId, useLayoutEffect, useRef } from 'react';
import { useGlassMotion } from './use-glass-motion';
import './GlassSelection.css';

/** One persistent lens per group. Only its geometry moves; labels stay still. */
export function GlassSelection({ selection, selector = '[aria-selected="true"], [aria-pressed="true"]', layoutCoordinates = false }: { selection: string; selector?: string; layoutCoordinates?:boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const positioned = useRef(false);
  const previousPosition = useRef<{ x: number; y: number } | null>(null);
  const id = useId();
  useGlassMotion(ref, selection);
  useLayoutEffect(() => {
    const lens = ref.current, group = lens?.parentElement;
    if (!lens || !group) return;
    let frame = 0;
    const place = () => {
      const active = group.querySelector<HTMLElement>(selector);
      const bounds = active?.getBoundingClientRect();
      if (!active || !bounds?.width || !bounds.height) { lens.style.opacity = '0'; return; }
      const parent = group.getBoundingClientRect();
      const nextX = layoutCoordinates ? active.offsetLeft : bounds.left - parent.left + group.scrollLeft - group.clientLeft;
      const nextY = layoutCoordinates ? active.offsetTop : bounds.top - parent.top + group.scrollTop - group.clientTop;
      const previous = previousPosition.current;
      const dx = previous ? nextX - previous.x : 0, dy = previous ? nextY - previous.y : 0;
      if (dx || dy) {
        lens.style.setProperty('--glass-travel-distance', String(Math.hypot(dx, dy)));
        lens.style.setProperty('--glass-travel-axis', Math.abs(dy) > Math.abs(dx) ? 'vertical' : 'horizontal');
      }
      previousPosition.current = { x: nextX, y: nextY };
      if (!positioned.current) lens.style.transition = 'none';
      lens.style.width = `${layoutCoordinates ? active.offsetWidth : bounds.width}px`;
      lens.style.height = `${layoutCoordinates ? active.offsetHeight : bounds.height}px`;
      lens.style.transform = `translate3d(${nextX}px,${nextY}px,0)`;
      lens.style.borderRadius = getComputedStyle(active).borderRadius || '10px';
      lens.style.opacity = '1';
      if (!positioned.current) {
        positioned.current = true;
        // Commit the initial position, then animate subsequent selections.
        void lens.offsetWidth;
        frame = requestAnimationFrame(() => { lens.style.transition = ''; });
      }
    };
    place();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    observer?.observe(group);
    const active = group.querySelector<HTMLElement>(selector);
    if (active) observer?.observe(active);
    window.addEventListener('resize', place);
    return () => { cancelAnimationFrame(frame); lens.style.transition = ''; observer?.disconnect(); window.removeEventListener('resize', place); };
  }, [selection, selector, layoutCoordinates]);
  return <div id={id} ref={ref} className="enigma-glass-selection" data-glass-selection="" aria-hidden="true"/>;
}
