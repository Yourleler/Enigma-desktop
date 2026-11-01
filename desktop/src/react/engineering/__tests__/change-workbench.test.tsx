// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {ChangeWorkbench,changeMatches} from '../ChangeWorkbench';
import {useStore} from '../../stores';
import {hanaFetch} from '../../hooks/use-hana-fetch';
vi.mock('../../hooks/use-hana-fetch',()=>({hanaFetch:vi.fn()}));
vi.mock('../DiffReader',()=>({DiffReader:({change}:any)=><pre>{change?.after?.content}</pre>}));
const publication={id:'source',version:'version',createdAt:'2026-10-31',current:true,input:{source:'conversation'},roots:[{id:'repo',name:'project'}],changes:[{repo:'repo',file:'src/a.ts',change:'modified',before:{content:'old'},after:{content:'new'},attribution:'verified-write'},{repo:'repo',file:'docs/note.md',change:'added',after:{content:'note'},attribution:'unattributed'}],gaps:[],requirements:[]};
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();useStore.setState({currentSessionPath:'/one',activeServerConnectionId:'local',models:[],sessionPermissionMode:'ask'});vi.mocked(hanaFetch).mockImplementation(async(url,options)=>new Response(JSON.stringify(String(url).includes('/source')?publication:{turns:[{id:'turn',onBranch:true,startedAt:'2026-10-31',prompt:'Change'}],repositories:[],jobs:[]}),{status:200}));});afterEach(cleanup);
it('reads conversation scope without a repository, filters files and preserves read progress',async()=>{
 render(<ChangeWorkbench/>);await screen.findByText('2 个文件 · 版本 version');
 expect(screen.queryByRole('button',{name:'查看变更'})).toBeNull();
 const writes=vi.mocked(hanaFetch).mock.calls.filter(([,options])=>options?.method==='POST');
 expect(writes).toHaveLength(1);expect(JSON.parse(writes[0][1]!.body as string).input).toEqual({source:'conversation',all:true});
 expect(writes[0][0]).not.toContain('/analyze');
 fireEvent.click(screen.getByRole('button',{name:'全量 Diff'}));expect(screen.getByText('new')).toBeVisible();
 fireEvent.change(screen.getByRole('textbox',{name:'搜索变更文件'}),{target:{value:'docs/'}});expect(screen.getByText('note')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'标为已读'}));expect(screen.getByText('1 已读')).toBeVisible();
 expect(JSON.stringify(localStorage)).toContain('docs/note.md');
});
it('loads a repository commit immediately from its catalog choice',async()=>{
 const repository={id:'repo',name:'api',branch:'main',branches:['main'],commits:[{id:'abc123',parents:[],title:'Initial API'}],state:{staged:[],unstaged:[],untracked:[],conflicts:[]}};
 vi.mocked(hanaFetch).mockImplementation(async url=>new Response(JSON.stringify(String(url).includes('/source')?{...publication,input:{source:'git',kind:'working'}}:{turns:[],repositories:[repository],jobs:[]})));
 render(<ChangeWorkbench/>);await screen.findByText('2 个文件 · 版本 version');
 fireEvent.click(screen.getByRole('button',{name:'全量 Diff'}));fireEvent.click(screen.getByText(/最近提交/).closest('summary')!);fireEvent.click(screen.getByRole('button',{name:'查看提交 Initial API (abc123)'}));
 await waitFor(()=>{const calls=vi.mocked(hanaFetch).mock.calls.filter(([,o])=>o?.method==='POST');expect(JSON.parse(calls.at(-1)![1]!.body as string).input).toMatchObject({source:'git',kind:'commit',repo:'repo',base:{repo:''},target:{repo:'abc123'}});});
});
it('does not apply a late source response after switching conversations',async()=>{
 let resolve!:(value:Response)=>void;vi.mocked(hanaFetch).mockImplementation(async(url,options)=>String(url).includes('/source')?new Promise(r=>{resolve=r;}):new Response(JSON.stringify({turns:[{id:'one',onBranch:true}],repositories:[],jobs:[]})));
 render(<ChangeWorkbench/>);await waitFor(()=>expect(resolve).toBeTypeOf('function'));
 act(()=>useStore.setState({currentSessionPath:'/two'}));await act(async()=>resolve(new Response(JSON.stringify(publication))));
 expect(screen.queryByText('2 个文件 · 版本 version')).toBeNull();
});
it('does not expose analysis writes in read-only mode',async()=>{
 useStore.setState({sessionPermissionMode:'read_only'});render(<ChangeWorkbench/>);await screen.findByText('2 个文件 · 版本 version');expect(screen.getByRole('button',{name:'开始审查'})).toBeDisabled();expect(screen.getByRole('button',{name:'生成解读'})).toBeDisabled();
});
it('supports comma-separated include globs without evaluating regular expressions from users',()=>{
 expect(changeMatches('repo/src/a.ts','src/**')).toBe(true);expect(changeMatches('repo/docs/a.md','src/**,docs/*.md')).toBe(true);expect(changeMatches('repo/docs/a.md','src/**')).toBe(false);expect(changeMatches('repo/a[1].ts','a[1].ts')).toBe(true);
});

