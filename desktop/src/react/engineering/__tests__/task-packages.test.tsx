// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {TaskPackageResult,RestoredPackageResult,packageRestoreAction} from '../TaskPackages';
import {useEngineering,showAction,type Action} from '../state';
import {useStore} from '../../stores';
vi.mock('../state',async load=>({...await load<typeof import('../state')>(),showAction:vi.fn()}));
const restore={id:'package-restore',fields:['directory','expectedManifest','destination','writeRepos','activateRuntime'].map(name=>({name,label:name,...(name==='writeRepos'?{source:'repos'}:{})}))} as Action;
const value={packageInspection:true,directory:'/foreign-package',manifestHash:'manifest-version',manifest:{goal:'迁移三仓',createdAt:'2026-10-27T00:00:00Z',repos:[{repo:{id:'foreign-api',role:'接口',dependsOn:[]},directory:'api',files:{'main.ts':{hash:'source'}}}],bytes:10,unresolved:[],notes:[],materials:[],artifacts:[],memories:[],runtime:{checks:[],services:[],recipes:[]}}};
beforeEach(()=>{vi.clearAllMocks();useStore.setState({sessionPermissionMode:'ask'});useEngineering.setState({sessionPath:'/task',snapshot:{state:{idle:true},actions:[restore],overview:{repos:[{id:'current-unrelated'}]}}});});afterEach(cleanup);
it('uses package repository choices rather than the current project and pins inspected content with no default write grant',()=>{
 const action=packageRestoreAction(restore,value);expect(action.fields.find(f=>f.name==='writeRepos')).toMatchObject({source:undefined,value:[],items:[{value:'foreign-api',label:'foreign-api · 接口'}]});expect(action.fields.find(f=>f.name==='directory')).toMatchObject({kind:'record',value:'/foreign-package'});expect(action.fields.find(f=>f.name==='expectedManifest')?.value).toBe('manifest-version');
 render(<TaskPackageResult value={value} details={<p>HUGE_MANIFEST</p>}/>);expect(screen.queryByText('HUGE_MANIFEST')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'在新目录复现这份任务包'}));expect(showAction).toHaveBeenCalledWith(action);
});
it('shows unresolved source effects and does not offer an executable restore',()=>{
 render(<TaskPackageResult value={{...value,manifest:{...value.manifest,unresolved:['unknown']}}} details={null}/>);expect(screen.getByRole('button',{name:'在新目录复现这份任务包'})).toBeDisabled();expect(screen.getByText(/当前不能创建可执行/)).toBeVisible();
});
it('keeps imported permissions and unverified acceptance explicit',()=>{
 render(<RestoredPackageResult value={{goal:'迁移',workspace:'/new-project',repos:[{id:'api',access:'read'},{id:'sdk',access:'write'}],runtimeActivated:true,createdSession:{sessionPath:'/created'}}} details={null}/>);expect(screen.getByText('api · 只读')).toBeVisible();expect(screen.getByText(/原来源的通过结果没有计入/)).toBeVisible();expect(screen.getByRole('button',{name:'打开复现后的工作对话'})).toBeVisible();
});
