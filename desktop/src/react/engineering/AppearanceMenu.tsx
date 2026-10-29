import { useEffect, useState } from 'react';
import { GlassSelection } from '../ui/GlassSelection';
import { GlassClarityControl } from '../ui/GlassClarityControl';
import { BackgroundPicker } from '../ui/BackgroundPicker';
import { AUTO_LIGHT_DEFAULT, AUTO_DARK_DEFAULT, STORAGE_KEY, THEMES, resolveSavedTheme, type ThemeId } from '../../shared/theme-registry';
import { persistAppearancePreferences } from '../services/appearance-sync';
import { AppIcon, type AppIconName } from '../ui/app-icons';
import { useMaterialPreferences } from '../ui/material-preferences';
import { SurfaceMenu } from './SurfaceMenu';
import './AppearanceMenu.css';

function readAppearance() {
  let saved: string | null = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* Use the applied theme. */ }
  const resolved = resolveSavedTheme(saved, !!window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  const applied = document.documentElement.getAttribute('data-theme') as ThemeId | null;
  const color = (THEMES[applied || resolved.concrete] || THEMES[resolved.concrete]).backgroundColor;
  const [r, g, b] = [1, 3, 5].map(at => parseInt(color.slice(at, at + 2), 16));
  const dark = r * .2126 + g * .7152 + b * .0722 < 128;
  return { dark, selection: resolved.stored === 'auto' ? 'auto' : dark ? AUTO_DARK_DEFAULT : AUTO_LIGHT_DEFAULT };
}

const choices: { id: string; label: string; icon: AppIconName }[] = [
  { id: AUTO_LIGHT_DEFAULT, label: '浅色', icon: 'sun' },
  { id: AUTO_DARK_DEFAULT, label: '深色', icon: 'moon' },
  { id: 'auto', label: '跟随系统', icon: 'monitor' },
];

export function AppearanceMenu() {
  const [theme, setTheme] = useState(readAppearance);
  const [material, setMaterial] = useMaterialPreferences();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const update = () => setTheme(readAppearance());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    window.addEventListener('storage', update);
    return () => { observer.disconnect(); window.removeEventListener('storage', update); };
  }, []);
  const chooseTheme = async (id: string) => {
    if (saving) return;
    setError('');
    if (!window.setTheme) { setError('主题尚未就绪，请稍后再试。'); return; }
    setSaving(true);
    try {
      window.setTheme(id);
      setTheme(readAppearance());
      await persistAppearancePreferences({ theme: id });
    } catch { setError('已在本机切换，跨窗口同步失败。请重试。'); }
    finally { setSaving(false); }
  };
  const tone = theme.dark ? '深色' : '浅色';
  const automatic = theme.selection === 'auto';
  return <SurfaceMenu label="工作台外观" stayOpen triggerClassName="enigma-appearance-trigger" panelClassName="enigma-appearance-menu"
    hint={`当前${automatic ? '跟随系统，' : ''}${tone}；玻璃${material.glass ? '已开启' : '已关闭'}，动效${material.motion ? '已开启' : '已关闭'}`}
    icon={<><AppIcon name={theme.dark ? 'moon' : 'sun'} size={17}/><span>外观 · {automatic ? '自动' : tone}</span><AppIcon name="chevronDown" size={12}/></>}>
    <div className="enigma-appearance-heading"><strong>主题</strong><span>{automatic ? '跟随系统 · ' : '当前：'}{tone}</span></div>
    <div className="enigma-appearance-themes" role="group" aria-label="主题模式" data-glass-segmented="">
      <GlassSelection selection={theme.selection}/>
      {choices.map(choice => <button type="button" key={choice.id} className="enigma-theme-option" aria-label={choice.label}
        aria-pressed={theme.selection === choice.id} disabled={saving} onClick={() => void chooseTheme(choice.id)}>
        <AppIcon name={choice.icon} size={21}/><span>{choice.label}</span>
        <span className="enigma-theme-selected">{theme.selection === choice.id ? <><AppIcon name="check" size={12}/>使用中</> : '选择'}</span>
      </button>)}
    </div>
    <BackgroundPicker tone={theme.dark ? 'dark' : 'light'}/>
    <div className="enigma-appearance-effects">
      {([
        { key: 'glass', label: '液态玻璃', hint: '通透、折射与反光', icon: 'layers' },
        { key: 'motion', label: '界面动效', hint: '背景流动与交互过渡', icon: 'extract' },
      ] as const).map(option => <button type="button" key={option.key} className="enigma-effect-switch" role="switch" aria-label={option.label}
        aria-checked={material[option.key]} onClick={() => setMaterial({ ...material, [option.key]: !material[option.key] })}>
        <AppIcon name={option.icon} size={18}/><span className="enigma-effect-label"><b>{option.label}</b><small>{option.hint}</small></span>
        <span className="enigma-effect-state">{material[option.key] ? '已开启' : '已关闭'}</span><span className="enigma-switch-track" aria-hidden="true"><i/></span>
      </button>)}
    </div>
    <GlassClarityControl/>
    {saving && <p className="enigma-appearance-feedback" role="status">正在同步主题…</p>}
    {error && <p className="enigma-appearance-feedback" role="alert">{error}</p>}
  </SurfaceMenu>;
}
