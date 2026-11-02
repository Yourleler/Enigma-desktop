// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationCard } from '../AutomationCard';
import type { CronJob, ModelOption } from '../automation-types';
import { useStore } from '../../../stores';

vi.mock('../AutomationRunHistory',()=>({AutomationRunHistory:()=>null}));

vi.mock('../ScheduleEditor', () => ({
  ScheduleEditor: () => <div data-testid="schedule-editor" />,
}));

const job: CronJob = {
  id: 'job-1',
  type: 'cron',
  schedule: '0 9 * * *',
  enabled: false,
  label: 'Morning check',
  prompt: 'Check the project status',
};

const models: ModelOption[] = [
  { provider: 'openai', id: 'shared-model', name: 'Shared Model' },
  { provider: 'openrouter', id: 'shared-model', name: 'Shared Model' },
];

describe('AutomationCard model selection', () => {
  beforeEach(() => {
    window.t = ((key: string) => ({
      'automation.defaultModel': 'Default model',
      'rightWorkspace.session.model': 'Model',
      'common.confirm': 'Save',
    }[key] ?? key)) as typeof window.t;
    useStore.setState({
      agents: [{ id: 'hanako', name: 'Hanako', yuan: 'hanako', homeFolder: '/home/hanako' }],
      currentAgentId: 'hanako',
      agentName: 'Hanako',
      agentYuan: 'hanako',
    } as never);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('preserves a draft when only the scheduler run state refreshes',()=>{
    const props={job,availableModels:[],open:true,onToggleOpen:vi.fn(),onToggleEnabled:vi.fn(),onRemove:vi.fn(),onUpdate:vi.fn()};
    const view=render(<AutomationCard {...props}/>);
    fireEvent.change(screen.getByRole('textbox',{name:'automation.field.prompt'}),{target:{value:'Unsaved user requirements'}});
    view.rerender(<AutomationCard {...props} job={{...job,lastRunAt:new Date().toISOString()}}/>);
    expect(screen.getByRole('textbox',{name:'automation.field.prompt'})).toHaveValue('Unsaved user requirements');
  });
  it('exposes task enablement as a keyboard accessible switch',()=>{
    render(<AutomationCard job={job} availableModels={[]} open onToggleOpen={vi.fn()} onToggleEnabled={vi.fn()} onRemove={vi.fn()} onUpdate={vi.fn()}/>);
    expect(screen.getByRole('switch',{name:'automation.enable'})).toHaveAttribute('aria-checked','false');
  });

  it('keeps failed changes editable and prevents duplicate submissions',async()=>{
    let reject!:(error:Error)=>void;
    const onUpdate=vi.fn().mockReturnValue(new Promise((_resolve,no)=>{reject=no;}));
    render(<AutomationCard job={{...job,configRevision:3}} availableModels={[]} open onToggleOpen={vi.fn()} onRemove={vi.fn()} onUpdate={onUpdate}/>);
    fireEvent.change(screen.getByRole('textbox',{name:'automation.field.prompt'}),{target:{value:'Keep this draft'}});
    const save=screen.getByRole('button',{name:'Save'});fireEvent.click(save);fireEvent.click(save);
    expect(onUpdate).toHaveBeenCalledOnce();expect(onUpdate.mock.calls[0][1]).toMatchObject({prompt:'Keep this draft',expectedConfigRevision:3});
    reject(Error('Permission denied'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Permission denied');
    expect(screen.getByRole('textbox',{name:'automation.field.prompt'})).toHaveValue('Keep this draft');
    expect(screen.getByRole('button',{name:'Save'})).toBeEnabled();
  });
  it('does not display a stale next-run time for a disabled task',()=>{
    render(<AutomationCard job={{...job,nextRunAt:'2030-01-01T01:00:00Z'}} availableModels={[]} open onToggleOpen={vi.fn()} onRemove={vi.fn()} onUpdate={vi.fn()}/>);
    expect(screen.queryByText(/2030/)).toBeNull();
  });

  it('groups equal display names by provider and saves the selected provider/id pair', () => {
    const onUpdate = vi.fn();
    render(
      <AutomationCard
        job={job}
        availableModels={models}
        open
        onToggleOpen={vi.fn()}
        onToggleEnabled={vi.fn()}
        onRemove={vi.fn()}
        onUpdate={onUpdate}
      />,
    );

    const modelField = screen.getByText('Model').closest('label');
    expect(modelField).not.toBeNull();
    fireEvent.click(within(modelField!).getByRole('button'));

    expect(screen.getByRole('option', { name: 'Default model' })).toBeInTheDocument();
    expect(screen.getByText('openai')).toBeInTheDocument();
    expect(screen.getByText('openrouter')).toBeInTheDocument();

    const equalNameOptions = screen.getAllByRole('option', { name: 'Shared Model' });
    expect(equalNameOptions).toHaveLength(2);
    const openrouterGroup = screen.getByText('openrouter').parentElement?.parentElement;
    expect(openrouterGroup).not.toBeNull();
    fireEvent.click(within(openrouterGroup!).getByRole('option', { name: 'Shared Model' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onUpdate).toHaveBeenCalledWith('job-1', {
      model: { provider: 'openrouter', id: 'shared-model' },
    });
  });
});
