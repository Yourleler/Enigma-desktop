// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MemoryReadResult,memoryCorrectionAction} from '../MemoryResult';
import {useEngineering,showAction,openEngineering,type Action} from '../state';
import {useStore} from '../../stores';
vi.mock('../state',async load=>({...await load<typeof import('../state')>(),showAction:vi.fn(),openEngineering:vi.fn()}));
const save={id:'memory-save',fields:['title','content','kind','scope','repos','sources','replaces','appliesWhen'].map(name=>({name,label:name}))} as Action;
const value={record:{id:'memory-a',title:'接口约束',kind:'contract',scope:{type:'repositories',repos:['api']},anchors:[{repo:'api',file:'index.ts',hash:'source'}],status:'candidate',appliesWhen:'接口迁移',updatedAt:'2026-10-27T00:00:00Z'},freshness:'stale',content:'保持兼容',problems:['Source changed: api:index.ts']};
beforeEach(()=>{vi.clearAllMocks();useStore.setState({sessionPermissionMode:'ask'});useEngineering.setState({snapshot:{state:{idle:true},actions:[save]}});});afterEach(cleanup);
it('shows readable applicability and stale source, linking current code without rewriting history',()=>{
 render(<MemoryReadResult value={value} details={<p>raw-history</p>}/>);expect(screen.getByText('源码已变化： api:index.ts')).toBeVisible();expect(screen.getByText('raw-history')).not.toBeVisible();fireEvent.click(screen.getByRole('button',{name:'api / index.ts'}));expect(openEngineering).toHaveBeenCalledWith(expect.objectContaining({repo:'api',file:'index.ts'}));
 fireEvent.click(screen.getByRole('button',{name:'更正这条记忆'}));expect(showAction).toHaveBeenCalledWith(memoryCorrectionAction(save,value));
 const action=memoryCorrectionAction(save,value);expect(action.fields.find(field=>field.name==='replaces')).toMatchObject({kind:'record',value:'memory-a',source:undefined});expect(action.fields.find(field=>field.name==='sources')?.value).toEqual([{repo:'api',file:'index.ts'}]);
});
