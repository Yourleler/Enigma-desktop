// @vitest-environment jsdom
import { useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useGlassMotion } from '../../ui/use-glass-motion';

function Selection({ value }: { value: string }) { const ref = useRef<HTMLDivElement>(null); useGlassMotion(ref, value); return <div ref={ref}/>; }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.className = ''; });
it('animates only selection changes and cancels immediately when motion is turned off', async () => {
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel, addEventListener: vi.fn() }));
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const view = render(<Selection value="first"/>); expect(animate).not.toHaveBeenCalled();
  view.rerender(<Selection value="second"/>); expect(animate).toHaveBeenCalledTimes(1);
  await act(async () => { document.body.classList.add('enigma-motion-off'); }); expect(cancel).toHaveBeenCalled();
  view.rerender(<Selection value="third"/>); expect(animate).toHaveBeenCalledTimes(1);
  Reflect.deleteProperty(HTMLElement.prototype, 'animate');
});
