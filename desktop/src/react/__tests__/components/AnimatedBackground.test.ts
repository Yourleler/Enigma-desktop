// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { installAnimatedBackground } from '../../ui/AnimatedBackground';
const mock = vi.hoisted(() => ({draw:vi.fn(),dispose:vi.fn(),available:true}));
vi.mock('../../ui/background-painter',()=>({createBackgroundPainter:()=>mock.available?{draw:mock.draw,dispose:mock.dispose}:undefined}));
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose=undefined;vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();document.body.className='';for(const key of ['enigmaTone','darkBackground','lightBackground','backgroundReady'])delete document.body.dataset[key]; });
function setup(reducedMotion=false) {
  vi.useFakeTimers();mock.draw.mockClear();mock.dispose.mockClear();mock.available=true;
  const pending=new Map<number,FrameRequestCallback>();let id=0;
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{pending.set(++id,callback);return id});
  vi.stubGlobal('cancelAnimationFrame',(key:number)=>pending.delete(key));
  const media=new EventTarget();Object.assign(media,{matches:reducedMotion});vi.stubGlobal('matchMedia',()=>media);
  vi.spyOn(document,'hidden','get').mockReturnValue(false);
  document.body.dataset.enigmaTone='dark';
  const host=document.createElement('div');dispose=installAnimatedBackground(host);
  const step=(at:number)=>{const callbacks=[...pending.values()];pending.clear();callbacks.forEach(callback=>callback(at));};
  return {host,pending,step};
}
it('bounds GPU cadence and pauses without clearing the last visible frame',()=>{
  const {host,step,pending}=setup();step(100);const count=mock.draw.mock.calls.length;
  step(108);step(116);expect(mock.draw).toHaveBeenCalledTimes(count);
  step(150);expect(mock.draw).toHaveBeenCalledTimes(count+1);
  vi.spyOn(document,'hidden','get').mockReturnValue(true);document.dispatchEvent(new Event('visibilitychange'));
  expect(pending.size).toBe(0);expect(host.dataset.backgroundState).toBe('paused');
  expect(host.querySelector<HTMLElement>('.enigma-background-layer')!.style.opacity).toBe('1');
});
it('prepares a new scene before fading it above an opaque previous scene',async()=>{
  const {host,step}=setup();step(100);
  document.body.dataset.enigmaTone='light';document.body.dataset.lightBackground='marble';await Promise.resolve();
  const layers=host.querySelectorAll<HTMLElement>('.enigma-background-layer');
  expect(mock.draw.mock.calls.at(-1)?.[0]).toBe('marble');
  expect(layers[0].style.opacity).toBe('1');expect(layers[1].style.opacity).toBe('0');
  expect(document.body.dataset.backgroundReady).toBe('managed');
  step(150);expect(layers[1].style.opacity).toBe('1');expect(layers[0].style.opacity).toBe('1');
  await vi.advanceTimersByTimeAsync(400);expect(layers[0].style.opacity).toBe('0');
});
it('coalesces rapid theme/background changes without repainting a visible old layer',async()=>{
  const {host,step}=setup();step(100);
  document.body.dataset.enigmaTone='light';document.body.dataset.lightBackground='marble';await Promise.resolve();step(150);
  document.body.dataset.lightBackground='solid';await Promise.resolve();
  document.body.dataset.enigmaTone='dark';document.body.dataset.darkBackground='halo';await Promise.resolve();
  expect(host.dataset.backgroundScene).toBe('marble');
  await vi.advanceTimersByTimeAsync(400);step(600);expect(host.dataset.backgroundScene).toBe('halo');
  expect(document.body.dataset.backgroundReady).toBe('managed');
});
it('shows solid day/night without a repaint loop and retains glass settings',async()=>{
  const {host,step,pending}=setup(true);step(100);
  document.body.dataset.darkBackground='solid';await Promise.resolve();step(150);
  expect(host.dataset.backgroundScene).toBe('solid-dark');expect(pending.size).toBe(0);
  document.body.dataset.enigmaTone='light';document.body.dataset.lightBackground='solid';await Promise.resolve();step(200);
  expect(host.dataset.backgroundScene).toBe('solid-light');expect(pending.size).toBe(0);
  expect(document.body.classList.contains('enigma-glass-off')).toBe(false);
});
it('holds the scene when motion is disabled and keeps fallback visible without WebGL',async()=>{
  const {host,step,pending}=setup();step(100);
  document.body.classList.add('enigma-motion-off');await Promise.resolve();expect(pending.size).toBe(0);expect(host.dataset.backgroundState).toBe('still');
  dispose?.();dispose=undefined;mock.available=false;
  const next=document.createElement('div');dispose=installAnimatedBackground(next);step(150);
  expect(next.querySelector<HTMLElement>('.enigma-background-layer')!.dataset.rendering).toBe('fallback');
  expect(document.body.dataset.backgroundReady).toBe('managed');expect(pending.size).toBe(0);
});
