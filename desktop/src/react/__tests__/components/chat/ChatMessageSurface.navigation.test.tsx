// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,render} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {useStore} from '../../../stores';
import {ChatMessageSurface} from '../../../components/chat/ChatMessageSurface';

const mock=vi.hoisted(()=>({anchors:[] as any[],follow:vi.fn(),cancel:vi.fn(),scroll:vi.fn()}));
vi.mock('../../../components/chat/ChatTimelineNavigator',()=>({ChatTimelineNavigator:({anchors}:any)=>{mock.anchors=anchors;return null;}}));
vi.mock('../../../components/chat/ChatTranscript',()=>({ChatTranscript:({items,registerMessageElement}:any)=><>{items.map((item:any)=><div key={item.data.id} data-message-id={item.data.id} ref={node=>registerMessageElement(item.data.id,node)}>{item.data.text}</div>)}</>}));
vi.mock('../../../hooks/use-continuous-bottom-scroll',()=>{
  const controller={isStickyRef:{current:false},checkSticky:()=>false,cancelFollow:mock.cancel,markSticky:()=>{},followBottom:mock.follow,scrollToBottom:mock.scroll,armInstantLanding:()=>{}};
  return {useContinuousBottomScroll:()=>controller};
});
vi.mock('../../../stores/session-actions',async load=>({...await load<any>(),loadMoreMessages:vi.fn()}));
const path='/navigation-test';
const message=(id:string,role='user',text=id)=>({type:'message',data:{id,role,text}});
const set=(items:any[],loadingMore=false)=>useStore.setState({chatSessions:{[path]:{items,loadingMore,hasMore:true,oldestId:items[0].data.id}}} as never);
beforeEach(()=>{window.t=((key:string)=>key) as typeof window.t;mock.follow.mockClear();mock.scroll.mockClear();mock.cancel.mockClear();useStore.setState({currentSessionPath:path,pendingMessageLocate:null,streamingSessions:[],sessions:[],chatFindBySession:{}} as never);});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('delivers current reply previews while the user input remains unchanged',async()=>{
  const items=[message('40'),message('41','assistant','Old reply')];set(items);render(<ChatMessageSurface sessionPath={path}/>);
  expect(mock.anchors[0].replyPreview).toBe('Old reply');
  await act(async()=>set([items[0],message('41','assistant','New reply')]));
  expect(mock.anchors[0].replyPreview).toBe('New reply');
});
it('does not double-count native scroll anchoring or follow the bottom when older messages load',async()=>{
  const items=[message('40'),message('41','assistant','Reply')];set(items);
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){const top=this.dataset.messageId==='40'?20:this.dataset.messageId==='41'?120:this.dataset.messageId==='20'?-480:0;return {top,bottom:top+100,left:0,right:500,width:500,height:100,x:0,y:top,toJSON:()=>({})} as DOMRect;});
  const {container}=render(<ChatMessageSurface sessionPath={path}/>),panel=container.querySelector<HTMLElement>('[data-chat-selection-root]')!;
  Object.defineProperty(panel,'scrollHeight',{value:2000,configurable:true});panel.scrollTop=1000;
  await act(async()=>set(items,true));
  panel.scrollTop=1500;Object.defineProperty(panel,'scrollHeight',{value:2500,configurable:true});mock.follow.mockClear();mock.scroll.mockClear();
  await act(async()=>set([message('20'),...items]));
  expect(panel.scrollTop).toBe(1500);expect(mock.follow).not.toHaveBeenCalled();expect(mock.scroll).not.toHaveBeenCalled();
});
