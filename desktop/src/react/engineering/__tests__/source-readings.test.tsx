// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {CodeTraceResult,PublishedReadingResult,ReadingNodeResult,SourceIndexResult,SchemaReadingResult} from '../SourceReadings';
import {readRecordAction,useEngineering} from '../state';
vi.mock('../state',async load=>({...await load<typeof import('../state')>(),readRecordAction:vi.fn()}));
const source={repo:'api',file:'index.js',line:2,endLine:3,symbol:'greet',kind:'FunctionDeclaration',snippet:'return "old";'};
const reading={query:'greet',queryRepo:'api',symbols:[source],references:[],map:{nodes:[{id:'node-a',source}]}};
beforeEach(()=>{vi.clearAllMocks();useEngineering.setState({sessionPath:'/current',connectionId:'local'});});afterEach(cleanup);
it('opens a concrete published node without asking for an internal node id',async()=>{
 render(<CodeTraceResult value={reading} details={null}/>);await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'核对节点当前代码'}));});expect(readRecordAction).toHaveBeenCalledWith('reading-open',{query:'greet',repo:'api',node:'node-a'});
});
it('keeps stale historical content readable while separating current source',()=>{
 render(<><PublishedReadingResult value={{reading,current:false,issues:['原阅读证据暂不可读取，仅保留历史结果。']}} details={null}/><ReadingNodeResult value={{published:{source},source:{...source,snippet:'return "new";'},current:false,matchesPublishedSource:false}} details={null}/></>);
 expect(screen.getByText('当前源码已变化，旧阅读结论需要重新核对。')).toBeVisible();expect(screen.getByText('return "new";')).toBeVisible();expect(screen.getByText(/原阅读证据暂不可读取/)).toBeVisible();
});
it('shows index truncation and schema fields in plain language',()=>{
 render(<><SourceIndexResult value={{query:'greet',files:[{...source,language:'TypeScript',score:4}],total:60,truncated:true,refreshed:1,reused:0}} details={null}/><SchemaReadingResult value={{definitions:[{id:'payload',name:'Payload',language:'JSON Schema',source,members:[{name:'message',type:'string',required:true}]}],relations:[],sources:[source],diagnostics:[],truncated:false}} details={null}/></>);
 expect(screen.getByText(/还有文件未在本次预算内展示/)).toBeVisible();fireEvent.click(screen.getByText('Payload · JSON Schema · api / index.js:2'));expect(screen.getByRole('cell',{name:'message'})).toBeVisible();expect(screen.getByRole('cell',{name:'必填'})).toBeVisible();
});
it('defers large field tables while keeping later fields accessible',()=>{
 const members=Array.from({length:85},(_,index)=>({name:`field-${index}`,type:'string'}));render(<SchemaReadingResult value={{definitions:[{id:'large',name:'Large',language:'JSON Schema',source,members}],relations:[],sources:[source],diagnostics:[]}} details={null}/>);fireEvent.click(screen.getByText('Large · JSON Schema · api / index.js:2'));expect(screen.queryByRole('cell',{name:'field-84'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'继续显示字段'}));fireEvent.click(screen.getByRole('button',{name:'继续显示字段'}));expect(screen.getByRole('cell',{name:'field-84'})).toBeVisible();
});
