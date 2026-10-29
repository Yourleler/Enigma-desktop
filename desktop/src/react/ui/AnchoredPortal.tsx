import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type AnchoredPortalAlign = 'start' | 'end';

interface AnchoredPortalProps {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  className?: string;
  align?: AnchoredPortalAlign;
  offset?: number;
  minWidth?: number;
  viewportPadding?: number;
  onClose?: () => void;
  role?: string;
  ariaLabel?: string;
  focusOnOpen?: boolean;
}

const TOP_LAYER_Z_INDEX = 9999;

export function AnchoredPortal({
  open,
  anchorRef,
  children,
  className,
  align = 'end',
  offset = 6,
  minWidth,
  viewportPadding = 4,
  onClose,
  role,
  ariaLabel,
  focusOnOpen=false,
}: AnchoredPortalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({
    position: 'fixed',
    left: 0,
    top: 0,
    zIndex: TOP_LAYER_Z_INDEX,
    visibility: 'hidden',
  });

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;

    const anchorRect = anchor.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const panelWidth = panelRect.width || minWidth || anchorRect.width;
    const panelHeight = panelRect.height || 0;
    const maxLeft = Math.max(viewportPadding, window.innerWidth - panelWidth - viewportPadding);
    const preferredLeft = align === 'end'
      ? anchorRect.right - panelWidth
      : anchorRect.left;
    const left = Math.min(Math.max(preferredLeft, viewportPadding), maxLeft);
    const spaceBelow = window.innerHeight - anchorRect.bottom - viewportPadding;
    const spaceAbove = anchorRect.top - viewportPadding;
    const openAbove = spaceBelow < panelHeight + offset && spaceAbove > spaceBelow;
    const preferredTop = openAbove
      ? Math.max(viewportPadding, anchorRect.top - panelHeight - offset)
      : Math.min(anchorRect.bottom + offset, window.innerHeight - viewportPadding);
    const top = Math.max(viewportPadding, Math.min(preferredTop, window.innerHeight-panelHeight-viewportPadding));

    setStyle({
      position: 'fixed',
      left,
      top,
      zIndex: TOP_LAYER_Z_INDEX,
      minWidth,
      maxHeight: Math.max(80, window.innerHeight-viewportPadding*2),
      visibility: 'visible',
    });
  }, [align, anchorRef, minWidth, offset, viewportPadding]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition, children]);
  useEffect(()=>{if(open&&focusOnOpen&&style.visibility==='visible')panelRef.current?.querySelector<HTMLElement>('button,input,select,textarea,[tabindex="0"]')?.focus();},[open,focusOnOpen,style.visibility]);

  useEffect(() => {
    if (!open) return;
    const handleWindowChange = () => updatePosition();
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(handleWindowChange);
    if (panelRef.current) resize?.observe(panelRef.current);
    window.addEventListener('resize', handleWindowChange);
    window.addEventListener('scroll', handleWindowChange, true);
    return () => {
      resize?.disconnect();
      window.removeEventListener('resize', handleWindowChange);
      window.removeEventListener('scroll', handleWindowChange, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open || !onClose) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-select-widget-popup]') && panelRef.current?.querySelector('[data-select-widget-trigger][aria-expanded="true"]')) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (panelRef.current?.querySelector('[data-select-widget-trigger][aria-expanded="true"]')) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [anchorRef, onClose, open]);

  if (!open) return null;

  return createPortal(
    <div ref={panelRef} className={className} style={style} role={role} aria-label={ariaLabel} data-liquid="menu" data-menu-surface="" data-menu-position="fixed" data-native-browser-occluder="">
      {children}
    </div>,
    document.body,
  );
}
