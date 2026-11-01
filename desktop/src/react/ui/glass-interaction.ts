import {visualsSuspended} from './visual-activity';
/** Surface lighting and local control highlights have separate lifetimes.
 * Moving between child buttons never resets a sheet's glow to a fallback corner. */
export function installGlassInteractions() {
  const controlQuery = '[data-glass-interactive],[data-glass-controls] button';
  const surfaceQuery = '[data-liquid-surface],[data-glass-frame]';
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const disabled = () => visualsSuspended() || reduced?.matches || document.body.matches('.enigma-glass-off,.enigma-motion-off');
  type Light = { element: HTMLElement; x: number; y: number; tx: number; ty: number; previous: number; frame: number };
  let surface: Light | null = null, control: Light | null = null, pressed: HTMLElement | null = null;
  const clearLight = (light: Light | null) => {
    if (!light) return;
    cancelAnimationFrame(light.frame);
    light.element.removeAttribute('data-liquid-active');
    light.element.style.setProperty('--glass-light-opacity', '0');
    // Retain the last position while opacity fades. Removing these properties
    // here would repaint the default corner for a frame during handoff.
  };
  const clear = () => {
    clearLight(surface); clearLight(control); surface = null; control = null;
    pressed?.removeAttribute('data-liquid-pressed'); pressed = null;
  };
  const point = (element: HTMLElement, event: PointerEvent) => {
    const rect = element.getBoundingClientRect();
    return { x: Math.max(0, Math.min(100, (event.clientX - rect.left) / Math.max(1, rect.width) * 100)),
      y: Math.max(0, Math.min(100, (event.clientY - rect.top) / Math.max(1, rect.height) * 100)) };
  };
  const paint = (light: Light) => {
    light.element.style.setProperty('--glass-pointer-x', `${light.x.toFixed(2)}%`);
    light.element.style.setProperty('--glass-pointer-y', `${light.y.toFixed(2)}%`);
  };
  const tick = (light: Light, at: number) => {
    light.frame = 0;
    if (!light.element.isConnected || disabled()) { clear(); return; }
    const dt = light.previous ? Math.min(40, Math.max(1, at - light.previous)) : 16;
    light.previous = at;
    const blend = 1 - Math.exp(-dt / 45);
    light.x += (light.tx - light.x) * blend; light.y += (light.ty - light.y) * blend;
    if (Math.abs(light.tx - light.x) + Math.abs(light.ty - light.y) < .12) { light.x = light.tx; light.y = light.ty; }
    paint(light);
    if (light.x !== light.tx || light.y !== light.ty) light.frame = requestAnimationFrame(time => tick(light, time));
    else light.previous = 0;
  };
  const track = (previous: Light | null, element: HTMLElement | null, event: PointerEvent): Light | null => {
    if (!element) { clearLight(previous); return null; }
    const position = point(element, event);
    let light = previous;
    if (light?.element !== element) {
      clearLight(light);
      light = { element, ...position, tx: position.x, ty: position.y, previous: 0, frame: 0 };
      paint(light); // Set coordinates before enabling the glow, never at 28%/8%.
      element.style.setProperty('--glass-light-opacity', '1');
      element.dataset.liquidActive = '';
    }
    light.tx = position.x; light.ty = position.y;
    if (!light.frame && (light.x !== light.tx || light.y !== light.ty)) light.frame = requestAnimationFrame(time => tick(light, time));
    return light;
  };
  const move = (event: PointerEvent) => {
    if (disabled()) { clear(); return; }
    const node = event.target instanceof Element ? event.target : null;
    const isDisabled = !!node?.closest('button:disabled,[aria-disabled="true"]');
    // Frames stay lit even when hovering a disabled child; that child itself
    // receives no press or highlight treatment.
    const frame = node?.closest<HTMLElement>('[data-glass-frame]') || null;
    const background = frame || (!isDisabled ? node?.closest<HTMLElement>(surfaceQuery) || null : null);
    const button = !isDisabled ? node?.closest<HTMLElement>(controlQuery) || null : null;
    surface = track(surface, background, event);
    control = track(control, button === background ? null : button, event);
  };
  const release = () => { pressed?.removeAttribute('data-liquid-pressed'); pressed = null; };
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || disabled()) return;
    move(event);
    const target = control?.element || surface?.element;
    if (target?.matches('button,[role="button"],[role="switch"]')) { pressed = target; pressed.dataset.liquidPressed = ''; }
  };
  const preference = () => { if (disabled()) clear(); };
  const observer = new MutationObserver(preference);
  observer.observe(document.body, { attributes: true, attributeFilter: ['class','data-enigma-visual-activity'] });
  document.addEventListener('pointermove', move, { passive: true });
  document.addEventListener('pointerdown', down, { passive: true });
  document.addEventListener('pointerup', release); document.addEventListener('pointercancel', clear);
  document.addEventListener('pointerleave', clear); document.addEventListener('visibilitychange', preference);
  window.addEventListener('blur', clear); reduced?.addEventListener?.('change', preference);
  return () => {
    clear(); observer.disconnect(); reduced?.removeEventListener?.('change', preference);
    document.removeEventListener('pointermove', move); document.removeEventListener('pointerdown', down);
    document.removeEventListener('pointerup', release); document.removeEventListener('pointercancel', clear);
    document.removeEventListener('pointerleave', clear); document.removeEventListener('visibilitychange', preference);
    window.removeEventListener('blur', clear);
  };
}
