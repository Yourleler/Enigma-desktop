import { useLayoutEffect, useState } from 'react';

/** Retain fixed positioning during exit; stage entry before the first paint. */
export function usePanelExit(open: boolean) {
  const [retained, setRetained] = useState(open);
  const [entering, setEntering] = useState(open);
  useLayoutEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.body.classList.contains('enigma-motion-off');
    let first=0, second=0;
    if (open) {
      setRetained(true); setEntering(!reduced);
      first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>setEntering(false));});
      return()=>{cancelAnimationFrame(first);cancelAnimationFrame(second);};
    }
    setEntering(false);
    const timer=window.setTimeout(()=>setRetained(false),reduced?0:190);
    return()=>window.clearTimeout(timer);
  },[open]);
  return {floating:open||retained,entering};
}
