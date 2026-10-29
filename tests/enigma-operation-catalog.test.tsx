// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {uiActions} from '../packages/enigma-engineering/dist/src/workbench-domain.js';
import {ActionCatalog} from '../desktop/src/react/engineering/ActionCatalog';
import {useEngineering} from '../desktop/src/react/engineering/state';
import {enumLabel,MultiChoice,validateFields,activeFieldValues,resolveFieldValues} from '../desktop/src/react/engineering/form-fields';
import {createGlassMap} from '../desktop/src/react/ui/liquid-glass-map';
beforeEach(()=>{vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});useEngineering.setState({snapshot:{state:{idle:true},actions:uiActions}});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('makes every registered engineering action discoverable, with restoration routed through preview',()=>{
 const {container}=render(<ActionCatalog close={()=>{}}/>);
 const rows=[...container.ownerDocument.querySelectorAll('[data-action-id]')];
 expect(new Set(rows.map(el=>el.getAttribute('data-action-id')))).toEqual(new Set(uiActions.map(a=>a.id)));
 expect(screen.getByText('确认恢复代码 · 先选择快照并预览')).toBeVisible();
 for(const action of uiActions){expect(action.title.trim()).not.toBe('');expect(action.description.trim()).not.toBe('');}
});
it('supports plain checkbox selection and validates required multi/row fields without hidden unrelated inputs',()=>{
 const change=vi.fn();render(<MultiChoice label="可写仓库" options={[{value:'api',label:'API 服务'}]} value={[]} change={change}/>);
 fireEvent.click(screen.getByRole('checkbox',{name:'API 服务'}));expect(change).toHaveBeenCalledWith(['api']);
 expect(validateFields([{name:'repos',label:'仓库',kind:'multi',required:true}],{repos:[]})).toContain('仓库');
 expect(validateFields([{name:'steps',label:'步骤',kind:'rows',required:true,fields:[{name:'argv',label:'命令',required:true,when:{field:'kind',values:['command']}}]}],{steps:[{kind:'verify'}]})).toBeUndefined();
 const identifier={name:'id',label:'步骤编号',kind:'identifier',required:true};
 expect(validateFields([identifier],{id:'接口检查'})).toContain('英文字母');
 expect(validateFields([identifier],{id:'api-check'})).toBeUndefined();
 expect(validateFields([{name:'steps',label:'步骤',kind:'rows',fields:[identifier]}],{steps:[{id:'../escape'}]})).toContain('第 1 项');
 expect(enumLabel('verified')).toBe('已验收');
});
it('generates a bounded neutral-center displacement map with opposite edge directions',()=>{
 const map=createGlassMap(800,200,20);expect(map.width).toBeLessThanOrEqual(320);expect(map.height).toBe(80);
 const center=(40*map.width+160)*4;expect(map.pixels[center]).toBe(128);expect(map.pixels[center+1]).toBe(128);
 const left=(40*map.width+3)*4,right=(40*map.width+map.width-4)*4;
 expect(map.pixels[left]).toBeGreaterThan(128);expect(map.pixels[right]).toBeLessThan(128);
});

it('renders every registered action form without missing schema widget types',async()=>{
 const {ActionDialog}=await import('../desktop/src/react/engineering/Engineering');
 const choices=Object.fromEntries(['repos','checks','entries','checkpoints','services','background','waits','delegations','experiments','materials','artifacts','recipes','recipeRuns','scenarios','mergePreviews','browserReports'].map(key=>[key,[{id:'sample',label:'示例记录',createdAt:'2026-10-26T00:00:00Z'}]]));
 for(const action of uiActions){
   useEngineering.setState({sessionPath:'audit',formSession:'audit',form:action,choices,formLoading:false,formError:''});
   const {unmount}=render(<ActionDialog/>);
   expect(screen.getByRole('dialog',{name:action.title})).toBeVisible();
   expect(screen.getByRole('button',{name:action.title})).toBeVisible();
   unmount();
 }
});
it('uses named service definitions inside live status records for service and browser form choices',async()=>{
 const {ActionDialog}=await import('../desktop/src/react/engineering/Engineering');
 const action=uiActions.find(a=>a.id==='browser-add')!;
 useEngineering.setState({sessionPath:'audit',formSession:'audit',form:action,choices:{services:[{service:{id:'web',label:'本地服务'},status:'ready',run:'process-a'}]},formLoading:false,formError:''});
 render(<ActionDialog/>);const select=screen.getByRole('button',{name:'已配置服务'});fireEvent.click(select);fireEvent.click(screen.getByRole('option',{name:'本地服务'}));expect(select).toHaveTextContent('本地服务');
});

it('switching dependency target loads its actual prior dependencies and excludes itself',async()=>{
 const {ActionDialog}=await import('../desktop/src/react/engineering/Engineering');const action=uiActions.find(a=>a.id==='repo-dependencies')!;
 useEngineering.setState({sessionPath:'audit',formSession:'audit',form:action,choices:{repos:[{id:'api',dependsOn:[]},{id:'client',dependsOn:['api']}]},formLoading:false,formError:''});render(<ActionDialog/>);
 fireEvent.click(screen.getByRole('button',{name:'仓库'}));fireEvent.click(screen.getByRole('option',{name:'client'}));expect(screen.getByRole('checkbox',{name:'api'})).toBeChecked();expect(screen.queryByRole('checkbox',{name:'client'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'仓库'}));fireEvent.click(screen.getByRole('option',{name:'api'}));expect(screen.getByRole('checkbox',{name:'client'})).not.toBeChecked();expect(screen.queryByRole('checkbox',{name:'api'})).toBeNull();
});

