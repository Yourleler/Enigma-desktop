import { useLayoutEffect } from 'react';
import { installVisualActivity } from './visual-activity';
import {createPortal} from 'react-dom';
import './workspace-tokens.css';
import { isDarkTheme, STORAGE_KEY, resolveSavedTheme, type ThemeId } from '../../shared/theme-registry';
import '../engineering/enigma-design.css';
import { LiquidGlass } from './LiquidGlass';
import { AnimatedBackground } from './AnimatedBackground';
import { applyMaterialPreferences, readMaterialPreferences } from './material-preferences';

/** Keep standalone windows on the same palette as the main workbench. */
export function EnigmaDesign({surface='window'}:{surface?:'window'|'floating'}={}) {
  useLayoutEffect(() => installVisualActivity(), []);
  useLayoutEffect(() => {
    document.body.classList.add('enigma-surface');
    const previousSurface=document.body.dataset.enigmaWindow;
    document.body.dataset.enigmaWindow=surface;
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
    return () => { observer.disconnect(); system?.removeEventListener('change', sync); window.removeEventListener('storage', sync);if(previousSurface===undefined)delete document.body.dataset.enigmaWindow;else document.body.dataset.enigmaWindow=previousSurface; };
  }, [surface]);
  return <>{surface==='window'&&<><AnimatedBackground />{createPortal(<div className="enigma-window-material" aria-hidden="true"/>,document.body)}</>}<LiquidGlass /></>;
}
