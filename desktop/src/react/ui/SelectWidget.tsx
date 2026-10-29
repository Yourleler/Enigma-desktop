import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import styles from './SelectWidget.module.css';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  group?: string;
  description?: string;
}

export { styles as selectWidgetStyles };

interface SelectWidgetProps {
  ariaLabel?: string;
  ariaLabelledBy?: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  popupClassName?: string;
  renderTrigger?: (option: SelectOption | undefined, isOpen: boolean) => React.ReactNode;
  renderOption?: (option: SelectOption, isSelected: boolean) => React.ReactNode;
  /** Custom group-header renderer; defaults to the built-in label */
  renderGroupHeader?: (group: string) => React.ReactNode;
  /** 'comfortable' gives 1.2x row height for avatar-containing options */
  density?: 'compact' | 'comfortable';
  /** Popup horizontal alignment relative to trigger */
  align?: 'start' | 'end';
  /** Skip the built-in trigger chrome (border/padding/bg) so a custom trigger fully owns its look */
  triggerBare?: boolean;
  /** Gap in px between trigger and popup (default 2) */
  offset?: number;
  /** Force the popup min-width in px; defaults to the trigger width */
  popupMinWidth?: number;
  /** Force open direction; 'auto' decides by available space */
  placement?: 'auto' | 'top' | 'bottom';
  /** Guard run before opening; return false to veto (e.g. show a toast instead) */
  onAttemptOpen?: () => boolean;
}

