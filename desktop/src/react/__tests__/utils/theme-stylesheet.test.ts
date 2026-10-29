// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {createThemeStylesheetSwitch} from '../../../shared/theme-stylesheet';
afterEach(()=>{document.head.innerHTML='';vi.restoreAllMocks()});
it('retains the old stylesheet until the new one is ready',()=>{
  document.head.innerHTML='<link id="themeSheet" rel="stylesheet" href="/light.css">';
  const change=createThemeStylesheetSwitch(document),apply=vi.fn();
  change('/dark.css',apply);
  const next=document.querySelector<HTMLLinkElement>('[data-pending-theme]')!;
  expect(document.querySelector<HTMLLinkElement>('#themeSheet')!.href).toContain('/light.css');
  expect(next.media).toBe('not all');expect(apply).not.toHaveBeenCalled();
  next.dispatchEvent(new Event('load'));
  expect(document.querySelector<HTMLLinkElement>('#themeSheet')).toBe(next);
  expect(next.media).toBe('all');expect(apply).toHaveBeenCalledOnce();
});
it('does not let an earlier load override the latest selection and survives load failure',()=>{
  document.head.innerHTML='<link id="themeSheet" rel="stylesheet" href="/light.css">';
  const change=createThemeStylesheetSwitch(document),oldApply=vi.fn(),newApply=vi.fn();
  change('/dark.css',oldApply);const old=document.querySelector('[data-pending-theme]')!;
  change('/other.css',newApply);const next=document.querySelector('[data-pending-theme]')!;
  old.dispatchEvent(new Event('load'));expect(oldApply).not.toHaveBeenCalled();
  vi.spyOn(console,'warn').mockImplementation(()=>{});next.dispatchEvent(new Event('error'));
  expect(document.querySelector<HTMLLinkElement>('#themeSheet')!.href).toContain('/light.css');expect(newApply).not.toHaveBeenCalled();
});
