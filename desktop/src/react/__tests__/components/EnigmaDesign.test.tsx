// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EnigmaDesign } from '../../ui/EnigmaDesign';
import { AUTO_DARK_DEFAULT, AUTO_LIGHT_DEFAULT } from '../../../shared/theme-registry';

beforeEach(() => { localStorage.clear(); document.body.className = ''; document.documentElement.removeAttribute('data-theme'); vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('adapts the shared palette when the host changes theme', async () => {
  document.body.classList.add('paper-texture');
  document.documentElement.setAttribute('data-theme', AUTO_LIGHT_DEFAULT);
  render(<EnigmaDesign />);
  expect(document.body.dataset.enigmaTone).toBe('light');
  expect(document.body.classList.contains('paper-texture')).toBe(false);
  await act(async () => document.documentElement.setAttribute('data-theme', AUTO_DARK_DEFAULT));
  expect(document.body.dataset.enigmaTone).toBe('dark');
});
it('uses the saved selection in standalone windows without a host theme attribute', () => {
  localStorage.setItem('hana-theme', AUTO_DARK_DEFAULT);
  render(<EnigmaDesign />);
  expect(document.body.dataset.enigmaTone).toBe('dark');
});
it('follows the OS when standalone windows use the system theme', () => {
  localStorage.setItem('hana-theme', 'auto');
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  render(<EnigmaDesign />);
  expect(document.body.dataset.enigmaTone).toBe('dark');
});
it('keeps a floating input on the shared palette without painting a rectangular window backdrop',async()=>{
  vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});
  const view=render(<EnigmaDesign surface="floating"/>);
  expect(document.body.dataset.enigmaWindow).toBe('floating');
  expect(document.querySelector('.enigma-animated-background')).toBeNull();
  expect(document.querySelector('.enigma-window-material')).toBeNull();
  expect(document.querySelector('.enigma-liquid-definitions')).not.toBeNull();
  await act(async()=>document.documentElement.setAttribute('data-theme',AUTO_DARK_DEFAULT));
  expect(document.body.dataset.enigmaTone).toBe('dark');
  expect(document.body.dataset.enigmaWindow).toBe('floating');
  view.unmount();expect(document.body.dataset.enigmaWindow).toBeUndefined();
});
