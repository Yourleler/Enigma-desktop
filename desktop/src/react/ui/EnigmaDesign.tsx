import { useLayoutEffect } from 'react';
import { isDarkTheme, STORAGE_KEY, resolveSavedTheme, type ThemeId } from '../../shared/theme-registry';
import '../engineering/enigma-design.css';
import { LiquidGlass } from './LiquidGlass';
import { AnimatedBackground } from './AnimatedBackground';
import { applyMaterialPreferences, readMaterialPreferences } from './material-preferences';

/** Keep standalone windows on the same palette as the main workbench. */
export function EnigmaDesign() {
  useLayoutEffect(() => {
    document.body.classList.add('enigma-surface');
    const system = window.matchMedia?.('(prefers-color-scheme: dark)');
    const sync = () => {
      document.body.classList.remove('paper-texture');
      applyMaterialPreferences(readMaterialPreferences());
      const selected = document.documentElement.getAttribute('data-theme') as ThemeId | null;
      let saved: string | null = null;
      try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* Unavailable storage uses the default palette. */ }
      const theme = selected || resolveSavedTheme(saved, !!system?.matches).concrete;
      document.body.dataset.enigmaTone = isDarkTheme(theme) ? 'dark' : 'light';
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    system?.addEventListener('change', sync);
    window.addEventListener('storage', sync);
    return () => { observer.disconnect(); system?.removeEventListener('change', sync); window.removeEventListener('storage', sync); };
  }, []);
  return <><AnimatedBackground /><LiquidGlass /></>;
}
