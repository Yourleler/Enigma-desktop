// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GlassSelection } from '../../ui/GlassSelection';

let resize: ResizeObserverCallback | undefined;
let secondWidth = 90;
beforeEach(() => {
  secondWidth = 90;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('ResizeObserver', class { constructor(cb: ResizeObserverCallback) { resize = cb; } observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    const slot = this.getAttribute('data-slot');
    return { left: slot === 'b' ? 190 : 100, top: slot ? 25 : 20, width: slot === 'b' ? secondWidth : slot ? 80 : 200, height: slot ? 30 : 40 } as DOMRect;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function Group({ value, second = true }: { value: string; second?: boolean }) {
  return <div data-glass-segmented=""><GlassSelection selection={value}/><button data-slot="a" aria-pressed={value === 'a'}>第一项</button>{second && <button data-slot="b" aria-pressed={value === 'b'}>第二项</button>}</div>;
}
it('moves the same lens from the old option to the new option without leaving transition disabled', () => {
  const view = render(<Group value="a"/>);
  const lens = view.container.querySelector<HTMLElement>('[data-glass-selection]')!;
  expect(lens.style.transform).toBe('translate3d(0px,5px,0)');
  expect(lens.style.width).toBe('80px');
  view.rerender(<Group value="b"/>);
  expect(view.container.querySelector('[data-glass-selection]')).toBe(lens);
  expect(lens.style.transform).toBe('translate3d(90px,5px,0)');
  expect(lens.style.width).toBe('90px');
  expect(lens.style.transition).toBe('');
  secondWidth = 110; resize?.([], {} as ResizeObserver);
  expect(lens.style.width).toBe('110px');
});
it('hides a missing selection rather than showing the wrong option, and restores it on return', () => {
  const view = render(<Group value="a"/>);
  const lens = view.container.querySelector<HTMLElement>('[data-glass-selection]')!;
  view.rerender(<Group value="missing"/>); expect(lens.style.opacity).toBe('0');
  view.rerender(<Group value="b"/>); expect(lens.style.opacity).toBe('1');
  expect(lens.style.transform).toBe('translate3d(90px,5px,0)');
});
