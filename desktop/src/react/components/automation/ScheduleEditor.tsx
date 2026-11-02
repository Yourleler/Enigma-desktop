import { useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react';
import {createPortal} from 'react-dom';
import { SelectWidget, type SelectOption } from '@/ui';
import type { ScheduleDraft, ScheduleMode, IntervalUnit } from './schedule-draft';
import styles from './AutomationPanel.module.css';

const SCHEDULE_MODES: ScheduleMode[] = ['interval', 'daily', 'weekly', 'monthly', 'once', 'advanced'];
const INTERVAL_UNITS: IntervalUnit[] = ['minutes', 'hours', 'days'];

function t(key: string) {
  return (window.t ?? ((p: string) => p))(key);
}

function dayNames() {
  const value = (window.t as (...args: unknown[]) => unknown)?.('cron.dayNames');
  return Array.isArray(value) ? value.map(String) : ['日', '一', '二', '三', '四', '五', '六'];
}

function two(value: number) {
  return String(value).padStart(2, '0');
}

function parseTime(value: string) {
  const [hour = '9', minute = '0'] = String(value || '').split(':');
  return {
    hour: Math.max(0, Math.min(23, parseInt(hour, 10) || 0)),
    minute: Math.max(0, Math.min(59, parseInt(minute, 10) || 0)),
  };
}

function formatTime(hour: number, minute: number) {
  return `${two(hour)}:${two(minute)}`;
}

function TimePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [position,setPosition]=useState({left:12,top:12});
  const { hour, minute } = parseTime(value);
  const hours = useMemo(() => Array.from({ length: 24 }, (_, index) => index), []);
  const minutes = useMemo(() => Array.from({ length: 60 }, (_, index) => index), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)&&!popoverRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {event.preventDefault();event.stopPropagation();setOpen(false);rootRef.current?.querySelector('button')?.focus();}
    };
    const onScroll=(event:Event)=>{if(!popoverRef.current?.contains(event.target as Node))setOpen(false);};
    document.addEventListener('scroll',onScroll,true);
    const onResize=()=>setOpen(false);window.addEventListener('resize',onResize);
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('resize',onResize);
      document.removeEventListener('scroll',onScroll,true);
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useLayoutEffect(()=>{
    if(!open)return;
    const anchor=rootRef.current?.getBoundingClientRect();
    if(anchor)setPosition({left:Math.max(12,Math.min(anchor.left,window.innerWidth-196)),top:anchor.bottom+196<window.innerHeight?anchor.bottom+6:Math.max(12,anchor.top-196)});
    popoverRef.current?.querySelectorAll<HTMLElement>('[data-selected="true"]').forEach(node=>{const parent=node.parentElement;if(parent)parent.scrollTop=node.offsetTop-parent.offsetTop-parent.clientHeight/2+node.offsetHeight/2;});
  },[open,hour,minute]);
  const keyboard=(event:React.KeyboardEvent<HTMLButtonElement>,value:number,max:number,select:(value:number)=>void)=>{
    if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
    event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?max:(value+(event.key==='ArrowUp'?-1:1)+max+1)%(max+1);
    select(next);(event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus({preventScroll:true});
  };

  const selectHour = (nextHour: number) => {
    onChange(formatTime(nextHour, minute));
  };

  const selectMinute = (nextMinute: number) => {
    onChange(formatTime(hour, nextMinute));
  };

  return (
    <div className={styles.timePicker} ref={rootRef}>
      <button
        className={styles.timePickerButton}
        type="button"
        aria-label={t('automation.schedule.time')}
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <span>{formatTime(hour, minute)}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 7v5l3 2" />
        </svg>
      </button>
      {open ? createPortal(
        <div className={styles.timePickerPopover} ref={popoverRef} style={position} data-menu-surface="" data-menu-position="fixed" data-liquid="menu">
          <div className={styles.timePickerColumn} role="listbox" aria-label={t('automation.schedule.hour')}>
            {hours.map(option => (
              <button
                key={option}
                className={styles.timePickerOption}
                type="button"
                aria-label={`${two(option)} ${t('automation.schedule.hour')}`}
                role="option" aria-selected={option===hour} tabIndex={option===hour?0:-1}
                onKeyDown={event=>keyboard(event,option,23,selectHour)}
                data-selected={option === hour}
                onClick={() => selectHour(option)}
              >
                {two(option)}
              </button>
            ))}
          </div>
          <div className={styles.timePickerDivider} aria-hidden="true" />
          <div className={styles.timePickerColumn} role="listbox" aria-label={t('automation.schedule.minute')}>
            {minutes.map(option => (
              <button
                key={option}
                className={styles.timePickerOption}
                type="button"
                aria-label={`${two(option)} ${t('automation.schedule.minute')}`}
                role="option" aria-selected={option===minute} tabIndex={option===minute?0:-1}
                onKeyDown={event=>keyboard(event,option,59,selectMinute)}
                data-selected={option === minute}
                onClick={() => selectMinute(option)}
              >
                {two(option)}
              </button>
            ))}
          </div>
        </div>,document.body
      ) : null}
    </div>
  );
}

