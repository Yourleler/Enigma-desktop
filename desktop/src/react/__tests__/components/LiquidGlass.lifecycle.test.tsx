// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LiquidGlass } from '../../ui/LiquidGlass';

let observe: ReturnType<typeof vi.fn>, unobserve: ReturnType<typeof vi.fn>;
beforeEach(() => {
  observe = vi.fn(); unobserve = vi.fn();
  vi.stubGlobal('ResizeObserver', class { observe = observe; unobserve = unobserve; disconnect = vi.fn(); });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

it('attaches and detaches material when React reuses a node between welcome and task views', async () => {
  const reused = document.createElement('div'); reused.className = 'enigma-new-task-settings'; document.body.append(reused);
  render(<LiquidGlass />);
  expect(reused).not.toHaveAttribute('data-liquid-surface');
  await act(async () => { reused.className = 'enigma-toolbar enigma-surface-card'; });
  expect(reused).toHaveAttribute('data-liquid-surface'); expect(observe).toHaveBeenCalledWith(reused);
  await act(async () => { reused.className = 'enigma-new-task-settings'; });
  expect(reused).not.toHaveAttribute('data-liquid-surface'); expect(unobserve).toHaveBeenCalledWith(reused);
  await act(async () => { reused.setAttribute('data-liquid',''); });
  expect(reused).toHaveAttribute('data-liquid-surface');
});

it('releases detached popovers and does not observe its own material attributes', async () => {
  render(<LiquidGlass />);
  const popover = document.createElement('div'); popover.className = 'enigma-token-popover';
  await act(async () => { document.body.append(popover); });
  expect(observe).toHaveBeenCalledTimes(1);
  await act(async () => { popover.setAttribute('data-liquid-refraction','ready'); popover.style.setProperty('--liquid-refraction','none'); });
  expect(observe).toHaveBeenCalledTimes(1);
  await act(async () => { popover.remove(); });
  expect(unobserve).toHaveBeenCalledWith(popover);
});

it('coalesces pointer light updates, keeps content stationary, and respects reduced motion',async()=>{
 let callback:FrameRequestCallback|undefined;const request=vi.fn((cb:FrameRequestCallback)=>{callback=cb;return 11;});vi.stubGlobal('requestAnimationFrame',request);vi.stubGlobal('cancelAnimationFrame',vi.fn());const preference={matches:false};vi.stubGlobal('matchMedia',()=>preference);
 const surface=document.createElement('div');surface.dataset.liquid='composer';document.body.append(surface);surface.getBoundingClientRect=()=>({left:10,top:20,width:200,height:100} as DOMRect);const {unmount}=render(<LiquidGlass/>);
 const move=(x:number,y:number)=>surface.dispatchEvent(new MouseEvent('pointermove',{bubbles:true,clientX:x,clientY:y}));move(30,40);move(160,80);expect(request).toHaveBeenCalledTimes(1);await act(async()=>callback?.(16));expect(parseFloat(surface.style.getPropertyValue('--glass-pointer-x'))).toBeLessThan(75);expect(surface.style.transform).toBe('');
 for(let i=2;i<30;i++){const next=callback;callback=undefined;await act(async()=>next?.(i*16));}
 expect(surface.style.getPropertyValue('--glass-pointer-x')).toBe('75.00%');expect(surface.style.getPropertyValue('--glass-pointer-y')).toBe('60.00%');expect(callback).toBeUndefined();
 const frames=request.mock.calls.length;preference.matches=true;move(40,50);expect(surface.hasAttribute('data-liquid-active')).toBe(false);expect(surface.style.getPropertyValue('--glass-light-opacity')).toBe('0');expect(surface.style.getPropertyValue('--glass-pointer-x')).toBe('75.00%');unmount();move(50,60);expect(request).toHaveBeenCalledTimes(frames);
});
