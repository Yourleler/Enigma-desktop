// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { BackgroundPicker } from '../../ui/BackgroundPicker';
import { applyMaterialPreferences, readMaterialPreferences, saveMaterialPreferences } from '../../ui/material-preferences';

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); document.body.className=''; });

it('preserves both background choices, glass, motion and clarity across remounts', () => {
  saveMaterialPreferences({glass:true,motion:false,tint:0});
  const view=render(<BackgroundPicker/>);
  fireEvent.click(screen.getByRole('button',{name:'光环，深色背景'}));
  fireEvent.click(screen.getByRole('button',{name:'紫色大理石，浅色背景'}));
  expect(readMaterialPreferences()).toEqual({glass:true,motion:false,tint:0,darkBackground:'halo',lightBackground:'marble'});
  view.unmount(); render(<BackgroundPicker/>);
  expect(screen.getByRole('button',{name:'光环，深色背景'}).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button',{name:'紫色大理石，浅色背景'}).getAttribute('aria-pressed')).toBe('true');
  expect(document.body.classList.contains('enigma-glass-off')).toBe(false);
});

it('keeps compact and settings pickers synchronized, including changes from another window', () => {
  render(<><div data-testid="settings"><BackgroundPicker/></div><div data-testid="menu"><BackgroundPicker tone="dark"/></div></>);
  fireEvent.click(within(screen.getByTestId('menu')).getByRole('button',{name:'光环，深色背景'}));
  expect(within(screen.getByTestId('settings')).getByRole('button',{name:'光环，深色背景'}).getAttribute('aria-pressed')).toBe('true');
  localStorage.setItem('enigma-appearance',JSON.stringify({glass:true,motion:true,darkBackground:'aurora',lightBackground:'marble'}));
  act(()=>window.dispatchEvent(new StorageEvent('storage',{key:'enigma-appearance'})));
  expect(within(screen.getByTestId('menu')).getByRole('button',{name:'拟真极光，深色背景'}).getAttribute('aria-pressed')).toBe('true');
});

it('keeps the existing backgrounds for old or invalid preferences', () => {
  localStorage.setItem('enigma-appearance',JSON.stringify({glass:true,motion:false,tint:0,darkBackground:'bad',lightBackground:'aurora'}));
  const prefs=readMaterialPreferences(); applyMaterialPreferences(prefs);
  expect(document.body.dataset.darkBackground).toBe('aurora'); expect(document.body.dataset.lightBackground).toBe('ribbon');
  expect(prefs).toEqual({glass:true,motion:false,tint:0});
});

it('persists independent solid choices without switching theme or disabling glass',()=>{
  document.body.dataset.enigmaTone='dark';saveMaterialPreferences({glass:true,motion:true,tint:75,darkBackground:'halo',lightBackground:'marble'});
  render(<BackgroundPicker/>);
  fireEvent.click(screen.getByRole('button',{name:'纯色夜间，深色背景'}));
  expect(readMaterialPreferences().lightBackground).toBe('marble');
  fireEvent.click(screen.getByRole('button',{name:'纯色日间，浅色背景'}));
  expect(readMaterialPreferences()).toEqual({glass:true,motion:true,tint:75,darkBackground:'solid',lightBackground:'solid'});
  expect(document.body.dataset.enigmaTone).toBe('dark');
});
