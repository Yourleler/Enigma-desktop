import { useEffect, useRef, useState } from 'react';

/** Interpolate only between received measurements, never invent continued output. */
export function useAnimatedNumber(value: number, identity: string, animate: boolean) {
  const [shown, setShown] = useState(value);
  const current = useRef(value), previousIdentity = useRef(identity);
  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.body.classList.contains('enigma-motion-off');
    if (!animate || reduced || identity !== previousIdentity.current) {
      previousIdentity.current = identity; current.current = value; setShown(value); return;
    }
    const from = current.current, started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now-started)/260);
      const next = Math.round(from + (value-from)*(1-Math.pow(1-p,3)));
      current.current=next;setShown(next);
      if(p<1)frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);
    return()=>cancelAnimationFrame(frame);
  },[value,identity,animate]);
  return shown;
}
