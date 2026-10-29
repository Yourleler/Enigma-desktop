// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {hanaFetch} from '../../hooks/use-hana-fetch';
import {useStore} from '../../stores';
import {chooseDraftVersion,flushInputDrafts,getDraftRecoveryCopies,hydrateInputDrafts,initInputDraftPersistence,useDraftSaveState} from '../../stores/input-draft-persistence';
vi.mock('../../hooks/use-hana-fetch',()=>({hanaFetch:vi.fn()}));
vi.mock('../../services/server-connection',()=>({hasServerConnection:()=>true}));
const request=vi.mocked(hanaFetch);
const response=(data:unknown,status=200)=>({ok:status<400,status,json:async()=>data}) as Response;
const empty=()=>response({protocol:2,home:null,sessions:{},revisions:{}});
let dispose:(()=>void)|undefined;
function start(){dispose=initInputDraftPersistence();}
function set(text:string,key='__home__'){useStore.getState().setDraft(key,text);}
const puts=()=>request.mock.calls.filter(([,options])=>options?.method==='PUT');
beforeEach(()=>{
 vi.useFakeTimers();localStorage.clear();sessionStorage.clear();request.mockReset();
 useStore.setState({drafts:{},draftDocs:{},draftsHydratedAt:0,activeServerConnection:null,activeServerConnectionId:'local',serverPort:'1',serverToken:'test',connected:false});
 request.mockImplementation(async(_path,options)=>options?.method==='PUT'?response({ok:true,revision:1}):empty());
});
afterEach(()=>{dispose?.();dispose=undefined;vi.useRealTimers();vi.restoreAllMocks();});
it('hydrates server entries without replacing input already typed before the request finishes',async()=>{
 start();let release!:(r:Response)=>void;request.mockImplementationOnce(()=>new Promise(r=>release=r));
 const hydration=hydrateInputDrafts();set('typed now');
 release(response({protocol:2,home:{text:'old server'},sessions:{other:{text:'other draft'}},revisions:{__home__:2}}));await hydration;
 expect(useStore.getState().drafts.__home__).toBe('typed now');expect(useStore.getState().drafts.other).toBe('other draft');expect(useDraftSaveState.getState().items.__home__.state).toBe('conflict');
});
it('journals immediately and restores a reload before the debounce expires',async()=>{
 start();await hydrateInputDrafts();set('new unsent 中文');expect(puts()).toHaveLength(0);expect(getDraftRecoveryCopies('__home__')[0].text).toBe('new unsent 中文');
 dispose?.();useStore.setState({drafts:{},draftDocs:{}});start();expect(useStore.getState().drafts.__home__).toBe('new unsent 中文');
 await hydrateInputDrafts();await vi.advanceTimersByTimeAsync(5);expect(puts()).toHaveLength(1);expect(useDraftSaveState.getState().items.__home__.state).toBe('saved');expect(getDraftRecoveryCopies('__home__')).toHaveLength(0);
});
it('retries a failed write without requiring more typing',async()=>{
 start();await hydrateInputDrafts();request.mockRejectedValueOnce(Error('offline'));set('recover without more typing');await vi.advanceTimersByTimeAsync(600);
 expect(useDraftSaveState.getState().items.__home__.state).toBe('offline');expect(getDraftRecoveryCopies('__home__')).toHaveLength(1);
 await vi.advanceTimersByTimeAsync(5000);expect(puts()).toHaveLength(2);expect(useDraftSaveState.getState().items.__home__.state).toBe('saved');
});
it('serializes writes and never lets an old acknowledgment remove the newer local copy',async()=>{
 start();await hydrateInputDrafts();let release!:(r:Response)=>void;request.mockImplementationOnce(()=>new Promise(r=>release=r));
 set('');await vi.advanceTimersByTimeAsync(600);set('replacement');await vi.advanceTimersByTimeAsync(600);expect(puts()).toHaveLength(1);expect(getDraftRecoveryCopies('__home__')[0].text).toBe('replacement');
 release(response({ok:true,revision:5}));await vi.advanceTimersByTimeAsync(5);expect(puts()).toHaveLength(2);expect(JSON.parse(puts()[1][1]!.body as string)).toMatchObject({text:'replacement',expectedRevision:5});
});
it('keeps both versions on conflict and only replaces server text after an explicit choice',async()=>{
 start();await hydrateInputDrafts();request.mockResolvedValueOnce(response({conflict:true,revision:3,entry:{text:'other window'}},409));set('this window');await vi.advanceTimersByTimeAsync(600);
 expect(useStore.getState().drafts.__home__).toBe('this window');expect(useDraftSaveState.getState().items.__home__).toMatchObject({state:'conflict',remote:{text:'other window'}});
 await vi.advanceTimersByTimeAsync(10000);expect(puts()).toHaveLength(1);chooseDraftVersion('__home__','local');await vi.advanceTimersByTimeAsync(5);expect(JSON.parse(puts()[1][1]!.body as string)).toMatchObject({expectedRevision:3,text:'this window'});
});
it('can accept the remote version without sending a stale local overwrite',async()=>{
 start();await hydrateInputDrafts();request.mockResolvedValueOnce(response({conflict:true,revision:3,entry:{text:'remote'}},409));set('local');await vi.advanceTimersByTimeAsync(600);chooseDraftVersion('__home__','remote');expect(useStore.getState().drafts.__home__).toBe('remote');expect(getDraftRecoveryCopies('__home__')).toHaveLength(0);expect(puts()).toHaveLength(1);
});
it('recovers a pending deletion so reload does not resurrect the server copy',async()=>{
 start();request.mockResolvedValueOnce(response({protocol:2,home:{text:'server'},revisions:{__home__:4},sessions:{}}));await hydrateInputDrafts();useStore.getState().clearDraft('__home__');
 dispose?.();useStore.setState({drafts:{},draftDocs:{}});start();request.mockResolvedValueOnce(response({protocol:2,home:{text:'server'},revisions:{__home__:4},sessions:{}}));await hydrateInputDrafts();expect(useStore.getState().drafts.__home__).toBe('');await vi.advanceTimersByTimeAsync(5);expect(JSON.parse(puts()[0][1]!.body as string)).toMatchObject({text:'',expectedRevision:4});
});
it('flushes on pagehide but keeps the journal until the server acknowledges it',async()=>{
 start();await hydrateInputDrafts();let release!:(r:Response)=>void;request.mockImplementationOnce(()=>new Promise(r=>release=r));set('leave immediately');window.dispatchEvent(new Event('pagehide'));await Promise.resolve();expect(puts()[0][1]?.keepalive).toBe(true);expect(getDraftRecoveryCopies('__home__')).toHaveLength(1);release(response({revision:1}));await vi.advanceTimersByTimeAsync(1);expect(getDraftRecoveryCopies('__home__')).toHaveLength(0);
});
it('fences pending writes and memory when changing connection identity',async()=>{
 start();await hydrateInputDrafts();set('server A draft');useStore.setState({activeServerConnectionId:'server-B'});await vi.advanceTimersByTimeAsync(600);expect(puts()).toHaveLength(0);expect(useStore.getState().drafts.__home__).toBeUndefined();expect(getDraftRecoveryCopies('__home__')).toHaveLength(0);
 useStore.setState({activeServerConnectionId:'local'});await vi.advanceTimersByTimeAsync(1);expect(useStore.getState().drafts.__home__).toBe('server A draft');
});
it('keeps a local recovery copy when the server does not support conditional writes',async()=>{
 start();request.mockResolvedValue(response({home:null,sessions:{}}));await hydrateInputDrafts();set('old server compatibility');await vi.advanceTimersByTimeAsync(600);expect(useDraftSaveState.getState().items.__home__.state).toBe('unsupported');expect(puts()).toHaveLength(0);expect(getDraftRecoveryCopies('__home__')[0].text).toBe('old server compatibility');
});
it('reports local storage failure without claiming the pending draft is durable',async()=>{
 start();await hydrateInputDrafts();vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('quota')});request.mockRejectedValueOnce(Error('offline'));set('still in editor');await vi.advanceTimersByTimeAsync(600);expect(useDraftSaveState.getState().items.__home__.state).toBe('local-error');expect(useStore.getState().drafts.__home__).toBe('still in editor');
});
it('does not silently advance an old editor base revision when focus fetches a newer server copy',async()=>{
 start();request.mockResolvedValueOnce(response({protocol:2,home:{text:'version one'},sessions:{},revisions:{__home__:1}}));await hydrateInputDrafts();
 request.mockResolvedValueOnce(response({protocol:2,home:{text:'version two from another window'},sessions:{},revisions:{__home__:2}}));await hydrateInputDrafts();
 set('editing version one');await vi.advanceTimersByTimeAsync(600);expect(JSON.parse(puts()[0][1]!.body as string).expectedRevision).toBe(1);
});
it('recognizes an already-accepted deletion after its acknowledgment was lost',async()=>{
 start();await hydrateInputDrafts();request.mockResolvedValueOnce(response({conflict:true,entry:null,revision:2},409));set('');await vi.advanceTimersByTimeAsync(600);expect(useDraftSaveState.getState().items.__home__.state).toBe('saved');
});
