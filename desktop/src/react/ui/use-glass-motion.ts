import {visualsSuspended} from './visual-activity';
import { useEffect, useRef, type RefObject } from 'react';

/** A short optical stretch on the moving selection, without animating layout or text. */
export function useGlassMotion(ref: RefObject<HTMLElement | null>, selection: string) {
  const previous = useRef(selection);
  useEffect(() => {
    if (previous.current === selection) return;
    previous.current = selection;
    const element = ref.current;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const disabled = () => visualsSuspended() || reduced?.matches || document.body.matches('.enigma-motion-off,.enigma-glass-off');
    if (!element?.animate || disabled()) return;
    const distance = Number(element.style.getPropertyValue('--glass-travel-distance')) || 60;
    const stretch = Math.min(.12, .035 + distance / 1800);
    const vertical = element.style.getPropertyValue('--glass-travel-axis') === 'vertical';
    const animation = element.animate([
      { scale: '1 1', filter: 'brightness(1)' },
      { scale: vertical ? `${1 - stretch * .45} ${1 + stretch}` : `${1 + stretch} ${1 - stretch * .45}`, filter: 'brightness(1.09)', offset: .24 },
      { scale: vertical ? '1.01 .99' : '.99 1.01', filter: 'brightness(1.02)', offset: .7 },
      { scale: '1 1', filter: 'brightness(1)' },
    ], { duration: 420, easing: 'cubic-bezier(.2,.7,.2,1)' });
    element.dataset.glassMotion = 'running';
    const finish = () => { element.dataset.glassMotion = 'idle'; };
    animation.addEventListener('finish', finish);
    const cancel = () => { if (disabled()) { animation.cancel(); finish(); } };
    reduced?.addEventListener('change', cancel);
    const observer = new MutationObserver(cancel);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class','data-enigma-visual-activity'] });
    return () => { animation.cancel(); finish(); observer.disconnect(); reduced?.removeEventListener('change', cancel); };
  }, [selection, ref]);
}
