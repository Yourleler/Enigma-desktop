// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {TaskMaps,MapCoverageResult,mapAnnotationAction} from '../TaskMaps';
import {engineeringRequest,useEngineering,showAction,showRecordAction,type Action} from '../state';
import {useStore} from '../../stores';
vi.mock('../state',async load=>({...await load<typeof import('../state')>(),engineeringRequest:vi.fn(),showAction:vi.fn(),showRecordAction:vi.fn()}));
const report={id:'map-a',revision:2,goal:'理解跨仓消费链',createdAt:'2026-10-27T00:00:00Z',nodes:[{id:'node-a',role:'entry',source:{repo:'api',file:'index.ts',line:4,symbol:'start',hash:'sourcehash',snippet:'export const start = 1'}}],edges:[],path:[{order:1,node:'node-a'}],architecture:[],requirements:[{id:'req',text:'保留兼容性',status:'unassessed',checks:['joint']}],insights:[],gaps:[]};
const annotate={id:'map-annotate',fields:[{name:'id',label:'map',source:'taskMaps'},{name:'revision',label:'版本'},{name:'insights',label:'说明',kind:'rows',fields:[{name:'anchors',label:'来源节点 ID',kind:'lines'}]},{name:'requirements',label:'要求',kind:'rows',fields:[{name:'id',label:'要求 ID'},{name:'anchors',label:'来源节点 ID'}]}]} as Action;
beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();useStore.setState({sessionPermissionMode:'ask',pendingSessionSwitchPath:null});useEngineering.setState({sessionPath:'/task',connectionId:'one',snapshot:{state:{idle:true},actions:[annotate,{id:'map-build'},{id:'map-coverage'}]}});vi.mocked(engineeringRequest).mockResolvedValue({items:[{report,current:true,issues:[]}]});});afterEach(()=>{cleanup();vi.useRealTimers();});
it('offers a named map, source snippets and direct scoped coverage instead of requiring opaque IDs',async()=>{
 await act(async()=>{render(<TaskMaps/>);});expect(screen.getByText('理解跨仓消费链')).toBeVisible();fireEvent.click(screen.getByText(/1. 入口 · api/));expect(screen.getByText('export const start = 1')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'核对这份地图的覆盖'}));expect(showRecordAction).toHaveBeenCalledWith('map-coverage',{id:'map-a'},{id:'理解跨仓消费链'});
 fireEvent.click(screen.getByRole('button',{name:'补充说明与风险'}));expect(showAction).toHaveBeenCalledWith(expect.objectContaining({title:'保存地图说明'}));
 vi.mocked(engineeringRequest).mockResolvedValue({items:[{report,current:false,issues:['源码已变化']}]});await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});expect(screen.getByRole('button',{name:'补充说明与风险'})).toBeDisabled();expect(screen.getByText('export const start = 1')).toBeVisible();
});
it('uses source labels for annotation choices and pins the selected map revision',()=>{
 const action=mapAnnotationAction(annotate,report);expect(action.fields[0]).toMatchObject({kind:'record',value:'map-a',source:undefined});expect(action.fields[1].value).toBe(2);
 expect(action.fields[2].fields?.[0]).toMatchObject({kind:'multi',items:[{value:'node-a',label:'api / index.ts:4 · start'}]});expect(action.fields[3].fields?.[0].items).toEqual([{value:'req',label:'保留兼容性'}]);
});
it('jumps from a cited source to a node beyond the first page and clears an incompatible filter',async()=>{
 const nodes=Array.from({length:41},(_,index)=>({id:`node-${index}`,role:'entry',source:{repo:'api',file:`source-${index}.ts`,line:1,symbol:`start${index}`,snippet:`const start${index} = ${index};`}}));
 vi.mocked(engineeringRequest).mockResolvedValue({items:[{report:{...report,nodes,path:nodes.map(node=>({node:node.id})),insights:[{title:'尾部来源',text:'依据最后一个源码节点',anchors:['node-40']}]},current:true,issues:[]}]});
 await act(async()=>{render(<TaskMaps/>);});
 fireEvent.change(screen.getByLabelText('筛选地图源码节点'),{target:{value:'source-0'}});
 fireEvent.click(screen.getByRole('button',{name:'api / source-40.ts:1 · start40'}));
 expect(screen.getByText('const start40 = 40;')).toBeVisible();expect(screen.getByLabelText('筛选地图源码节点')).toHaveValue('');
 expect(document.activeElement).toHaveTextContent('source-40.ts');
});
it('shows source assessment and actual check status separately',()=>{
 render(<MapCoverageResult value={{map:'map-a',goal:'目标',current:false,requirements:[{id:'r',text:'兼容',status:'supported',checksPassed:true}]}} details={null}/>);
 expect(screen.getByText(/地图来源已变化/)).toBeVisible();expect(screen.getByText(/源码说明支持 · 关联检查已实际通过/)).toBeVisible();
});
