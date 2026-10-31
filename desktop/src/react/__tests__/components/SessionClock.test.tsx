// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {SessionClock} from '../../components/chat/SessionClock';
import {useStore} from '../../stores';
import {useTokenMeterStore} from '../../components/input/token-meter-store';
import {hanaFetch} from '../../hooks/use-hana-fetch';
vi.mock('../../hooks/use-hana-fetch',()=>({hanaFetch:vi.fn()}));
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(100000);useStore.setState({currentSessionPath:'/a',activeServerConnectionId:'local',connected:true,welcomeVisible:false});useTokenMeterStore.setState({metersBySession:{}});});
afterEach(()=>{cleanup();vi.useRealTimers();});
const snapshot=(state='running')=>({sessionPath:'/a',createdAt:1000,sampledAt:100000,run:null,goal:{kind:'goal',state,startedAt:90000,elapsedMs:10000},conductor:null});
it('shows permanent start and live elapsed time, freezes on disconnect and never leaks the previous conversation',async()=>{
 vi.mocked(hanaFetch).mockResolvedValue(new Response(JSON.stringify(snapshot())));
 render(<SessionClock/>);await act(async()=>{});expect(screen.getByTestId('session-clock')).toHaveTextContent('对话开始');expect(screen.getByText('00:10')).toBeVisible();
 await act(async()=>{vi.advanceTimersByTime(1000);});expect(screen.getByText('00:11')).toBeVisible();
 act(()=>useStore.setState({connected:false}));await act(async()=>{vi.advanceTimersByTime(5000);});expect(screen.getByTestId('session-clock')).toHaveTextContent('状态待同步');
 act(()=>useStore.setState({currentSessionPath:'/b'}));expect(screen.getByTestId('session-clock')).not.toHaveTextContent('Goal');
});
it('does not advance completed or paused task time',async()=>{
 vi.mocked(hanaFetch).mockImplementation(async()=>new Response(JSON.stringify(snapshot('paused'))));render(<SessionClock/>);await act(async()=>{});
 await act(async()=>{vi.advanceTimersByTime(2000);});expect(screen.getByText('00:10')).toBeVisible();expect(screen.getByTestId('session-clock')).toHaveTextContent('已暂停');
});
it('removes finished run clocks from the header but keeps the conversation start',async()=>{
 vi.mocked(hanaFetch).mockResolvedValue(new Response(JSON.stringify({...snapshot(),goal:null,run:{kind:'conversation',state:'done',startedAt:90000,elapsedMs:10000}})));
 render(<SessionClock/>);await act(async()=>{});
 expect(screen.getByTestId('session-clock')).toHaveTextContent('对话开始');
 expect(screen.getByTestId('session-clock')).not.toHaveTextContent('本轮');
 expect(screen.queryByText('00:10')).not.toBeInTheDocument();
});
it('keeps start and elapsed time visible in the single titlebar with full dates in its hint',async()=>{
 vi.mocked(hanaFetch).mockResolvedValue(new Response(JSON.stringify(snapshot())));
 render(<SessionClock compact inline/>);await act(async()=>{});
 expect(screen.getByTestId('session-clock')).toHaveTextContent('开始');
 expect(screen.getByText('00:10')).toBeVisible();
 expect(screen.getByTestId('session-clock').getAttribute('data-tooltip')).toContain('Goal 循环');
});
