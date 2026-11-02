// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ConversationProgress} from '../../components/input/ConversationProgress';
import {PlanModeButton} from '../../components/input/PlanModeButton';
import {useStore} from '../../stores';
import {useChangesPanel} from '../../stores/changes-panel-store';
import {hanaFetch} from '../../hooks/use-hana-fetch';
vi.mock('../../hooks/use-hana-fetch',()=>({hanaFetch:vi.fn()}));
vi.mock('../../stores/desk-actions',()=>({toggleJianSidebar:vi.fn()}));
vi.mock('../../hooks/use-i18n',()=>({useI18n:()=>({t:(key:string)=>({'input.autoMode':'自动审核','input.askMode':'操作前询问','input.operateMode':'完整权限','input.readOnlyMode':'只读模式'}[key]||key)})}));
vi.mock('../../engineering/SurfaceMenu',()=>({SurfaceMenu:({label,children,icon}:any)=><section><button aria-label={label}>{icon}</button>{children}</section>}));
const timing=(state='running')=>({sessionPath:'/one',goal:{kind:'goal',state,startedAt:1000,elapsedMs:10000,objective:'Verify the project',revision:20,turnCount:2,maxTurns:50}});
beforeEach(()=>{
 useStore.setState({currentSessionPath:'/one',activeServerConnectionId:'local',connected:true,pendingNewSession:false,pendingSessionSwitchPath:null,streamingSessions:[]});
 useChangesPanel.setState({navigation:undefined});vi.clearAllMocks();
 vi.mocked(hanaFetch).mockImplementation(async(url,options)=>new Response(JSON.stringify(String(url).includes('/summary')?{files:[{repo:'project',file:'src/a.ts',added:2,removed:1}],added:2,removed:1,from:'start',to:'end',gaps:[]}:timing(options?.method==='POST'?'paused':'running'))));
});afterEach(cleanup);
it('shows the actual goal, controls it by revision and locates a selected changed file',async()=>{
 render(<ConversationProgress/>);expect(await screen.findByRole('button',{name:'目标详情'})).toHaveTextContent('Verify the project');
 fireEvent.click(screen.getByRole('button',{name:'暂停目标'}));await screen.findByRole('button',{name:'继续目标'});
 const post=vi.mocked(hanaFetch).mock.calls.find(([,o])=>o?.method==='POST');expect(JSON.parse(post![1]!.body as string)).toEqual({sessionPath:'/one',action:'pause',createdAt:1000,revision:20});
 fireEvent.click(screen.getByTitle('project / src/a.ts'));expect(useChangesPanel.getState().navigation).toMatchObject({session:'/one',view:'diff',from:'start',to:'end',repo:'project',file:'src/a.ts'});
 fireEvent.click(screen.getByRole('button',{name:'打开审查'}));expect(useChangesPanel.getState().navigation?.view).toBe('review');
});
it('does not show an old goal in another chat or optimistically apply a failed action',async()=>{
 render(<ConversationProgress/>);await screen.findByRole('button',{name:'目标详情'});
 vi.mocked(hanaFetch).mockImplementation(async(_,options)=>options?.method==='POST'?new Response(JSON.stringify({error:'目标状态已变化'}),{status:409}):new Response(JSON.stringify(timing())));
 fireEvent.click(screen.getByRole('button',{name:'暂停目标'}));expect(await screen.findByRole('alert')).toHaveTextContent('目标状态已变化');expect(screen.getByText('进行中的目标')).toBeVisible();
 act(()=>useStore.setState({currentSessionPath:'/two',connected:false}));expect(screen.queryByText('Verify the project')).toBeNull();
});
it('displays all four approval modes as visible text with distinct state identifiers',()=>{
 const view=render(<PlanModeButton mode="auto" onChange={vi.fn()}/>);
 for(const [mode,label] of [['auto','自动审核'],['operate','完整权限'],['ask','操作前询问'],['read_only','只读模式']] as const){view.rerender(<PlanModeButton mode={mode} onChange={vi.fn()}/>);expect(screen.getByRole('button',{name:label})).toHaveTextContent(label);expect(screen.getByRole('button',{name:label})).toHaveAttribute('data-approval-mode',mode);}
});
