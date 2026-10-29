// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,render,screen,fireEvent,waitFor}from'@testing-library/react';
import{afterEach,beforeEach,expect,it,vi}from'vitest';
import{MemoryPanel}from'../Memory';
import{useEngineering,engineeringRequest,readRecordAction,showRecordAction}from'../state';
import{useStore}from'../../stores';
vi.mock('../state',async load=>({...await load<typeof import('../state')>(),engineeringRequest:vi.fn(),readRecordAction:vi.fn(),showRecordAction:vi.fn()}));
const mockDream=(runs:any[])=>vi.mocked(engineeringRequest).mockImplementation(async(route:string)=>route.startsWith('/data/memory')?{enabled:true,search:{items:[]}}:runs);
beforeEach(()=>{vi.clearAllMocks();useEngineering.setState({sessionPath:'/current',connectionId:'a',snapshot:{state:{idle:true},actions:[]}});useStore.setState({sessionPermissionMode:'ask'});});
afterEach(cleanup);
it('offers recovery for interrupted work and blocks resume after spending the request budget',async()=>{
 mockDream([{id:'lost',status:'running',runtimeState:'interrupted',sources:['source'],requests:1,maxRequests:2},{id:'spent',status:'paused',sources:['source'],requests:2,maxRequests:2}]);
 render(<MemoryPanel value={{enabled:true,search:{items:[]}}}/>);
 expect(await screen.findByText('整理进程已中断')).toBeVisible();expect(screen.getByRole('button',{name:'继续整理'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'核对中断的整理'}));await waitFor(()=>expect(engineeringRequest).toHaveBeenCalledWith('/memory-dream/control','/current',{id:'lost',action:'recover'}));
});
it('lets users read exactly the memory created by a completed consolidation',async()=>{
 mockDream([{id:'saved',status:'published',sources:['source'],requests:1,maxRequests:2,memories:['derived']}]);
 render(<MemoryPanel value={{enabled:true,search:{items:[]}}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'查看保存的记忆'}));expect(readRecordAction).toHaveBeenCalledWith('memory-read',{id:'derived'});
});
it('explains why a queued background job has made no model requests yet',async()=>{
 mockDream([{id:'waiting',status:'queued',waitingReason:'foreground',sources:['source'],requests:0,maxRequests:2}]);
 render(<MemoryPanel value={{enabled:true,search:{items:[]}}}/>);
 expect(await screen.findByText('等待主任务空闲')).toBeVisible();expect(screen.getByText(/排队期间不调用模型/)).toBeVisible();expect(screen.getByRole('button',{name:'取消'})).toBeEnabled();
});
it('pages all visible records and clears selected sources when moving to a different page',async()=>{
 const record=(id:string)=>({id,title:id,summary:'背景',freshness:'current',scope:{type:'task'},status:'user-stated'});
 vi.mocked(engineeringRequest).mockImplementation(async(route:string)=>route==='/memory-dream'?[]:{enabled:true,search:{items:[record(route.includes('offset=20')?'最后一页':'第一页')],total:21,more:!route.includes('offset=20')},drafts:{items:[],total:0}});
 render(<MemoryPanel value={{enabled:true,search:{items:[]}}}/>);await screen.findByText('第一页');expect(screen.getByText('仅此任务')).toBeVisible();
 fireEvent.click(screen.getByRole('checkbox',{name:'选择记忆 第一页'}));expect(screen.getByRole('button',{name:'整理所选记忆（1）'})).toBeEnabled();
 fireEvent.click(screen.getByRole('button',{name:'下一页'}));await screen.findByText('最后一页');expect(screen.getByRole('button',{name:'整理所选记忆（0）'})).toBeDisabled();expect(screen.getByText('显示 21–21 / 21 条可见记忆')).toBeVisible();
});
it('distinguishes evidence-only draft processing from model consolidation and pins the chosen draft',async()=>{
 useEngineering.setState({snapshot:{state:{idle:true},actions:[{id:'memory-organize'}]}});
 vi.mocked(engineeringRequest).mockImplementation(async(route:string)=>route==='/memory-dream'?[]:{enabled:true,search:{items:[]},drafts:{total:1,items:[{id:'draft-a',state:'queued',input:{title:'接口经验',content:'保留兼容性',scope:{type:'task'}}}]}});
 render(<MemoryPanel value={{enabled:true,search:{items:[]}}}/>);fireEvent.click(await screen.findByText('经验草稿 · 1 份'));
 expect(screen.getByText(/这是不调用模型的来源核对/)).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'核对并保存这份草稿'}));expect(showRecordAction).toHaveBeenCalledWith('memory-organize',{drafts:['draft-a']});
});
