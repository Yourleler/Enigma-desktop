// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {ContextHandoffMessage} from '../../components/chat/ContextHandoffMessage';
import {buildItemsFromHistory} from '../../utils/history-builder';
const value={goal:'新的文档任务',mode:'background' as const,notes:[{role:'assistant' as const,kind:'background',text:'青竹742：先结论后证据',reference:'pi:source:a'}],repositories:['api','client','app']};
afterEach(cleanup);
it('shows the new goal and keeps role-labelled background and complete context available on demand',()=>{
 render(<ContextHandoffMessage value={value} html="<p>Complete source context</p>"/>);
 expect(screen.getByText(value.goal)).toBeVisible();expect(screen.getByText(value.notes[0].text)).not.toBeVisible();expect(screen.getByText('Complete source context')).not.toBeVisible();
 const disclosure=screen.getByText(/携带的背景/).closest('details')!;disclosure.open=true;
 expect(screen.getByText(value.notes[0].text)).toBeVisible();expect(screen.getByText('原助手回复')).toBeVisible();
});
it('opens matching background for history search without losing the original clipboard source',()=>{
 const raw='Full handoff with 青竹742';const items=buildItemsFromHistory({messages:[{role:'user',id:'0',entryId:'u',content:raw,contextHandoff:value}]} as any);
 expect((items[0] as any).data.text).toBe(raw);expect((items[0] as any).data.contextHandoff).toEqual(value);
 render(<ContextHandoffMessage value={value} html="<p>Full handoff with 青竹742</p>" searchQuery="青竹742"/>);
 expect(screen.getByText(value.notes[0].text)).toBeVisible();
});
