// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {useStore} from '../../stores';
import {useEngineering,restoreTabs,rememberEngineeringView,tabStorageKey,loadEngineeringTab,showAction,showRecordAction,submitAction,refreshEngineering,previewCheckpoint} from '../state';
import {pauseConversationViewTracking,restoreConversationView,trackConversationView} from '../conversation-view';
import {hanaFetch} from '../../hooks/use-hana-fetch';
vi.mock('../../hooks/use-hana-fetch',()=>({hanaFetch:vi.fn()}));
let stop:(()=>void)|undefined;
beforeEach(()=>{
  localStorage.clear();sessionStorage.clear();vi.mocked(hanaFetch).mockReset();
  useStore.setState({activeServerConnectionId:'server-a',currentSessionId:null,currentSessionPath:null,pendingNewSession:true,sessions:[]});
  useEngineering.setState({sessionPath:'/task-a',connectionId:'server-a',tabs:[],active:'',paneOpen:false,loading:false,snapshot:null,form:undefined,sections:{}});
});
afterEach(()=>{stop?.();stop=undefined;});
it('keeps an accepted original-task receipt if a conversation switch is pending but has not succeeded',async()=>{
 const action={id:'verify',title:'运行检查',group:'project',description:'',fields:[]};useStore.setState({currentSessionPath:'/task-a',pendingSessionSwitchPath:null});
 useEngineering.setState({form:action,formSession:'/task-a',active:'group:project',operationTabs:{},results:{}});
 let reply!:(value:Response)=>void;vi.mocked(hanaFetch).mockImplementationOnce(()=>new Promise(resolve=>{reply=resolve;})).mockResolvedValueOnce(new Response(JSON.stringify({state:{operation:{id:'accepted',state:'running'}}})));
 const pending=submitAction(action,{});useStore.setState({pendingSessionSwitchPath:'/task-b'});reply(new Response(JSON.stringify({operation:{id:'accepted',state:'running'}})));await pending;
 expect(useEngineering.getState().operationTabs.accepted).toBe('group:project');expect(useEngineering.getState().results['group:project'].operation.id).toBe('accepted');useStore.setState({pendingSessionSwitchPath:null});
});
it('routes generic recipe execution to concrete recipe cards instead of an unversioned parameter form',async()=>{
 vi.mocked(hanaFetch).mockResolvedValue(new Response(JSON.stringify({recipes:[],runs:[],catalog:{skills:[]}})));
 await showAction({id:'recipe-run',title:'运行配方',description:'',group:'skills',fields:[{name:'id',label:'配方',source:'recipes'},{name:'version',label:'版本'}]});
 expect(useEngineering.getState().active).toBe('group:skills');expect(useEngineering.getState().form).toBeUndefined();
});
it('opens a repository file browser without first rebuilding unrelated change-reading metadata',async()=>{
 const tab={id:'repo:api',group:'reading',title:'api',repo:'api'};useEngineering.setState({tabs:[tab],active:tab.id});
 await loadEngineeringTab(tab);expect(hanaFetch).not.toHaveBeenCalled();expect(useEngineering.getState().data).toEqual({});expect(useEngineering.getState().loading).toBe(false);
});
it('clears a recovered snapshot error without erasing a separate content read failure',async()=>{
 useEngineering.setState({refreshError:'temporary snapshot failure',error:'content not found',operationTabs:{}});
 vi.mocked(hanaFetch).mockResolvedValueOnce(new Response(JSON.stringify({state:{idle:true}})));
 await refreshEngineering('/task-a');expect(useEngineering.getState().refreshError).toBe('');expect(useEngineering.getState().error).toBe('content not found');
});
it('does not erase the saved conversation during a repeated bootstrap blank state',async()=>{
  useStore.setState({sessions:[{sessionId:'selected',path:'/selected'}] as any,currentSessionId:'selected',currentSessionPath:'/selected',pendingNewSession:false});
  stop=trackConversationView();pauseConversationViewTracking();
  useStore.setState({currentSessionId:null,currentSessionPath:null,pendingNewSession:true});
  const select=vi.fn(async()=>{});await restoreConversationView(select);expect(select).toHaveBeenCalledWith('/selected');
});
it('old lifecycle cleanup cannot stop a newer view tracker',()=>{
  const old=trackConversationView();stop=trackConversationView();old();
  useStore.setState({currentSessionId:'new-view',currentSessionPath:'/new-view',pendingNewSession:false});
  expect(localStorage.getItem('enigma-conversation-view:server-a')).toBe('new-view');
});
it('does not override a conversation the user chose while startup was loading',async()=>{
 localStorage.setItem('enigma-conversation-view:server-a','old');
 useStore.setState({sessions:[{sessionId:'old',path:'/old'}] as any,currentSessionId:'chosen',currentSessionPath:'/chosen',pendingNewSession:false});
 const select=vi.fn(async()=>{});await restoreConversationView(select);expect(select).not.toHaveBeenCalled();
});
it('returns to the material list after removing the open record without trying to read revoked content',async()=>{
  const tab={id:'resource:gone',group:'materials',resource:'gone',title:'Old reference'};
  useEngineering.setState({active:tab.id,tabs:[tab],operationTabs:{remove:tab.id},snapshot:{state:{operation:{id:'remove',state:'running'}}},results:{}});
  vi.mocked(hanaFetch).mockResolvedValueOnce(new Response(JSON.stringify({state:{operation:{id:'remove',state:'completed',result:{removedResource:'gone'}}}}))).mockResolvedValueOnce(new Response(JSON.stringify({items:[],totalMatches:0})));
  await refreshEngineering('/task-a');
  expect(useEngineering.getState().active).toBe('group:materials');
  expect(useEngineering.getState().tabs.some(tab=>tab.resource==='gone')).toBe(false);
  expect(useEngineering.getState().results['group:materials']).toEqual({removedResource:'gone'});
  expect(vi.mocked(hanaFetch).mock.calls.some(([url])=>String(url).includes('/content?'))).toBe(false);
});
it('pins a chosen record outside the first option page without fetching unrelated limited choices',async()=>{
  useEngineering.setState({snapshot:{actions:[{id:'material-refresh',title:'更新资料',description:'',group:'materials',fields:[{name:'id',label:'资料',source:'materials',kind:'select'}]}]}});
  await showRecordAction('material-refresh',{id:'source-outside-page'},{id:'已选资料'});
  expect(hanaFetch).not.toHaveBeenCalled();
  expect(useEngineering.getState().form?.fields[0]).toMatchObject({kind:'record',value:'source-outside-page',displayValue:'已选资料',source:undefined});
});
it('filters completed and active child choices for their respective valid operations',async()=>{
  const delegations=['completed','failed','budget','running'].map(status=>({spec:{id:status},status,terminal:status!=='running'}));
  vi.mocked(hanaFetch).mockImplementation(async()=>new Response(JSON.stringify({delegations})));
  const fields=[{name:'id',label:'子任务',source:'delegations'}];
  await showAction({id:'delegate-preview',group:'collaboration',title:'预览',description:'',fields});
  expect(useEngineering.getState().choices.delegations.map((d:any)=>d.status)).toEqual(['completed']);
  await showAction({id:'delegate-cancel',group:'collaboration',title:'取消',description:'',fields});
  expect(useEngineering.getState().choices.delegations.map((d:any)=>d.status)).toEqual(['running']);
});
it('restores the selected tab and open state, while keeping each connection/session separate',()=>{
  const tabs=[{id:'group:plan',group:'plan',title:'任务计划'},{id:'group:reading',group:'reading',title:'变更与阅读'}];
  useEngineering.setState({tabs,active:'group:reading',paneOpen:false});rememberEngineeringView();restoreTabs('/task-a');expect(useEngineering.getState().active).toBe('group:reading');expect(useEngineering.getState().paneOpen).toBe(false);
  restoreTabs('/task-b');expect(useEngineering.getState().tabs).toHaveLength(0);expect(useEngineering.getState().loading).toBe(false);
});
it('retains the recipe section across content refresh and restores it only for the same session',()=>{
 useEngineering.setState({sections:{skills:'recipes'},tabs:[{id:'group:skills',group:'skills',title:'技能与配方'}],active:'group:skills',paneOpen:true});rememberEngineeringView();restoreTabs('/task-a');expect(useEngineering.getState().sections.skills).toBe('recipes');restoreTabs('/task-b');expect(useEngineering.getState().sections).toEqual({});
});
it('a slow reply from a previous server never becomes current panel data',async()=>{
  let resolve!:(result:Response)=>void;vi.mocked(hanaFetch).mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
  const tab={id:'group:project',group:'project',title:'项目'};useEngineering.setState({tabs:[tab],active:tab.id});
  const pending=loadEngineeringTab(tab);useEngineering.setState({connectionId:'server-b',data:{server:'b'}});resolve(new Response(JSON.stringify({server:'a'})));await pending;expect(useEngineering.getState().data).toEqual({server:'b'});
});
it('late action choices cannot overwrite a newer open form',async()=>{
  let resolve!:(result:Response)=>void;vi.mocked(hanaFetch).mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
  const pending=showAction({id:'old',group:'project',title:'old',description:'',fields:[{name:'repo',label:'仓库',source:'repos'}]});useEngineering.setState({form:{id:'new',group:'project',title:'new',description:'',fields:[]},choices:{new:true}});resolve(new Response(JSON.stringify({old:true})));await pending;expect(useEngineering.getState().choices).toEqual({new:true});
});
it('reopens only an accessible current-server session by native identity and preserves explicit new-chat navigation',async()=>{
  useStore.setState({sessions:[{sessionId:'owned-id',path:'/owned-current.jsonl'}] as any});
  stop=trackConversationView();useStore.setState({currentSessionId:'owned-id',currentSessionPath:'/owned-old.jsonl',pendingNewSession:false});
  expect(localStorage.getItem('enigma-conversation-view:server-a')).toBe('owned-id');
  pauseConversationViewTracking();useStore.setState({currentSessionId:null,currentSessionPath:null,pendingNewSession:true});
  const switchSession=vi.fn(async()=>{});await restoreConversationView(switchSession);expect(switchSession).toHaveBeenCalledWith('/owned-current.jsonl');
  useStore.setState({activeServerConnectionId:'server-b'});stop=trackConversationView();switchSession.mockClear();await restoreConversationView(switchSession);expect(switchSession).not.toHaveBeenCalled();
  useStore.setState({pendingNewSession:true,currentSessionId:null,currentSessionPath:null,pendingSessionSwitchPath:null});expect(localStorage.getItem('enigma-conversation-view:server-b')).toBeNull();
});
it('legacy tab arrays remain readable and unknown saved active IDs do not invent tabs',()=>{
  localStorage.setItem(tabStorageKey('/task-a'),JSON.stringify([{id:'group:plan',title:'计划',group:'plan'}]));localStorage.setItem(`${tabStorageKey('/task-a')}:view`,JSON.stringify({active:'foreign',paneOpen:false}));restoreTabs('/task-a');expect(useEngineering.getState().active).toBe('group:plan');
});
it('captures a conversation selected while startup was still finishing',()=>{
  useStore.setState({currentSessionId:'selected-before-ready',currentSessionPath:'/current',pendingNewSession:false});stop=trackConversationView();expect(localStorage.getItem('enigma-conversation-view:server-a')).toBe('selected-before-ready');
});

