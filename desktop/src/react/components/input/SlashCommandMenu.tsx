import { memo, useRef, useEffect } from 'react';
import type { SlashItem } from '../InputArea';
import {AppIcon} from '../../ui/app-icons';
import styles from './InputArea.module.css';

export const SlashCommandMenu = memo(function SlashCommandMenu({ commands, selected, busy, onSelect, onHover }: {
  commands: SlashItem[];
  selected: number;
  busy: string | null;
  onSelect: (cmd: SlashItem) => void;
  onHover: (i: number) => void;
}) {
  const selectedRef = useRef<HTMLButtonElement>(null);
  const zh=window.i18n?.locale?.startsWith('zh')!==false;
  useEffect(() => { selectedRef.current?.scrollIntoView?.({ block: 'nearest' }); }, [selected]);
  return (
    <div className={styles['slash-menu']} data-liquid="menu" data-menu-surface="" data-menu-position="absolute">
      <div className={styles['slash-menu-heading']}><span>{zh?'快捷命令':'Commands'}</span><span>{commands.length}</span></div>
      <div className={styles['slash-menu-list']} role="listbox" aria-label={zh?'快捷命令':'Commands'}>
      {commands.map((cmd, i) => (
        <button key={cmd.name} type="button" role="option" aria-selected={i===selected} aria-label={`${cmd.label} ${cmd.description}`}
          ref={i === selected ? selectedRef : undefined} data-menu-row="" data-current={i===selected}
          className={`${styles['slash-menu-item']}${i === selected ? ` ${styles.selected}` : ''}${busy === cmd.name ? ` ${styles.busy}` : ''}`}
          onMouseEnter={() => onHover(i)} onMouseDown={event=>event.preventDefault()}
          onClick={() => !busy && onSelect(cmd)} disabled={!!busy}>
          <span className={`enigma-icon-tile ${styles['slash-menu-icon']}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: cmd.icon }} />
          <span className={styles['slash-menu-copy']}><span className={styles['slash-menu-label']}>{cmd.label}</span><span className={styles['slash-menu-desc']}>{busy===cmd.name&&cmd.busyLabel?cmd.busyLabel:cmd.description}</span></span>
          <span className={styles['slash-menu-key']} aria-hidden="true">{i===selected&&<AppIcon name="arrowEnter" size={14}/>}</span>
        </button>
      ))}
      </div>
      <div className={styles['slash-menu-footer']}><span><kbd>↑</kbd><kbd>↓</kbd> {zh?'选择':'Navigate'}</span><span><kbd>↵</kbd> {zh?'确认':'Choose'}</span><span><kbd>esc</kbd> {zh?'关闭':'Close'}</span></div>
    </div>
  );
});
