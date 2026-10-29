// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {OperationResult} from '../OperationResult';
import {openEngineering} from '../state';
vi.mock('../state',async load=>({...await load<typeof import('../state')>(),openEngineering:vi.fn()}));
afterEach(cleanup);
it('shows an actual check outcome without claiming that the whole task is complete',()=>{
 const {rerender}=render(<OperationResult value={{status:'verified',evidence:'proof',results:[{check:'joint',repo:'api',status:'passed',output:'OK'}]}} details={null}/>);
 expect(screen.getByRole('status')).toHaveTextContent('项目检查已通过');expect(screen.getByRole('status')).toHaveTextContent('原要求、计划和其他任务仍需核对');
 rerender(<OperationResult value={{status:'failed',evidence:'failed-proof',results:[{check:'joint',repo:'api',status:'failed'}]}} details={null}/>);expect(screen.getByRole('status')).toHaveTextContent('项目检查未通过');
});
it('shows readable static source relationships while keeping raw evidence collapsed',()=>{
  render(<OperationResult value={{query:'alphaValue',scannedFiles:3,symbols:[{repo:'alpha',file:'index.js',line:1,snippet:'export function alphaValue() {}'}],references:[{repo:'beta',file:'index.js',line:2,kind:'call-site',owner:'betaValue',symbol:'alphaValue',confidence:'confirmed',snippet:'alphaValue()'}]}} details={<pre>raw-fingerprint</pre>}/>);
  expect(screen.getByText('1 个定义')).toBeVisible();expect(screen.getByText('1 个引用')).toBeVisible();expect(screen.getByText('静态绑定已确认')).toBeVisible();expect(screen.getByText('raw-fingerprint').closest('details')).not.toHaveAttribute('open');
  fireEvent.click(screen.getByRole('button',{name:'beta / index.js:2'}));expect(openEngineering).toHaveBeenCalledWith(expect.objectContaining({repo:'beta',file:'index.js',group:'reading'}));
});
it('keeps running operations understandable without presenting transport metadata as a result',()=>{
  render(<OperationResult value={{operation:{state:'running',title:'追踪代码',id:'opaque'}}} details={<pre>opaque</pre>}/>);expect(screen.getByRole('status')).toHaveTextContent('追踪代码正在运行');expect(screen.queryByText('opaque')).not.toBeInTheDocument();
});
it('explains a local listener denial without treating it as a passing or code assertion failure',()=>{
 render(<OperationResult value={{status:'failed',evidence:'proof',results:[{check:'http',repo:'app',status:'failed',output:'self.socket.bind(self.server_address)\nPermissionError: Operation not permitted'}]}} details={null}/>);expect(screen.getByText(/服务器监听被系统拒绝/)).toBeVisible();expect(screen.getByRole('status')).toHaveTextContent('项目检查未通过');
});

it('renders saved references and captured sources as readable outcomes without executing their text',()=>{
 const {rerender}=render(<OperationResult value={{role:'reference',id:'note',title:'项目背景',contentHash:'hash',revision:2,source:{kind:'note'},task:'task'}} details={null}/>);
 expect(screen.getByRole('status')).toHaveTextContent('仅此任务');fireEvent.click(screen.getByRole('button',{name:'打开保存的资料'}));expect(openEngineering).toHaveBeenCalledWith(expect.objectContaining({resource:'note'}));
 rerender(<OperationResult value={{sourceCapture:true,resource:{title:'局部来源',source:{capture:{at:'2026-10-27T00:00:00Z',provider:'lark',scope:'outline'}}},capture:{data:{content:'saved'}}}} details={null}/>);
 expect(screen.getByText(/局部内容不能当作整份文档/)).toBeVisible();expect(screen.getByText(/这是保存时的响应/)).toBeVisible();
 rerender(<OperationResult value={{available:false,question:'还在运行吗？',answer:'没有当前采集记录',usedModel:false}} details={null}/>);expect(screen.getByText('暂时无法判断运行状态')).toBeVisible();expect(screen.getByText(/没有调用模型/)).toBeVisible();
});
