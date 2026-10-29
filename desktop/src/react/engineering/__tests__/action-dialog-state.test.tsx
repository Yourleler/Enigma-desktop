// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import{act,cleanup,render,screen,fireEvent}from'@testing-library/react';
import{afterEach,beforeEach,expect,it,vi}from'vitest';
import{ActionDialog}from'../Engineering';
import{useEngineering,submitAction,showAction}from'../state';
import{useStore}from'../../stores';
vi.mock('../state',async load=>({...await load<typeof import('../state')>(),submitAction:vi.fn()}));
const action={id:'record',title:'编辑记录',group:'project',description:'修改选中的记录',fields:[{name:'title',label:'名称',value:'原记录'}]};
beforeEach(()=>{vi.clearAllMocks();useStore.setState({sessionPermissionMode:'ask'});useEngineering.setState({sessionPath:'/current',connectionId:'one',form:undefined,formLoading:false,formError:''});});afterEach(cleanup);
it('shows a fixed record name while submitting its selected identity without an editable ID field',()=>{
 const form={...action,id:'material-refresh',fields:[{name:'id',label:'资料',kind:'record',displayValue:'接口设计',value:'outside-page',required:true}]};
 useEngineering.setState({form,formSession:'/current',choices:{}});render(<ActionDialog/>);
 expect(screen.getByText('接口设计')).toBeVisible();expect(screen.queryByRole('textbox')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'编辑记录'}));expect(submitAction).toHaveBeenCalledWith(form,{id:'outside-page'});
});
it('keeps merge records selectable when spec is a fingerprint rather than a nested object',()=>{
 const form={...action,id:'delegate-merge',title:'应用已预览结果',fields:[{name:'id',label:'选择预览',kind:'select',source:'mergePreviews',value:'merge-current',required:true}]};
 useEngineering.setState({form,formSession:'/current',choices:{mergePreviews:[{id:'merge-current',spec:'opaque-fingerprint',createdAt:'2026-10-27T00:00:00Z',changes:[{repo:'api',file:'index.js'}]}]}});
 render(<ActionDialog/>);expect(screen.getByRole('button',{name:'选择预览'})).toHaveTextContent('1 个文件');
 fireEvent.click(screen.getByRole('button',{name:'选择预览'}));
 fireEvent.click(screen.getByRole('option',{name:/1 个文件/}));
 fireEvent.click(screen.getByRole('button',{name:'应用已预览结果'}));expect(submitAction).toHaveBeenCalledWith(form,{id:'merge-current'});
});
it('does not show a late submission failure in a newly opened form',async()=>{
 let reject!:(e:Error)=>void;vi.mocked(submitAction).mockImplementationOnce(()=>new Promise((_resolve,r)=>{reject=r;}));
 await showAction(action);render(<ActionDialog/>);fireEvent.click(screen.getByRole('button',{name:'编辑记录'}));
 fireEvent.click(screen.getByRole('button',{name:'关闭 编辑记录'}));await act(async()=>{await showAction({...action,fields:[{name:'title',label:'名称',value:'另一条记录'}]});});
 await act(async()=>reject(new Error('旧提交失败')));expect(screen.queryByText('旧提交失败')).not.toBeInTheDocument();expect(screen.getByLabelText('名称')).toHaveValue('另一条记录');expect(screen.getByRole('button',{name:'编辑记录'})).toBeEnabled();
});
it('refreshing choices preserves typed arguments instead of resetting to defaults',async()=>{
 await showAction(action);render(<ActionDialog/>);fireEvent.change(screen.getByLabelText('名称'),{target:{value:'用户已填写'}});
 await act(async()=>{await showAction(action,true);});expect(screen.getByLabelText('名称')).toHaveValue('用户已填写');
});
