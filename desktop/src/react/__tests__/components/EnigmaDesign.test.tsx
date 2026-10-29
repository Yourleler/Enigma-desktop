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
