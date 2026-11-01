// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {UsageAnalytics} from '../../components/usage/UsageAnalytics';
const report={totals:{requests:80,reportedRequests:79,missingRequests:1,failedRequests:2,input:1440,output:160,total:1600,cacheRead:640,cacheWrite:0,reasoning:0,reasoningReported:0},models:[],daily:[],sources:[],choices:{models:['test/fast','test/large'],sources:['session'],agents:[]},records:[],pagination:{offset:0,limit:50,total:80,hasMore:true},coverage:{retained:80,maximum:5000}};
afterEach(cleanup);
const choose=(name:string,option:string)=>{fireEvent.click(screen.getByRole('button',{name}));fireEvent.click(screen.getByRole('option',{name:option}));};
it('shows totals for the full scope and sends exact session/model filters',async()=>{
 const fetcher=vi.fn(async(_path:string)=>new Response(JSON.stringify(report)));render(<UsageAnalytics fetcher={fetcher} sessionPath="/session"/>);
 await screen.findByText('1,600');expect(screen.getByText(/1 次请求未返回用量/)).toBeVisible();expect(fetcher.mock.calls[0][0]).toContain('sessionPath=%2Fsession');
 choose('模型筛选','test/fast');await waitFor(()=>expect(fetcher.mock.calls.at(-1)![0]).toContain('model=test%2Ffast'));
 fireEvent.click(screen.getByRole('tab',{name:'请求明细'}));fireEvent.click(screen.getByRole('button',{name:'下一页'}));await waitFor(()=>expect(fetcher.mock.calls.at(-1)![0]).toContain('offset=50'));
 expect(screen.getByText('1,600')).toBeVisible();
});
it('shows per-request duration and distinguishes unreported details',async()=>{
 const row={requestId:'req-1',at:'2026-11-02T01:00:02Z',startedAt:'2026-11-02T01:00:00Z',endedAt:'2026-11-02T01:00:02Z',durationMs:2000,model:'test/fast',source:'session',operation:'reply',status:'ok',input:20,output:3,total:23,cacheRead:8,cacheWrite:0,cacheReported:true,reasoning:0,reasoningReported:0};
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({...report,records:[row]})));render(<UsageAnalytics fetcher={fetcher} sessionPath="/a"/>);await screen.findByText('1,600');
 fireEvent.click(screen.getByRole('tab',{name:'请求明细'}));fireEvent.click(screen.getByRole('button',{name:'请求明细 req-1'}));
 expect(screen.getByText('2 秒')).toBeVisible();expect(screen.getByText('8 / 0')).toBeVisible();expect(screen.getByText('未单独报告')).toBeVisible();
 expect(screen.getByRole('button',{name:'复制编号'})).toBeVisible();
});
it('exports the full filter instead of the current page and rejects late downloads after a scope change',async()=>{
 let resolveExport!:(response:Response)=>void;
 const fetcher=vi.fn(async(path:string)=>path.startsWith('/api/usage/export')?new Promise<Response>(resolve=>{resolveExport=resolve;}):new Response(JSON.stringify(report)));
 const {rerender}=render(<UsageAnalytics fetcher={fetcher} sessionPath="/a"/>);await screen.findByText('1,600');choose('模型筛选','test/fast');
 await waitFor(()=>expect(fetcher.mock.calls.at(-1)?.[0]).toContain('model=test%2Ffast'));
 fireEvent.click(screen.getByRole('tab',{name:'请求明细'}));fireEvent.click(screen.getByRole('button',{name:'下一页'}));await waitFor(()=>expect(fetcher.mock.calls.at(-1)?.[0]).toContain('offset=50'));
 fireEvent.click(screen.getByText('导出'));fireEvent.click(screen.getByRole('button',{name:'JSON 完整统计'}));
 const exportUrl=fetcher.mock.calls.at(-1)![0];expect(exportUrl).toContain('/api/usage/export?');expect(exportUrl).toContain('sessionPath=%2Fa');expect(exportUrl).toContain('model=test%2Ffast');expect(exportUrl).not.toContain('offset=');
 rerender(<UsageAnalytics fetcher={fetcher} sessionPath="/b"/>);
 await act(async()=>resolveExport(new Response('{"records":[]}',{headers:{'X-Enigma-Usage-Export':'1'}})));
 expect(screen.queryByText(/已生成当前筛选/)).not.toBeInTheDocument();
});
it('does not replace new-session results with a late old-session response',async()=>{
 let resolve!:(value:Response)=>void;
 const fetcher=vi.fn().mockImplementationOnce(()=>new Promise(r=>{resolve=r;})).mockImplementation(async()=>new Response(JSON.stringify({...report,totals:{...report.totals,total:77}})));
 const {rerender}=render(<UsageAnalytics fetcher={fetcher} sessionPath="/a"/>);rerender(<UsageAnalytics fetcher={fetcher} sessionPath="/b"/>);
 await screen.findByText('77');await act(async()=>resolve(new Response(JSON.stringify(report))));expect(screen.queryByText('1,600')).not.toBeInTheDocument();
});
it('requires both custom dates before querying and hides old totals on errors',async()=>{
 const fetcher=vi.fn(async(_path:string)=>new Response(JSON.stringify(report)));render(<UsageAnalytics fetcher={fetcher} sessionPath="/a"/>);await screen.findByText('1,600');choose('时间范围','自定义日期');
 expect(await screen.findByRole('alert')).toHaveTextContent('请选择开始日期');expect(screen.queryByText('1,600')).not.toBeInTheDocument();
});