it('does not keep showing running after the same operation fails or is cancelled',async()=>{
  for(const state of ['failed','cancelled','unknown']){
    useEngineering.setState({active:'group:other',operationTabs:{op:'group:timeline'},snapshot:{state:{operation:{id:'op',state:'running'}}},results:{'group:timeline':{operation:{id:'op',state:'running'}}}});
    vi.mocked(hanaFetch).mockResolvedValueOnce(new Response(JSON.stringify({state:{operation:{id:'op',state,error:'operation stopped'}}})));
    await refreshEngineering('/task-a');
    expect(useEngineering.getState().results['group:timeline']).toEqual({state,error:'operation stopped'});
  }
});
it('skips option fetches for simple forms and shows load failures inside the current form',async()=>{
  await showAction({id:'simple',group:'project',title:'simple',description:'',fields:[]});
  expect(hanaFetch).not.toHaveBeenCalled();
  vi.mocked(hanaFetch).mockRejectedValueOnce(new Error('offline'));
  await showAction({id:'choose',group:'project',title:'choose',description:'',fields:[{name:'repo',label:'仓库',source:'repos'}]});
  expect(useEngineering.getState().formLoading).toBe(false);
  expect(useEngineering.getState().formError).toContain('offline');
});
it('supports an older running host only when the selective choices endpoint is absent',async()=>{
  vi.mocked(hanaFetch).mockResolvedValueOnce(new Response('Not found',{status:404})).mockResolvedValueOnce(new Response(JSON.stringify({repos:[{id:'a'}]})));
  await showAction({id:'choose',group:'project',title:'choose',description:'',fields:[{name:'repo',label:'仓库',source:'repos'}]});
  expect(useEngineering.getState().choices).toEqual({repos:[{id:'a'}]});
  vi.mocked(hanaFetch).mockReset();vi.mocked(hanaFetch).mockResolvedValueOnce(new Response(JSON.stringify({error:'denied'}),{status:403}));
  await showAction({id:'choose',group:'project',title:'choose',description:'',fields:[{name:'repo',label:'仓库',source:'repos'}]});
  expect(hanaFetch).toHaveBeenCalledTimes(1);expect(useEngineering.getState().formError).toContain('denied');
});
it('surfaces malformed success responses as an error instead of an empty successful form',async()=>{
  vi.mocked(hanaFetch).mockResolvedValueOnce(new Response('<html>unexpected proxy page</html>',{status:200}));
  await showAction({id:'choose',group:'project',title:'choose',description:'',fields:[{name:'repo',label:'仓库',source:'repos'}]});
  expect(useEngineering.getState().formError).toContain('无法读取');expect(useEngineering.getState().formLoading).toBe(false);expect(hanaFetch).toHaveBeenCalledTimes(1);
});
it('starts a direct snapshot preview in its original tab without requiring or closing a form',async()=>{
  const action={id:'restore-preview',fields:[{name:'target'},{name:'expected'}]};
  useEngineering.setState({active:'group:timeline',snapshot:{actions:[action]},form:undefined,formSession:undefined,results:{}});
  vi.mocked(hanaFetch).mockResolvedValueOnce(new Response(JSON.stringify({operation:{id:'preview-a',state:'running'}}))).mockResolvedValueOnce(new Response(JSON.stringify({actions:[action],state:{operation:{id:'preview-a',state:'running'}}})));
  await previewCheckpoint('old','new');
  expect(JSON.parse(String(vi.mocked(hanaFetch).mock.calls[0][1]?.body))).toEqual({action:'restore-preview',args:{target:'old',expected:'new'},sessionPath:'/task-a'});
  expect(useEngineering.getState().operationTabs['preview-a']).toBe('group:timeline');
  expect(useEngineering.getState().form).toBeUndefined();
});
it('does not publish a late preview into a different connection',async()=>{
  useEngineering.setState({active:'group:timeline',snapshot:{actions:[{id:'restore-preview',fields:[{name:'target'},{name:'expected'}]}]},results:{}});
  let resolve!:(response:Response)=>void;vi.mocked(hanaFetch).mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
  const pending=previewCheckpoint('old','new'); useEngineering.setState({connectionId:'server-b'});
  resolve(new Response(JSON.stringify({operation:{id:'wrong-server',state:'running'}})));await pending;
  expect(useEngineering.getState().results).toEqual({});expect(hanaFetch).toHaveBeenCalledTimes(1);
});
