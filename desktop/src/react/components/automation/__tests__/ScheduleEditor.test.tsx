// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScheduleEditor } from '../ScheduleEditor';
import { defaultScheduleDraft, type ScheduleDraft } from '../schedule-draft';

function Harness() {
  const [draft, setDraft] = useState<ScheduleDraft>({
    ...defaultScheduleDraft(),
    mode: 'daily',
    time: '12:00',
  });

  return <ScheduleEditor draft={draft} onChange={setDraft} />;
}

describe('ScheduleEditor', () => {
  beforeEach(() => {
    window.t = ((key: string) => {
      const translations: Record<string, string> = {
        'automation.field.schedule': '类型',
        'automation.schedule.time': '时间',
        'automation.schedule.hour': '小时',
        'automation.schedule.minute': '分钟',
        'automation.schedule.mode.interval': '每隔多久',
        'automation.schedule.mode.daily': '每天',
        'automation.schedule.mode.weekly': '每周',
        'automation.schedule.mode.monthly': '每月',
        'automation.schedule.mode.once': '指定一次',
        'automation.schedule.mode.advanced': '高级 Cron',
      };
      return translations[key] ?? key;
    }) as typeof window.t;
  });

  afterEach(() => {
    cleanup();
  });

  it('retains a one-time date received through an input event',()=>{
    function Once(){const [draft,setDraft]=useState({...defaultScheduleDraft(),mode:'once' as const});return <><ScheduleEditor draft={draft} onChange={value=>setDraft(value as typeof draft)}/><output>{draft.dateTime}</output></>;}
    const {container}=render(<Once/>);
    fireEvent.input(container.querySelector('input[type="datetime-local"]')!,{target:{value:'2030-01-02T12:30'}});
    expect(container.querySelector('output')).toHaveTextContent('2030-01-02T12:30');
  });
  it('mounts the time menu outside clipping panels and supports keyboard selection',()=>{
    const {container}=render(<Harness/>);
    fireEvent.click(screen.getByRole('button',{name:'时间'}));
    const hours=screen.getByRole('listbox',{name:'小时'});
    expect(container.contains(hours)).toBe(false);
    fireEvent.keyDown(screen.getByRole('option',{name:'12 小时'}),{key:'ArrowDown'});
    expect(screen.getByRole('button',{name:'时间'})).toHaveTextContent('13:00');
    fireEvent.keyDown(document,{key:'Escape'});expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('uses the Hana time picker instead of the native time input', () => {
    const { container } = render(<Harness />);

    expect(container.querySelector('input[type="time"]')).toBeNull();
    expect(screen.getByRole('button', { name: '时间' })).toHaveTextContent('12:00');
  });

  it('updates the draft from the custom hour and minute columns', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: '时间' }));
    fireEvent.click(screen.getByRole('option', { name: '13 小时' }));
    fireEvent.click(screen.getByRole('option', { name: '05 分钟' }));

    expect(screen.getByRole('button', { name: '时间' })).toHaveTextContent('13:05');
  });
});
