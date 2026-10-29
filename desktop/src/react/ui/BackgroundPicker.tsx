import { GlassSelection } from './GlassSelection';
import { AppIcon } from './app-icons';
import { BackgroundSwatch } from './BackgroundSwatch';
import { readMaterialPreferences, useMaterialPreferences, type DarkBackground, type LightBackground } from './material-preferences';
import './BackgroundPicker.css';

const darkChoices: { id: DarkBackground; name: string; detail: string }[] = [
  { id: 'aurora', name: '拟真极光', detail: '多色光幕，缓慢舞动' },
  { id: 'halo', name: '光环', detail: '青紫光晕，柔和漂移' },
  { id: 'solid', name: '纯色夜间', detail: '柔和近黑，无纹理与背景动效' },
];
const lightChoices: { id: LightBackground; name: string; detail: string }[] = [
  { id: 'ribbon', name: '紫色光带', detail: '淡紫底色，轻盈光带' },
  { id: 'marble', name: '紫色大理石', detail: '淡紫矿纹，不规则地缓慢流动' },
  { id: 'solid', name: '纯色日间', detail: '柔和浅白，无纹理与背景动效' },
];

/** Shared picker: a compact current-tone group in the toolbar, both saved
 * choices in settings. Choosing a background never switches the theme. */
export function BackgroundPicker({ tone }: { tone?: 'dark' | 'light' }) {
  const [preferences, save] = useMaterialPreferences();
  const groups = [
    { tone: 'dark' as const, label: '深色背景', key: 'darkBackground' as const, selected: preferences.darkBackground ?? 'aurora', choices: darkChoices },
    { tone: 'light' as const, label: '浅色背景', key: 'lightBackground' as const, selected: preferences.lightBackground ?? 'ribbon', choices: lightChoices },
  ];
  return <div className={`enigma-background-picker${tone ? ' is-compact' : ''}`}>
    {groups.filter(group => !tone || tone === group.tone).map(group => <div key={group.tone} className="enigma-background-group">
      <div className="enigma-background-heading"><strong>{group.label}</strong><span>自动记住选择</span></div>
      <div className="enigma-background-options" role="group" aria-label={group.label} data-glass-segmented="">
        <GlassSelection selection={group.selected}/>
        {group.choices.map(choice => <button type="button" key={choice.id} className="enigma-background-option" aria-pressed={group.selected === choice.id}
          aria-label={`${choice.name}，${group.label}`} onClick={() => save({ ...readMaterialPreferences(), [group.key]: choice.id })}>
          <BackgroundSwatch scene={choice.id === 'solid' ? `solid-${group.tone}` : choice.id}/>
          <span className="enigma-background-name"><b>{choice.name}</b><span className="enigma-background-check" aria-hidden="true">{group.selected === choice.id && <AppIcon name="check" size={14}/>}</span></span>
          <small>{choice.detail}</small>
        </button>)}
      </div>
    </div>)}
  </div>;
}