export function SelectWidget({
  ariaLabel,
  ariaLabelledBy,
  options,
  value,
  onChange,
  placeholder,
  disabled,
  className,
  triggerClassName,
  popupClassName,
  renderTrigger,
  renderOption,
  renderGroupHeader,
  density = 'compact',
  align = 'end',
  triggerBare = false,
  offset = 2,
  popupMinWidth,
  placement = 'auto',
  onAttemptOpen,
}: SelectWidgetProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});
  const [openDirection, setOpenDirection] = useState<'up' | 'down'>('down');
  const keyboardOpen=useRef<'first'|'last'|null>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(()=>{if(!open)return;const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();triggerRef.current?.focus();}};document.addEventListener('keydown',escape,true);return()=>document.removeEventListener('keydown',escape,true);},[open,close]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openAbove = placement === 'top'
      ? true
      : placement === 'bottom'
        ? false
        : (spaceBelow < 200 && spaceAbove > spaceBelow);
    setOpenDirection(openAbove ? 'up' : 'down');

    const bounds=panelRef.current?.getBoundingClientRect();
    const maxWidth=Math.max(80,window.innerWidth-24),width=Math.min(maxWidth,Math.max(bounds?.width||0,popupMinWidth??rect.width));
    setPanelStyle({
      position: 'fixed',
      left:Math.max(12,Math.min(align==='start'?rect.left:rect.right-width,window.innerWidth-width-12)),
      minWidth: Math.min(popupMinWidth ?? rect.width,maxWidth),
      maxWidth,
      maxHeight:Math.max(60,Math.min(360,(openAbove?spaceAbove:spaceBelow)-offset-12)),
      ...(openAbove
        ? { bottom: window.innerHeight - rect.top + offset }
        : { top: rect.bottom + offset }),
      zIndex: triggerRef.current.closest('.enigma-modal-portal') ? 10020 : 9999,
    });
    if(keyboardOpen.current){const buttons=[...panelRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)')||[]];(buttons.find(button=>button.getAttribute('aria-selected')==='true')||(keyboardOpen.current==='last'?buttons.at(-1):buttons[0]))?.focus();keyboardOpen.current=null;}
  }, [open, align, offset, popupMinWidth, placement,options]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: Event) => {
      const target = e.target as Node | null;
      if (panelRef.current?.contains(target)) return;
      // Only a scroll that can actually move the trigger out from under the popup should close
      // it. A scroll inside some unrelated container — e.g. a background keep-alive chat panel
      // (visibility:hidden but still laid out) collapsing its process-fold/typing-indicator at
      // turn end — fires a capture-phase scroll event here too, but it has no bearing on this
      // popup's trigger position and must not close a dropdown open in another session/surface.
      const trigger = triggerRef.current;
      if (
        trigger
        && target
        && typeof (target as Element | Document).contains === 'function'
        && !(target as Element | Document).contains(trigger)
      ) {
        return;
      }
      close();
    };
    window.addEventListener('scroll', handler, true);
    return () => window.removeEventListener('scroll', handler, true);
  }, [open, close]);

  const current = options.find(o => o.value === value);
  const displayText = current?.label || placeholder || '';
  const isPlaceholder = !current;

  const renderItems = () => {
    const hasGroups = options.some(o => o.group);
    if (!hasGroups) {
      return options.map(item => renderItem(item));
    }

    const groups: Record<string, SelectOption[]> = {};
    for (const o of options) {
      const g = o.group || '';
      if (!groups[g]) groups[g] = [];
      groups[g].push(o);
    }

    return Object.entries(groups).map(([group, items]) => (
      <div key={group || '__none'}>
        {group && (renderGroupHeader ? renderGroupHeader(group) : <div className={styles.groupHeader}>{group}</div>)}
        {items.map(item => renderItem(item, group))}
      </div>
    ));
  };

  const renderItem = (item: SelectOption, group?: string) => {
    const selected = item.value === value;
    return (
      <button
        type="button"
        key={group ? `${group}/${item.value}` : item.value}
        role="option"
        aria-selected={selected}
        data-menu-row=""
        className={[
          styles.option,
          selected && styles.selected,
          item.disabled && styles.disabled,
        ].filter(Boolean).join(' ')}
        disabled={item.disabled}
        onClick={() => {
          if (item.disabled) return;
          onChange(item.value);
          close();
          triggerRef.current?.focus();
        }}
      >
        {renderOption ? renderOption(item, selected) : (
          <>
            <span>{item.label}</span>
            {item.description && <span className={styles.optionDesc}>{item.description}</span>}
          </>
        )}
        <span className={styles.selectionMark} aria-hidden="true">{selected&&<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6"/></svg>}</span>
      </button>
    );
  };

  return (
    <div className={[styles.root, open && styles.open, className].filter(Boolean).join(' ')}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        data-select-widget-trigger=""
        data-glass-interactive=""
        className={[!triggerBare && styles.trigger, triggerClassName].filter(Boolean).join(' ')}
        ref={triggerRef}
        onKeyDown={event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();if(disabled||!open&&onAttemptOpen&&onAttemptOpen()===false)return;if(open){const items=panelRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)');(event.key==='ArrowUp'?items?.[items.length-1]:items?.[0])?.focus();}else{keyboardOpen.current=event.key==='ArrowUp'?'last':'first';setOpen(true);}}}}
        onClick={() => {
          if (disabled) return;
          if (!open && onAttemptOpen && !onAttemptOpen()) return;
          setOpen(!open);
        }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-open={open}
        title={displayText}
      >
        {renderTrigger ? renderTrigger(current, open) : (
          <>
            <span className={[styles.value, isPlaceholder && styles.placeholder].filter(Boolean).join(' ')}>
              {displayText}
            </span>
            <svg className={styles.arrow} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6l4 4 4-4" />
            </svg>
          </>
        )}
      </button>
      {open && createPortal(
        <div
          className={[styles.popup, density === 'comfortable' && styles.comfortable, popupClassName].filter(Boolean).join(' ')}
          ref={panelRef}
          style={panelStyle}
          data-select-widget-popup
          data-liquid="menu"
          data-menu-surface=""
          data-menu-position="fixed"
          data-direction={openDirection}
          data-align={align}
          role="listbox"
          onKeyDown={event=>{
            if(event.key==='Tab'){event.preventDefault();close();triggerRef.current?.focus();}
            if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();triggerRef.current?.focus();}
            if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const items=[...panelRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)')||[]],index=items.indexOf(document.activeElement as HTMLButtonElement);if(items.length)items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:items.length-1))%items.length]?.focus();}
          }}
        >
          <div className={styles.scrollArea} data-select-widget-scroll="" data-menu-scroll="">
            {options.length?renderItems():<p className={styles.empty}>{window.i18n?.locale?.startsWith('zh')===false?'No options available':'暂无可选项'}</p>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