it('shows and requires the default background wait target before the source is ever changed',async()=>{
 const {ActionDialog}=await import('../desktop/src/react/engineering/Engineering');
 const action=uiActions.find(a=>a.id==='wait-start')!;
 useEngineering.setState({sessionPath:'audit',formSession:'audit',form:action,choices:{background:[{id:'job-a',label:'本地检查'}]},formLoading:false,formError:''});
 render(<ActionDialog/>);
 expect(screen.getByRole('button',{name:'来源'})).toHaveTextContent('后台');
 expect(screen.getByRole('button',{name:'选择后台运行'})).toBeVisible();
 expect(validateFields(action.fields,{label:'等待本地检查'})).toContain('选择后台运行');
 fireEvent.click(screen.getByRole('button',{name:'选择后台运行'}));fireEvent.click(screen.getByRole('option',{name:'本地检查'}));
 expect(screen.getByRole('button',{name:'选择后台运行'})).toHaveTextContent('本地检查');
 fireEvent.click(screen.getByRole('button',{name:'来源'}));expect(screen.getByRole('option',{name:'委派子任务'})).toBeInTheDocument();fireEvent.click(screen.getByRole('option',{name:'项目服务'}));
 expect(screen.queryByRole('button',{name:'选择后台运行'})).toBeNull();
 expect(activeFieldValues(action.fields,{label:'等待本地检查',condition:{run:'job-a'}})).toMatchObject({condition:{kind:'background',run:'job-a'}});
});

it('submits displayed nested readiness defaults and preserves explicit false, zero and empty text without inventing rows',()=>{
 const service=uiActions.find(a=>a.id==='service-add')!;
 expect(activeFieldValues(service.fields,{id:'web',label:'页面',repo:'app',argv:['node','server.cjs']})).toMatchObject({readiness:{type:'http'}});
 const fields=[{name:'object',label:'配置',kind:'object',fields:[{name:'enabled',label:'启用',value:true},{name:'port',label:'端口',value:123},{name:'text',label:'文本',value:'default'}]},{name:'steps',label:'步骤',kind:'rows',fields:[{name:'kind',label:'类型',value:'command'}]}];
 expect(resolveFieldValues(fields,{object:{enabled:false,port:0,text:''}})).toEqual({object:{enabled:false,port:0,text:''}});
 expect(activeFieldValues(fields,{steps:[{}]})).toMatchObject({steps:[{kind:'command'}]});
});

it('keeps the independent status entry available while the main task is running',()=>{
 useEngineering.setState({snapshot:{state:{idle:false},actions:uiActions}});
 render(<ActionCatalog close={()=>{}}/>);
 expect(screen.getByRole('button',{name:/询问运行状态 · 不打断当前任务/})).toBeEnabled();
 expect(screen.getByRole('button',{name:/加入仓库/})).toBeDisabled();
});
it('finds dedicated supervision and model settings even though they are not domain action forms',()=>{
 render(<ActionCatalog close={()=>{}}/>);
 const query=screen.getByRole('textbox',{name:'搜索工程操作'});fireEvent.change(query,{target:{value:'托管'}});expect(screen.getByRole('button',{name:/托管与独立诊断/})).toBeEnabled();
 fireEvent.change(query,{target:{value:'多模型'}});expect(screen.getByRole('button',{name:/多模型分工与切换/})).toBeVisible();
 fireEvent.change(query,{target:{value:'做梦'}});expect(screen.getByRole('button',{name:/记忆整理与反馈/})).toBeVisible();
});

it('does not submit hidden fields from the previously selected operation variant',()=>{
 const action=uiActions.find(a=>a.id==='changes-build')!;
 const clean=activeFieldValues(action.fields,{goal:'read',kind:'staged',url:'https://example.invalid/old',fetch:true,target:{api:'old'},base:{api:'main'}});
 expect(clean).toEqual({goal:'read',kind:'staged'});
 const nested=activeFieldValues([{name:'steps',label:'步骤',kind:'rows',fields:[{name:'kind',label:'类型'},{name:'selector',label:'元素',when:{field:'kind',values:['click']}}]}],{steps:[{kind:'screenshot',selector:'#hidden'}]});
 expect(nested).toEqual({steps:[{kind:'screenshot'}]});
});

it('shows the read-only restriction before a mutating form can be submitted',async()=>{
 const {ActionDialog}=await import('../desktop/src/react/engineering/Engineering');
 const {useStore}=await import('../desktop/src/react/stores');useStore.setState({sessionPermissionMode:'read_only'});
 const action=uiActions.find(a=>a.id==='repo-add')!;
 useEngineering.setState({sessionPath:'readonly',formSession:'readonly',form:action,choices:{},formLoading:false,formError:''});
 try{render(<ActionDialog/>);expect(screen.getByRole('button',{name:action.title})).toBeDisabled();expect(screen.getByText(/当前对话为只读模式/)).toBeVisible();}
 finally{useStore.setState({sessionPermissionMode:'ask'});}
});
