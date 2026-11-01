import { useEffect, useRef } from 'react';
import './SearchField.css';
import styles from './ClassicFindBox.module.css';

function iconPath(kind: 'search' | 'up' | 'down' | 'close'): string {
  if (kind === 'search') return 'M21 21l-4.3-4.3m1.8-5.2a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z';
  if (kind === 'up') return 'M18 15l-6-6-6 6';
  if (kind === 'down') return 'M6 9l6 6 6-6';
  return 'M18 6L6 18M6 6l12 12';
}

function Icon({ kind }: { kind: 'search' | 'up' | 'down' | 'close' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={iconPath(kind)} />
    </svg>
  );
}

export function ClassicFindBox({
  open,
  query,
  resultIndex,
  resultCount,
  truncated = false,
  onQueryChange,
  onPrevious,
  onNext,
  onClose,
  placeholder,
  ariaLabel = 'Find',
  inline = false,
  labels = {previous:'Previous match',next:'Next match',close:'Close find'},
}: {
  open: boolean;
  query: string;
  resultIndex: number;
  resultCount: number;
  truncated?: boolean;
  onQueryChange: (query: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
  placeholder?: string;
  ariaLabel?: string;
  inline?: boolean;
  labels?: {previous:string;next:string;close:string};
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open)return;
    const previous=document.activeElement as HTMLElement|null;
    const timer=window.setTimeout(()=>inputRef.current?.focus(),0);
    return()=>{window.clearTimeout(timer);if(document.activeElement===inputRef.current)previous?.focus();};
  }, [open]);
  if (!open) return null;
  const countLabel = query ? `${resultCount ? resultIndex + 1 : 0}/${resultCount}${truncated?'+':''}` : '0/0';
  return (
    <div data-field-surface="search" className={`enigma-search-surface ${styles.findBox} ${inline?styles.findBoxInline:''}`} role="search">
      <Icon kind="search" />
      <input
        ref={inputRef}
        value={query}
        onChange={event => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (event.shiftKey) onPrevious();
            else onNext();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        data-classic-find-input=""
      />
      <span className={styles.findCount} aria-live="polite">{countLabel}</span>
      <button type="button" onClick={onPrevious} aria-label={labels.previous} disabled={inline&&!resultCount} title="Shift+Enter"><Icon kind="up" /></button>
      <button type="button" onClick={onNext} aria-label={labels.next} disabled={inline&&!resultCount} title="Enter"><Icon kind="down" /></button>
      <button type="button" onClick={onClose} aria-label={labels.close} title="Esc"><Icon kind="close" /></button>
      {query&&truncated&&<small className={styles.findLimit} role="status">已显示前 {resultCount} 项，请缩小查询范围。</small>}
    </div>
  );
}