it('explains empty review filters, restores findings and resets filters for a new conversation',async()=>{
 const finding={id:'risk',severity:'P1',state:'resolved',title:'Zero is preserved',fact:'Fixed source',impact:'Counts stay correct',suggestion:'Keep boundary checks',anchors:[]};
 const job={id:'review',publication:'source',kind:'review',status:'completed',createdAt:'2026-11-01T02:00:00Z',result:{summary:'Source review',findings:[finding]}};
 vi.mocked(hanaFetch).mockImplementation(async url=>new Response(JSON.stringify(String(url).includes('/source')?publication:String(url).includes('/job?')?job:{turns:[],repositories:[],jobs:[job]})));
 render(<ChangeWorkbench/>);fireEvent.click(await screen.findByLabelText('之前的分析'));
 fireEvent.click(await screen.findByRole('button',{name:/审查 ·/}));await screen.findByText(finding.title);
 fireEvent.change(screen.getByRole('combobox',{name:'风险优先级'}),{target:{value:'P0'}});
 expect(screen.queryByText(finding.title)).toBeNull();expect(screen.getByText('当前筛选没有匹配的审查意见。')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'清除筛选'}));expect(screen.getByText(finding.title)).toBeVisible();
 fireEvent.change(screen.getByRole('combobox',{name:'风险状态'}),{target:{value:'open'}});
 act(()=>useStore.setState({currentSessionPath:'/two'}));
 fireEvent.click(await screen.findByLabelText('之前的分析'));fireEvent.click(await screen.findByRole('button',{name:/审查 ·/}));await screen.findByText(finding.title);
 expect(screen.getByRole('combobox',{name:'风险状态'})).toHaveValue('all');
});

it('does not overwrite a user-selected source when the initial catalog arrives late',async()=>{
 let done!:(value:Response)=>void;vi.mocked(hanaFetch).mockImplementationOnce(()=>new Promise(resolve=>{done=resolve;}));
 render(<ChangeWorkbench/>);
 fireEvent.change(screen.getByRole('combobox',{name:'变更来源'}),{target:{value:'staged'}});
 await act(async()=>done(new Response(JSON.stringify({turns:[{id:'turn',onBranch:true,startedAt:'2026-10-31',prompt:'A'}],repositories:[],jobs:[]}))));
 expect(screen.getByRole('combobox',{name:'变更来源'})).toHaveValue('staged');
});

it('retains existing results and explains an uncertain timeout without retrying writes',async()=>{
 render(<ChangeWorkbench/>);await screen.findByText('2 个文件 · 版本 version');
 vi.mocked(hanaFetch).mockImplementation(async(url,options)=>{if(options?.method==='POST')throw new DOMException('signal is aborted without reason','AbortError');return new Response(JSON.stringify({turns:[],repositories:[],jobs:[]}));});
 fireEvent.click(screen.getByRole('button',{name:'刷新变更'}));await screen.findByRole('alert');
 expect(screen.getByRole('alert')).toHaveTextContent('分析可能仍在后台运行');expect(screen.getByText('2 个文件 · 版本 version')).toBeVisible();
});

it('pauses source polling in hidden panels and refreshes when shown again',async()=>{
 const view=render(<ChangeWorkbench/>);await screen.findByText('2 个文件 · 版本 version');
 vi.useFakeTimers();
 try{
  view.rerender(<ChangeWorkbench active={false}/>);vi.mocked(hanaFetch).mockClear();await act(async()=>{await vi.advanceTimersByTimeAsync(31_000);});
  expect(hanaFetch).not.toHaveBeenCalled();expect(screen.getByText('2 个文件 · 版本 version')).toBeVisible();
  view.rerender(<ChangeWorkbench active/>);await act(async()=>{});
  expect(hanaFetch).toHaveBeenCalledWith(expect.stringContaining('/source?id=source'),expect.anything());
 }finally{vi.useRealTimers();}
});
