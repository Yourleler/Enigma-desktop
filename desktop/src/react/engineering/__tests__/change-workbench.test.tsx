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
 render(<ChangeWorkbench/>);fireEvent.click(await screen.findByRole('button',{name:'查看变更'}));await screen.findByText('2 个文件 · 版本 version');
 fireEvent.click(screen.getByRole('button',{name:'文件差异'}));expect(screen.getByText('new')).toBeVisible();
 fireEvent.change(screen.getByRole('textbox',{name:'搜索变更文件'}),{target:{value:'docs/'}});expect(screen.getByText('note')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'标为已读'}));expect(screen.getByText('1 已读')).toBeVisible();
 expect(JSON.stringify(localStorage)).toContain('docs/note.md');
});
it('does not apply a late source response after switching conversations',async()=>{
 let resolve!:(value:Response)=>void;vi.mocked(hanaFetch).mockImplementation(async(url,options)=>String(url).includes('/source')?new Promise(r=>{resolve=r;}):new Response(JSON.stringify({turns:[],repositories:[],jobs:[]})));
 render(<ChangeWorkbench/>);fireEvent.click(screen.getByRole('button',{name:'查看变更'}));
 act(()=>useStore.setState({currentSessionPath:'/two'}));await act(async()=>resolve(new Response(JSON.stringify(publication))));
 expect(screen.queryByText('2 个文件 · 版本 version')).toBeNull();
});
it('does not expose analysis writes in read-only mode',async()=>{
 useStore.setState({sessionPermissionMode:'read_only'});render(<ChangeWorkbench/>);fireEvent.click(screen.getByRole('button',{name:'查看变更'}));await screen.findByText('2 个文件 · 版本 version');expect(screen.getByRole('button',{name:'开始审查'})).toBeDisabled();expect(screen.getByRole('button',{name:'生成解读'})).toBeDisabled();
});
it('supports comma-separated include globs without evaluating regular expressions from users',()=>{
 expect(changeMatches('repo/src/a.ts','src/**')).toBe(true);expect(changeMatches('repo/docs/a.md','src/**,docs/*.md')).toBe(true);expect(changeMatches('repo/docs/a.md','src/**')).toBe(false);expect(changeMatches('repo/a[1].ts','a[1].ts')).toBe(true);
});

it('retains existing results and explains an uncertain timeout without retrying writes',async()=>{
 render(<ChangeWorkbench/>);fireEvent.click(await screen.findByRole('button',{name:'查看变更'}));await screen.findByText('2 个文件 · 版本 version');
 vi.mocked(hanaFetch).mockImplementation(async(url,options)=>{if(options?.method==='POST')throw new DOMException('signal is aborted without reason','AbortError');return new Response(JSON.stringify({turns:[],repositories:[],jobs:[]}));});
 fireEvent.click(screen.getByRole('button',{name:'查看变更'}));await screen.findByRole('alert');
 expect(screen.getByRole('alert')).toHaveTextContent('分析可能仍在后台运行');expect(screen.getByText('2 个文件 · 版本 version')).toBeVisible();
});
