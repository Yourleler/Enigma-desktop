// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {BrowserChecks,BrowserReportResult} from '../BrowserChecks';
import {useEngineering,showRecordAction,readRecordAction,openEngineering} from '../state';
vi.mock('../state',async load=>({...await load<typeof import('../state')>(),showRecordAction:vi.fn(),readRecordAction:vi.fn(),openEngineering:vi.fn()}));
beforeEach(()=>{vi.clearAllMocks();useEngineering.setState({sessionPath:'/task',connectionId:'local',snapshot:{state:{idle:true},actions:[{id:'browser-run'},{id:'browser-add'}]}});});afterEach(cleanup);
const report={id:'run',scenario:'form',scenarioLabel:'表单行为',status:'passed',steps:[{index:0,action:'click',status:'passed'}],errors:[],screenshots:['local.png'],artifacts:[{id:'shot',title:'结果截图',kind:'screenshot'}],createdAt:'2026-10-27T00:00:00Z'};
it('requires a ready service and pins the selected browser scenario, with direct report access',async()=>{
 const value={services:[{service:{id:'web',label:'服务'},ready:false}],scenarios:[{id:'form',label:'表单',service:'web',steps:[{action:'click',selector:'#go'}]}],browserReports:{items:[{report}],total:1}};
 const {rerender}=render(<BrowserChecks value={value} blocked={false}/>);expect(screen.getByRole('button',{name:'运行这个场景'})).toBeDisabled();
 rerender(<BrowserChecks value={{...value,services:[{...value.services[0],ready:true}]}} blocked={false}/>);fireEvent.click(screen.getByRole('button',{name:'运行这个场景'}));expect(showRecordAction).toHaveBeenCalledWith('browser-run',{id:'form'},{id:'表单'});
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'查看本次浏览器报告'}));});expect(readRecordAction).toHaveBeenCalledWith('browser-report',{id:'run'});
});
it('shows stale reports and opens saved screenshot artifacts rather than re-running a browser',()=>{
 render(<BrowserReportResult value={{report,sourceCurrent:false,configurationCurrent:true,serviceCurrent:false,serviceReady:false}} details={null}/>);expect(screen.getByText(/旧结果不能算作当前验收/)).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'结果截图'}));expect(openEngineering).toHaveBeenCalledWith({id:'artifact:shot',title:'结果截图',group:'artifacts',artifact:'shot'});expect(showRecordAction).not.toHaveBeenCalled();
});
