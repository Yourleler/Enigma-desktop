// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {EnvironmentPanel,serviceEditAction} from '../Environment';
import {OperationResult} from '../OperationResult';
import {engineeringRequest,useEngineering,showRecordAction,type Action} from '../state';
import {useStore} from '../../stores';
vi.mock('../state',async load=>({...await load<typeof import('../state')>(),engineeringRequest:vi.fn(),showRecordAction:vi.fn()}));
const waiting={spec:{id:'wait-one',label:'等待服务',resume:true,condition:{kind:'service'}},state:{status:'waiting'},runtimeState:'interrupted'};
beforeEach(()=>{vi.useFakeTimers();vi.mocked(engineeringRequest).mockReset();useEngineering.setState({sessionPath:'/task',connectionId:'one',snapshot:{state:{idle:false}}});useStore.setState({sessionPermissionMode:'read_only'});});
afterEach(()=>{cleanup();vi.useRealTimers();});
it('explains a newly registered wait specification and a cancelled wait without implying target completion',()=>{
 const spec={id:'wait',label:'等待构建',condition:{kind:'background',run:'build'},fingerprint:'version',resume:false};
 const {rerender}=render(<OperationResult value={spec} details={null}/>);
 expect(screen.getByText('等待已登记：等待构建')).toBeVisible();expect(screen.getByText(/只记录结果，不自动发起下一轮/)).toBeVisible();
 rerender(<OperationResult value={{spec,state:{status:'cancelled'}}} details={null}/>);
 expect(screen.getByText(/目标运行没有被停止/)).toBeVisible();expect(screen.queryByText(/等待已登记/)).toBeNull();
});
it('refreshes terminal results in place and identifies a dead wait worker without claiming the target finished',async()=>{
 vi.mocked(engineeringRequest).mockResolvedValueOnce({waits:[waiting]}).mockResolvedValue({waits:[{...waiting,state:{status:'cancelled'},runtimeState:'settled'}]});
 await act(async()=>{render(<EnvironmentPanel initial={{}} evidence={()=>null}/>);});
 expect(screen.getByText('等待器已退出，未确认目标结果')).toBeVisible();expect(screen.getByRole('button',{name:'取消此等待'})).toBeEnabled();
 await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});expect(screen.getByText('等待已取消')).toBeVisible();expect(screen.queryByRole('button',{name:'取消此等待'})).not.toBeInTheDocument();
});
it('lets a user stop an owned wait while the main task is busy without invoking the main cancel operation',async()=>{
 vi.mocked(engineeringRequest).mockResolvedValue({waits:[waiting]});await act(async()=>{render(<EnvironmentPanel initial={{}} evidence={()=>null}/>);});
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'取消此等待'}));});
 expect(engineeringRequest).toHaveBeenCalledWith('/runtime/cancel','/task',{kind:'wait',id:'wait-one'});
 expect(vi.mocked(engineeringRequest).mock.calls.some(([route])=>route==='/cancel')).toBe(false);
});
it('shows concrete commands, offers restart after timeout and avoids duplicate current service rows',async()=>{
 const service={service:{id:'web',label:'应用服务',repo:'api',argv:['node','server.js'],readiness:{type:'http',includes:'ready',timeoutMs:100}},status:'readiness-timeout',run:'run-web',executionTerminal:false,configuration:'version',process:{output:'BOOTING'}};
 useStore.setState({sessionPermissionMode:'ask'});useEngineering.setState({snapshot:{state:{idle:true},actions:[{id:'service-start'},{id:'service-restart'}]}});vi.mocked(engineeringRequest).mockResolvedValue({services:[service],background:[{spec:{id:'run-web',label:'应用服务',kind:'service',argv:[]},state:{status:'running'}}]});
 await act(async()=>{render(<EnvironmentPanel initial={{}} evidence={()=>null}/>);});expect(screen.getAllByText('应用服务')).toHaveLength(1);expect(screen.getByText(/在规定时间内没有满足就绪条件/)).toBeVisible();fireEvent.click(screen.getByText('启动命令、依赖与就绪条件'));expect(screen.getByText('node server.js')).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'重启此服务'}));expect(showRecordAction).toHaveBeenCalledWith('service-restart',{id:'web'},{id:'应用服务'});
});
it('prefills service edits and shows acknowledged unknown effects without another confirmation action',async()=>{
 const edit={id:'service-add',fields:['id','version','argv','envFromServices'].map(name=>({name,label:name}))} as Action,service={service:{id:'web',label:'服务',argv:['node','app.js'],envFromServices:{API:{service:'api',value:'url'}}},configuration:'hash-1'};
 const action=serviceEditAction(edit,service);expect(action.fields.find(f=>f.name==='version')).toMatchObject({kind:'record',value:'hash-1'});expect(action.fields.find(f=>f.name==='envFromServices')?.value).toEqual([{name:'API',service:'api',value:'url'}]);
 vi.mocked(engineeringRequest).mockResolvedValue({background:[{spec:{id:'run',label:'已核对任务',repo:'api',argv:['node','work.js']},state:{status:'unknown'},terminal:true,reconciled:true,reconciliation:{observation:'已检查实际文件'}}]});
 await act(async()=>{render(<EnvironmentPanel initial={{}} evidence={()=>null}/>);});expect(screen.getByText('实际效果已核对')).toBeVisible();expect(screen.queryByRole('button',{name:'记录已核对的效果'})).toBeNull();
});