export function ScheduleEditor({
  draft,
  onChange,
  className = '',
}: {
  draft: ScheduleDraft;
  onChange: (draft: ScheduleDraft) => void;
  className?: string;
}) {
  const update = (patch: Partial<ScheduleDraft>) => onChange({ ...draft, ...patch });
  const days = dayNames();

  return (
    <div className={`${styles.scheduleEditor}${className ? ` ${className}` : ''}`}>
      <label className={styles.field}>
        <span>执行频率</span>
        <SelectWidget
          className={styles.scheduleSelect}
          triggerClassName={styles.scheduleSelectTrigger}
          options={SCHEDULE_MODES.map((mode): SelectOption => ({ value: mode, label: t(`automation.schedule.mode.${mode}`) }))}
          value={draft.mode}
          onChange={v => update({ mode: v as ScheduleMode })}
        />
      </label>

      {draft.mode === 'interval' ? (
        <div className={styles.scheduleInline}>
          <label className={styles.field}>
            <span>{t('automation.schedule.every')}</span>
            <input
              type="number"
              min="1"
              step="1"
              value={draft.intervalValue}
              onChange={e => update({ intervalValue: e.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span>{t('automation.schedule.unit')}</span>
            <SelectWidget
              className={styles.scheduleSelect}
              triggerClassName={styles.scheduleSelectTrigger}
              options={INTERVAL_UNITS.map((unit): SelectOption => ({ value: unit, label: t(`automation.schedule.unitLabel.${unit}`) }))}
              value={draft.intervalUnit}
              onChange={v => update({ intervalUnit: v as IntervalUnit })}
            />
          </label>
        </div>
      ) : null}

      {draft.mode === 'daily' ? (
        <label className={styles.field}>
          <span>{t('automation.schedule.time')}</span>
          <TimePicker value={draft.time} onChange={time => update({ time })} />
        </label>
      ) : null}

      {draft.mode === 'weekly' ? (
        <div className={styles.scheduleInline}>
          <label className={styles.field}>
            <span>{t('automation.schedule.weekday')}</span>
            <SelectWidget
              className={styles.scheduleSelect}
              triggerClassName={styles.scheduleSelectTrigger}
              options={days.map((name, index): SelectOption => ({ value: String(index), label: `${t('cron.weekPrefix')}${name}` }))}
              value={draft.weekday}
              onChange={v => update({ weekday: v })}
            />
          </label>
          <label className={styles.field}>
            <span>{t('automation.schedule.time')}</span>
            <TimePicker value={draft.time} onChange={time => update({ time })} />
          </label>
        </div>
      ) : null}

      {draft.mode === 'monthly' ? (
        <div className={styles.scheduleInline}>
          <label className={styles.field}>
            <span>{t('automation.schedule.monthDay')}</span>
            <input
              type="number"
              min="1"
              max="31"
              step="1"
              value={draft.monthDay}
              onChange={e => update({ monthDay: e.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span>{t('automation.schedule.time')}</span>
            <TimePicker value={draft.time} onChange={time => update({ time })} />
          </label>
        </div>
      ) : null}

      {draft.mode === 'once' ? (
        <label className={styles.field}>
          <span>{t('automation.schedule.dateTime')}</span>
          <input type="datetime-local" value={draft.dateTime} onInput={e => update({dateTime:e.currentTarget.value})} onChange={e => update({ dateTime: e.target.value })} />
        </label>
      ) : null}

      {draft.mode === 'advanced' ? (
        <label className={styles.field}>
          <span>{t('automation.schedule.cronExpression')}</span>
          <input value={draft.cron} onChange={e => update({ cron: e.target.value })} />
        </label>
      ) : null}
    </div>
  );
}
