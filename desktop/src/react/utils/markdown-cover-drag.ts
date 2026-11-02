import type { MarkdownCoverLayoutPatch } from './markdown-cover';
export type CoverLayout = Required<MarkdownCoverLayoutPatch>;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Preview-only until pointer-up. Cancellation never mutates document or disk. */
export function beginMarkdownCoverDrag(event: PointerEvent, options: {
  kind: 'height' | 'position'; layout: CoverLayout; window?: Window;
  preview: (layout: CoverLayout) => void; commit: (layout: CoverLayout) => void;
  end?: () => void;
}): () => void {
  if (event.button !== 0) return () => { };
  event.preventDefault(); event.stopPropagation();
  const win = options.window || window, start = { ...options.layout }; let latest = start, active = true;
  const matches = (next: PointerEvent) => event.pointerId === undefined || next.pointerId === undefined || event.pointerId === next.pointerId;
  const cleanup = () => { win.removeEventListener('pointermove', move); win.removeEventListener('pointerup', finish); win.removeEventListener('pointercancel', pointerCancel); win.removeEventListener('blur', cancel); win.removeEventListener('keydown', key); };
  const cancel = () => { if (!active) return; active = false; cleanup(); options.end?.(); options.preview(start); };
  const move = (next: PointerEvent) => { if (!active || !matches(next)) return; const dy = next.clientY - event.clientY; if (!Number.isFinite(dy)) return; latest = { ...start, ...(options.kind === 'height' ? { displayHeight: clamp(start.displayHeight + dy, 160, 720) } : { positionY: clamp(start.positionY - dy / Math.max(1, start.displayHeight) * 100, 0, 100) }) }; options.preview(latest); };
  const finish = (next: PointerEvent) => { if (!active || !matches(next)) return; active = false; cleanup(); options.end?.(); if (latest.displayHeight !== start.displayHeight || latest.positionY !== start.positionY) options.commit(latest); };
  const pointerCancel = (next: PointerEvent) => { if (matches(next)) cancel(); };
  const key = (next: KeyboardEvent) => { if (next.key === 'Escape') { next.preventDefault(); next.stopPropagation(); next.stopImmediatePropagation(); cancel(); } };
  win.addEventListener('pointermove', move); win.addEventListener('pointerup', finish); win.addEventListener('pointercancel', pointerCancel); win.addEventListener('blur', cancel); win.addEventListener('keydown', key);
  return cancel;
}
