// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {useStore} from '../../stores';
import {pauseConversationViewTracking,restoreConversationView,trackConversationView} from '../conversation-view';
import {loadMobileSessions} from '../../mobile/mobile-init';
vi.mock('../../hooks/use-hana-fetch',()=>({hanaFetch:vi.fn(async()=>new Response('[]'))}));

const policy={mode:'delegated' as const,execution:{provider:'test',id:'main',thinking:'high' as const},worker:{provider:'test',id:'worker',thinking:'low' as const},maxRequests:7,phase:'execution' as const,requests:0,failures:0};
const home=()=>useStore.setState({currentSessionId:null,currentSessionPath:null,pendingSessionSwitchPath:null,pendingNewSession:true,pendingDraftId:'draft',pendingNewSessionModelPolicy:undefined,activeServerConnectionId:'local',sessions:[]});
beforeEach(()=>{pauseConversationViewTracking();localStorage.clear();home();});
afterEach(pauseConversationViewTracking);

it('restores a new draft model policy after the renderer restarts without creating a session',async()=>{
  trackConversationView();useStore.setState({pendingNewSessionModelPolicy:policy});
  pauseConversationViewTracking();home();const switchSession=vi.fn();
  await restoreConversationView(switchSession);
  expect(useStore.getState().pendingNewSessionModelPolicy).toMatchObject(policy);
  expect(switchSession).not.toHaveBeenCalled();
});

it('does not reuse the consumed policy for the next new conversation',async()=>{
  trackConversationView();useStore.setState({pendingNewSessionModelPolicy:policy});
  useStore.setState({currentSessionId:'created',currentSessionPath:'/created',pendingNewSession:false});
  useStore.setState({currentSessionId:null,currentSessionPath:null,pendingNewSession:true,pendingDraftId:'next',pendingNewSessionModelPolicy:undefined});
  pauseConversationViewTracking();home();await restoreConversationView(vi.fn());
  expect(useStore.getState().pendingNewSessionModelPolicy).toBeUndefined();
});

it('keeps draft model choices scoped to their service',async()=>{
  trackConversationView();useStore.setState({pendingNewSessionModelPolicy:policy});
  pauseConversationViewTracking();home();useStore.setState({activeServerConnectionId:'other'});
  await restoreConversationView(vi.fn());expect(useStore.getState().pendingNewSessionModelPolicy).toBeUndefined();
});

it('keeps the current draft and its model choices when focus refreshes the session list',async()=>{
  trackConversationView();useStore.setState({pendingNewSessionModelPolicy:policy});
  await loadMobileSessions();
  expect(useStore.getState().pendingDraftId).toBe('draft');
  expect(useStore.getState().pendingNewSessionModelPolicy).toMatchObject(policy);
});

it('still restores an accessible session saved by earlier versions',async()=>{
  localStorage.setItem('enigma-conversation-view:local','old-session');
  useStore.setState({sessions:[{sessionId:'old-session',path:'/old-session'}] as any});
  const switchSession=vi.fn();await restoreConversationView(switchSession);
  expect(switchSession).toHaveBeenCalledWith('/old-session');
});
