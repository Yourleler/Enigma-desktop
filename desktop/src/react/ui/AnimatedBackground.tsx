import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { createBackgroundPainter, type PaintedBackground } from './background-painter';

type Scene = PaintedBackground | 'halo' | 'ribbon' | 'solid-dark' | 'solid-light';
const isPainted = (scene: Scene): scene is PaintedBackground => scene === 'aurora' || scene === 'marble';

/** Prepare the next scene before revealing it; never clear a visible layer. */
export function AnimatedBackground() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current ? installAnimatedBackground(ref.current) : undefined, []);
  return createPortal(<div ref={ref} className="enigma-animated-background enigma-background-stage" aria-hidden="true" />, document.body);
}

export function installAnimatedBackground(host: HTMLElement): () => void {
  const layers = [0, 1].map(() => {
    const element = document.createElement('div'); element.className = 'enigma-background-layer';
    const canvas = document.createElement('canvas'); element.append(canvas); host.append(element);
    return {element, canvas, painter: undefined as ReturnType<typeof createBackgroundPainter>, scene: 'solid-light' as Scene};
  });
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const audit = new URLSearchParams(location.search).has('enigma_perf');
  let active = -1, frame = 0, reveal = 0, previous = 0, elapsed = 8;
  let wake: ReturnType<typeof setTimeout> | undefined;
  let focused = document.hasFocus();
  let moving = false, transitioning = false, transitionTimer: ReturnType<typeof setTimeout> | undefined;
  const requestedScene = (): Scene => {
    const dark = document.body.dataset.enigmaTone === 'dark';
    const choice = dark ? document.body.dataset.darkBackground : document.body.dataset.lightBackground;
    return choice === 'solid' ? dark ? 'solid-dark' : 'solid-light' : dark ? choice === 'halo' ? 'halo' : 'aurora' : choice === 'marble' ? 'marble' : 'ribbon';
  };
  const draw = (index: number) => {
    const layer = layers[index];
    if (!isPainted(layer.scene)) return;
    layer.painter ??= createBackgroundPainter(layer.canvas);
    if (!layer.painter) { layer.canvas.style.opacity = '0'; layer.element.dataset.rendering = 'fallback'; return; }
    const scale = Math.min(1, Math.sqrt(420000 / (innerWidth * innerHeight)));
    layer.painter.draw(layer.scene, Math.max(1, Math.round(innerWidth * scale)), Math.max(1, Math.round(innerHeight * scale)), elapsed);
    layer.canvas.style.opacity = '1';
    layer.element.dataset.rendering = 'gpu';
    if (audit) host.dataset.backgroundTime = elapsed.toFixed(2);
  };
  const tick = (at: number) => {
    frame = 0;
    if (document.hidden || !moving || active < 0 || !isPainted(layers[active].scene)) return;
    const interval = 1000 / (focused ? 24 : 12);
    if (!previous || at - previous >= interval) {
      if (previous) elapsed += Math.min((at - previous) / 1000, .1);
      previous = at; draw(active);
    }
    // Do not wake JavaScript at the display's 60–120 Hz just to skip frames.
    wake = setTimeout(() => { wake=undefined; frame=requestAnimationFrame(tick); }, Math.max(0, interval - Math.max(0, performance.now()-at) - 2));
  };
  const schedule = () => {
    cancelAnimationFrame(frame); clearTimeout(wake); wake=undefined; previous = 0;
    const animated = active >= 0 && isPainted(layers[active].scene) && !!layers[active].painter;
    host.dataset.backgroundState = document.hidden ? 'paused' : moving && animated ? 'running' : 'still';
    if (!document.hidden && moving && animated) frame = requestAnimationFrame(tick);
  };
  const sync = () => {
    const wasMoving = moving;
    moving = !reduced.matches && !document.body.classList.contains('enigma-motion-off');
    host.dataset.motion = moving ? 'on' : 'off';
    if (document.hidden) { cancelAnimationFrame(frame);clearTimeout(wake);wake=undefined; frame = 0; host.dataset.backgroundState = 'paused'; return; }
    if (transitioning && moving) return;
    if (transitioning) { clearTimeout(transitionTimer); transitioning = false; }
    const scene = requestedScene();
    if (active >= 0 && layers[active].scene === scene) {
      if (wasMoving !== moving || host.dataset.backgroundState === 'paused') { draw(active); schedule(); }
      return;
    }
    const next = active === 0 ? 1 : 0, old = active;
    const layer = layers[next]; layer.scene = scene; layer.element.dataset.scene = scene;
    layer.canvas.style.display = isPainted(scene) ? 'block' : 'none';
    layer.element.style.transition = 'none'; layer.element.style.opacity = '0';
    draw(next);
    void layer.element.offsetWidth;
    active = next; host.dataset.backgroundScene = scene;
    layer.element.style.zIndex = '1';
    if (old >= 0) layers[old].element.style.zIndex = '0';
    const show = () => {
      layer.element.style.transition = ''; layer.element.style.opacity = '1';
    };
    cancelAnimationFrame(reveal);
    if (old < 0 || !moving) {
      layer.element.style.opacity = '1';
      if (old >= 0) layers[old].element.style.opacity = '0';
      reveal = requestAnimationFrame(() => { layer.element.style.transition = ''; });
    } else {
      transitioning = true;
      reveal = requestAnimationFrame(() => {
        show();
        transitionTimer = setTimeout(() => { layers[old].element.style.opacity = '0'; transitioning = false; sync(); }, 380);
      });
    }
    document.body.dataset.backgroundReady = 'managed';
    schedule();
  };
  const resize = () => { if (active >= 0 && !document.hidden) draw(active); };
  const focusChanged = () => { focused=document.hasFocus();schedule(); };
  const contextCleanups = layers.map((layer, index) => {
    const lost = (event: Event) => { event.preventDefault(); layer.painter = undefined; layer.canvas.style.opacity = '0'; layer.element.dataset.rendering = 'fallback'; if (index === active) schedule(); };
    const restored = () => { if (index === active) { draw(index); schedule(); } };
    layer.canvas.addEventListener('webglcontextlost', lost); layer.canvas.addEventListener('webglcontextrestored', restored);
    return () => { layer.canvas.removeEventListener('webglcontextlost', lost); layer.canvas.removeEventListener('webglcontextrestored', restored); };
  });
  const observer = new MutationObserver(sync);
  observer.observe(document.body, {attributes:true, attributeFilter:['data-enigma-tone','data-dark-background','data-light-background','class']});
  document.addEventListener('visibilitychange', sync); reduced.addEventListener('change', sync); window.addEventListener('resize', resize);
  window.addEventListener('focus',focusChanged);window.addEventListener('blur',focusChanged);
  sync();
  return () => {
    cancelAnimationFrame(frame); cancelAnimationFrame(reveal); clearTimeout(wake); clearTimeout(transitionTimer); observer.disconnect();
    document.removeEventListener('visibilitychange', sync); reduced.removeEventListener('change', sync); window.removeEventListener('resize', resize);
    window.removeEventListener('focus',focusChanged);window.removeEventListener('blur',focusChanged);
    contextCleanups.forEach(cleanup => cleanup()); layers.forEach(layer => { layer.painter?.dispose(true); layer.element.remove(); });
    delete document.body.dataset.backgroundReady;
  };
}
