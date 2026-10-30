// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';import {act,cleanup,render,screen} from '@testing-library/react';import '@testing-library/jest-dom/vitest';
import {RunActivity} from '../../components/chat/RunActivity';import {useTokenMeterStore,tokenMeterKey} from '../../components/input/token-meter-store';import {useStore} from '../../stores';
afterEach(()=>{cleanup();vi.useRealTimers();});
it('shows observed parameter generation and admits a lack of progress without declaring completion',()=>{
 vi.useFakeTimers();vi.setSystemTime(20000);useStore.setState({connected:true,activeServerConnectionId:'test'});
 useTokenMeterStore.setState({metersBySession:{[tokenMeterKey('test','/task')]:{state:'running',phase:'writing',runId:1,startedAt:1000,sampledAt:20000,endedAt:null,elapsedMs:19000,model:null,requests:1,up:{tokens:4,estimated:true},down:{tokens:3,estimated:true},rate:1,cacheRead:0,cacheWrite:0,activity:{kind:'preparing-tool',toolName:'write',at:15000}}}});
 render(<RunActivity sessionPath="/task"/>);expect(screen.getByRole('status')).toHaveTextContent('正在准备工具调用');expect(screen.getByText('模型正在生成调用参数，工具尚未执行')).toBeInTheDocument();
 act(()=>vi.advanceTimersByTime(7000));expect(screen.getByRole('status')).toHaveTextContent('状态待确认');
});
