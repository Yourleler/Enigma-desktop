// @vitest-environment jsdom
import {beforeEach,expect,it,vi} from 'vitest';
import {useStore} from '../../stores';
import {loadSessionProjectCatalog,patchSessionProjectInCatalog} from '../../stores/session-project-actions';
const request=vi.hoisted(()=>vi.fn());
vi.mock('../../hooks/use-hana-fetch',()=>({hanaFetch:request}));
beforeEach(()=>{vi.clearAllMocks();useStore.setState({activeServerConnectionId:'a',sessionProjectCatalog:{projects:[],folders:[]}});});
it('does not publish a previous connection catalog after the connection changes',async()=>{
 let resolve!:(value:any)=>void;request.mockReturnValue(new Promise(r=>{resolve=r;}));
 const pending=loadSessionProjectCatalog();useStore.setState({activeServerConnectionId:'b',sessionProjectCatalog:{projects:[{id:'b',name:'B',folderId:null,order:0}],folders:[]}});
 resolve({ok:true,json:async()=>({catalog:{projects:[{id:'a',name:'A'}]}})});await pending;
 expect(useStore.getState().sessionProjectCatalog.projects.map(p=>p.id)).toEqual(['b']);
});
it('retains the new connection catalog when an old project save finishes late',async()=>{
 let resolve!:(value:any)=>void;request.mockReturnValue(new Promise(r=>{resolve=r;}));
 const pending=patchSessionProjectInCatalog('a',{sharedNotes:'saved in original server'});useStore.setState({activeServerConnectionId:'b'});
 resolve({ok:true,json:async()=>({project:{id:'a',name:'A',sharedNotes:'saved in original server'}})});await pending;
 expect(useStore.getState().sessionProjectCatalog.projects).toEqual([]);
});
