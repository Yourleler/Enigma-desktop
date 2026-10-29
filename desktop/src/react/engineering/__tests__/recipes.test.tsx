// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {RecipesPanel,recipeEditAction,recipeRunAction} from '../Recipes';
import {engineeringRequest,showAction,showRecordAction,readRecordAction,useEngineering,type Action} from '../state';
import {useStore} from '../../stores';
import {activeFieldValues,validateFields} from '../form-fields';
vi.mock('../state',async load=>({...await load<typeof import('../state')>(),engineeringRequest:vi.fn(),showAction:vi.fn(),showRecordAction:vi.fn(),readRecordAction:vi.fn()}));
const save={id:'recipe-save',title:'创建 / 编辑配方',fields:['id','label','revision','timeoutMs','steps','parameters'].map(name=>({name,label:name}))} as Action;
const run={id:'recipe-run',title:'运行配方',fields:[{name:'id',label:'配方',source:'recipes'},{name:'version',label:'版本'},{name:'parameters',label:'输入参数'}]} as Action;
const recipe={id:'sample',label:'联合检查',revision:3,version:'version-3',timeoutMs:60000,steps:[{id:'echo',kind:'command',repo:'api',argv:['node','say.cjs','{{message}}']},{id:'verify',kind:'verify'}],parameters:{message:{description:'本次消息'},empty:{description:'可为空',default:''}}};
beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();useStore.setState({sessionPermissionMode:'ask'});useEngineering.setState({sessionPath:'/task',connectionId:'a',snapshot:{state:{idle:true},actions:[save,run]}});vi.mocked(engineeringRequest).mockResolvedValue({recipes:[recipe],runs:[]});});afterEach(()=>{cleanup();vi.useRealTimers();});
it('prefills editable recipes with their revision and preserves literal parameter defaults',()=>{
 const action=recipeEditAction(save,recipe),values=Object.fromEntries(action.fields.map(field=>[field.name,field.value]));expect(values.revision).toBe(3);expect(values.parameters).toEqual([{name:'message',description:'本次消息'},{name:'empty',description:'可为空',default:''}]);expect(values.steps).toEqual(recipe.steps);
});
it('builds a pinned run form with descriptive fields and validates required parameters',()=>{
 const action=recipeRunAction(run,recipe);expect(action.fields.find(field=>field.name==='version')?.value).toBe('version-3');expect(action.fields.find(field=>field.name==='parameters')?.fields?.[0].help).toBe('本次消息');
 expect(validateFields(action.fields,{parameters:{empty:''}})).toContain('message');
 const args=activeFieldValues(action.fields,{parameters:{message:'hello world',empty:''}});expect(args).toEqual({id:'sample',version:'version-3',parameters:{message:'hello world',empty:''}});
});
it('opens concrete edit/run forms and updates running receipts in place',async()=>{
 await act(async()=>{render(<RecipesPanel initial={{recipes:[recipe],runs:[]}} evidence={()=>null}/>);});
 fireEvent.click(screen.getByRole('button',{name:'编辑配方'}));expect(showAction).toHaveBeenCalledWith(expect.objectContaining({title:'保存配方修改'}));fireEvent.click(screen.getByRole('button',{name:'运行此配方'}));expect(showAction).toHaveBeenCalledWith(expect.objectContaining({title:'确认运行配方'}));
 vi.mocked(engineeringRequest).mockResolvedValue({recipes:[recipe],runs:[{status:'passed',current:false,run:{id:'run',recipe:'sample',revision:3,steps:[],createdAt:'2026-10-27T00:00:00Z'}}]});
 await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});expect(screen.getByText('原运行通过，当前来源或依据已变化')).toBeVisible();
});
it('shows stop only for the currently running recipe and keeps writes disabled in read-only mode',async()=>{
 useStore.setState({sessionPermissionMode:'read_only'});useEngineering.setState({snapshot:{state:{idle:false,operation:{state:'running',title:'运行配方'}},actions:[save,run]}});
 await act(async()=>{render(<RecipesPanel initial={{recipes:[recipe],runs:[]}} evidence={()=>null}/>);});expect(screen.getByRole('button',{name:'编辑配方'})).toBeDisabled();expect(screen.getByRole('button',{name:'运行此配方'})).toBeDisabled();
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'停止当前配方'}));});expect(engineeringRequest).toHaveBeenCalledWith('/cancel','/task',{});
});
it('explains proposal prerequisites and changes a saved draft into an edit action',async()=>{
 useEngineering.setState({snapshot:{state:{idle:true},actions:[save,run,{id:'recipe-propose'}]}});
 const proposal={id:'draft',input:recipe,createdAt:'2026-10-27T00:00:00Z',origin:{evidence:['check']},goals:[{step:'s',repo:'api',goal:'原检查通过',checks:['joint']}],sourceCurrent:true};
 vi.mocked(engineeringRequest).mockResolvedValue({recipes:[],runs:[],proposals:[proposal],proposalPlan:{eligible:false,completed:0,total:1}});
 await act(async()=>{render(<RecipesPanel initial={{}} evidence={()=>null}/>);});expect(screen.getByRole('button',{name:'从成功任务提取配方'})).toBeDisabled();
 fireEvent.click(screen.getByText('提炼记录 · 1 份待完善 · 0 份已保存'));expect(screen.getByText(/api · 原检查通过/)).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'补充并保存草稿'}));expect(showAction).toHaveBeenCalledWith(expect.objectContaining({title:'保存为新配方'}));
 vi.mocked(engineeringRequest).mockResolvedValue({recipes:[recipe],runs:[],proposals:[{...proposal,savedRecipe:recipe,sourceCurrent:false}],proposalPlan:{eligible:false,completed:0,total:1}});
 await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});expect(screen.queryByRole('button',{name:'补充并保存草稿'})).not.toBeInTheDocument();expect(screen.getByText('已保存为配方 · 修订 3')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'编辑已保存的配方'}));expect(showAction).toHaveBeenLastCalledWith(expect.objectContaining({title:'保存配方修改',fields:expect.arrayContaining([expect.objectContaining({name:'revision',value:3})])}));
});
it('pins the interrupted owner and removes repeated reconciliation after its occupancy is cleared',async()=>{
 useEngineering.setState({snapshot:{state:{idle:true},actions:[save,run,{id:'recipe-reconcile'},{id:'recipe-report'}]}});
 const interrupted={recipes:[recipe],runs:[{status:'unknown',run:{id:'run',recipe:'sample',revision:3,steps:[{id:'wait',kind:'command',state:'running'}],createdAt:'2026-10-27T00:00:00Z'}}],interruption:{token:'owner-a',recipe:'sample',canReconcile:true}};
 vi.mocked(engineeringRequest).mockResolvedValue(interrupted);await act(async()=>{render(<RecipesPanel initial={{}} evidence={()=>null}/>);});
 fireEvent.click(screen.getByRole('button',{name:'核对中断配方'}));expect(showRecordAction).toHaveBeenCalledWith('recipe-reconcile',{owner:'owner-a'},{owner:'联合检查'});
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'查看本次运行报告'}));});expect(readRecordAction).toHaveBeenCalledWith('recipe-report',{id:'run'});
 vi.mocked(engineeringRequest).mockResolvedValue({...interrupted,interruption:null});await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
 expect(screen.queryByRole('button',{name:'核对中断配方'})).not.toBeInTheDocument();expect(screen.getByText(/当前已无待释放的配方占用/)).toBeVisible();expect(screen.getByText('运行结果待核对，不能自动重放')).toBeVisible();expect(screen.getByText('wait · 中断时仍在执行，结果待核对')).toBeVisible();
});
