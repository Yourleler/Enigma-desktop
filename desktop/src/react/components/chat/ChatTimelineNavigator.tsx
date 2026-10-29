import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { ConversationRail } from './ConversationRail';
import styles from './Chat.module.css';
import type { TimelineAnchor } from './timeline-anchors';

interface MarkerLayout {
  targetTop: number;
  offsetTop: number;
}

interface Props {
  anchors: TimelineAnchor[];
  scrollRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  messageElementsRef: RefObject<Map<string, HTMLDivElement>>;
  active: boolean;
  railVisible: boolean;
  onBeforeJump?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  onFind?: () => void;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function layoutsEqual(
  a: Record<string, MarkerLayout>,
  b: Record<string, MarkerLayout>,
): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    const layoutA = a[key];
    const layoutB = b[key];
    if (!layoutB) return false;
    if (layoutA.targetTop !== layoutB.targetTop || layoutA.offsetTop !== layoutB.offsetTop) return false;
  }
  return true;
}

export const ChatTimelineNavigator = memo(function ChatTimelineNavigator({
  anchors,
  scrollRef,
  contentRef,
  messageElementsRef,
  active,
  onBeforeJump,
  hasMore,
  loadingMore,
  onLoadMore,
  onFind,
}: Props) {
  const [layouts, setLayouts] = useState<Record<string, MarkerLayout>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const measureRafRef = useRef<number | null>(null);
  const shouldMeasure = active && anchors.length > 0;

  const measure = useCallback(() => {
    const panel = scrollRef.current;
    if (!panel || anchors.length === 0) {
      setLayouts(prev => (Object.keys(prev).length === 0 ? prev : {}));
      setActiveId(null);
      return;
    }

    const maxScroll = Math.max(0, finiteNumber(panel.scrollHeight) - finiteNumber(panel.clientHeight));
    const panelRect = panel.getBoundingClientRect();
    const panelTop = finiteNumber(panelRect.top);
    const panelScrollTop = finiteNumber(panel.scrollTop);
    const next: Record<string, MarkerLayout> = {};

    for (const anchor of anchors) {
      const element = messageElementsRef.current?.get(anchor.messageId);
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      const targetTop = clamp(panelScrollTop + finiteNumber(rect.top) - panelTop - 16, 0, maxScroll);
      next[anchor.messageId] = {
        targetTop,
        offsetTop: panelScrollTop + finiteNumber(rect.top) - panelTop - 16,
      };
    }

    setLayouts(prev => (layoutsEqual(prev, next) ? prev : next));
  }, [anchors, messageElementsRef, scrollRef]);

  const updateActive = useCallback(() => {
    const panel = scrollRef.current;
    if (!panel || anchors.length === 0) {
      setActiveId(null);
      return;
    }

    const threshold = finiteNumber(panel.scrollTop) + 96;
    const maxScroll = Math.max(0, finiteNumber(panel.scrollHeight) - finiteNumber(panel.clientHeight));
    // The final prompt may never reach the top in a short last turn. At the
    // bottom, mark the latest turn instead of an earlier off-screen question.
    if (maxScroll > 1 && finiteNumber(panel.scrollTop) >= maxScroll - 2) {
      setActiveId(anchors.at(-1)?.messageId ?? null);
      return;
    }
    let nextId = anchors[0]?.messageId ?? null;
    for (const anchor of anchors) {
      const layout = layouts[anchor.messageId];
      if (!layout) continue;
      if (layout.offsetTop <= threshold) {
        nextId = anchor.messageId;
      } else {
        break;
      }
    }
    setActiveId(nextId);
  }, [anchors, layouts, scrollRef]);

  useLayoutEffect(() => {
    if (!shouldMeasure) {
      setLayouts(prev => (Object.keys(prev).length === 0 ? prev : {}));
      setActiveId(null);
      return;
    }
    measure();
  }, [measure, shouldMeasure]);

  useEffect(() => {
    const panel = scrollRef.current;
    if (!panel || !shouldMeasure) return;
    const content = contentRef.current;
    const observer = new ResizeObserver(() => {
      if (measureRafRef.current != null) return;
      measureRafRef.current = window.requestAnimationFrame(() => {
        measureRafRef.current = null;
        measure();
      });
    });
    observer.observe(panel);
    if (content) observer.observe(content);
    return () => {
      observer.disconnect();
      if (measureRafRef.current != null) {
        window.cancelAnimationFrame(measureRafRef.current);
        measureRafRef.current = null;
      }
    };
  }, [contentRef, measure, scrollRef, shouldMeasure]);

  useEffect(() => {
    const panel = scrollRef.current;
    if (!panel || !shouldMeasure) return;

    const schedule = () => {
      if (rafRef.current != null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        updateActive();
      });
    };

    updateActive();
    panel.addEventListener('scroll', schedule, { passive: true });
    return () => {
      panel.removeEventListener('scroll', schedule);
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [scrollRef, shouldMeasure, updateActive]);

  const jumpTo = useCallback((anchor: TimelineAnchor) => {
    const panel = scrollRef.current;
    const layout = layouts[anchor.messageId];
    if (!panel || !layout) return;
    onBeforeJump?.();
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    panel.scrollTo({ top: layout.targetTop, behavior: reduced ? 'auto' : 'smooth' });
    const target = messageElementsRef.current?.get(anchor.messageId);
    if (target) {
      target.classList.remove(styles.locateFlash);
      void target.offsetWidth;
      target.classList.add(styles.locateFlash);
    }
    setActiveId(anchor.messageId);
  }, [layouts, scrollRef, onBeforeJump, messageElementsRef]);

  const renderedAnchors = useMemo(
    () => anchors.filter(anchor => layouts[anchor.messageId]),
    [anchors, layouts],
  );

  if (!active || anchors.length === 0) return null;

  return (
    <ConversationRail
      anchors={renderedAnchors}
      activeId={activeId}
      onJump={jumpTo}
      hasMore={hasMore}
      loadingMore={loadingMore}
      onLoadMore={onLoadMore}
      onFind={onFind}
    />
  );
});
