// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {QuickChatApp} from '../QuickChatApp';
import {useStore} from '../../stores';

const {translate} = vi.hoisted(() => ({translate: (key:string) => key}));
vi.mock('../../hooks/use-i18n', () => ({useI18n: () => ({t: translate})}));
vi.mock('../../stores/agent-actions', () => ({applyAgentIdentity:vi.fn(), loadAvatars:vi.fn()}));
vi.mock('../../stores/session-actions', () => ({loadMessages:vi.fn()}));
vi.mock('../../components/chat/ChatTranscript', () => ({ChatTranscript: () => null}));
vi.mock('../../components/input/PlanModeButton', () => ({PlanModeButton: () => null}));
vi.mock('../../components/input/AttachedFilesBar', () => ({AttachedFilesBar: ({files}:any) => <div>{files.map((file:any) => <span key={file.path}>{file.name}</span>)}</div>}));
vi.mock('../use-quick-chat-auto-scroll', () => ({useQuickChatAutoScroll: () => {}}));

class TestSocket extends EventTarget {
  static CONNECTING=0; static OPEN=1; static CLOSING=2; static CLOSED=3;
  static instances:TestSocket[]=[];
  readyState=0;
  send=vi.fn();
  onmessage:any=null;
  onclose:any=null;
  constructor(_url:string){super();TestSocket.instances.push(this);}
  open(){this.readyState=1;this.dispatchEvent(new Event('open'));}
  close(){this.readyState=3;const event=new Event('close');this.dispatchEvent(event);this.onclose?.(event);}
}
let shown:(()=>void)|undefined;
let detached:()=>Promise<any>;
beforeEach(() => {
  TestSocket.instances=[];
  detached=async()=>({path:'/quick/draft.jsonl',sessionId:'quick-draft',agentId:'test'});
  vi.stubGlobal('WebSocket',TestSocket);
  vi.stubGlobal('t',translate);
  vi.stubGlobal('fetch',vi.fn(async(input:any)=>{
    const url=String(input);
    const data=url.includes('upload-blob')?{uploads:[{dest:'/uploads/kept.png',name:'kept.png',fileId:'image-test'}]}:url.includes('new-detached')?await detached():url.includes('/api/agents')?{agents:[{id:'test',name:'Test',isCurrent:true}]}:
      url.includes('session-permission-default')?{permissionMode:'ask'}:url.includes('quick-chat')?{quickChat:{reuseTimeoutMinutes:1}}:
      url.includes('health')?{agentId:'test',agent:'Test',user:'User'}:{locale:'zh-CN'};
    return {ok:true,status:200,json:async()=>data};
  }));
  window.hana={getServerPort:async()=>61879,getServerToken:async()=>'',quickChatResize:vi.fn(),
    quickChatHide:vi.fn(),
    onQuickChatShown:(listener:()=>void)=>{shown=listener;return()=>{shown=undefined;};}} as any;
  useStore.setState({currentSessionPath:null,currentSessionId:null,sessions:[],chatSessions:{},streamingSessions:[],inlineErrors:{},activeSessionStreams:{}} as any);
});
afterEach(()=>{cleanup();Reflect.deleteProperty(window,'hana');vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
async function composer(){
  const ui=render(<QuickChatApp/>);
  const input=screen.getByPlaceholderText('input.placeholder');
  await waitFor(()=>expect(screen.getByText('Test')).toBeVisible());
  fireEvent.change(input,{target:{value:'保留这份草稿'}});
  await waitFor(()=>expect(screen.getByRole('button',{name:'chat.send'})).toBeEnabled());
  return {...ui,input};
}
function addImage(container:HTMLElement,name:string){
  fireEvent.change(container.querySelector('input[type="file"]')!,{target:{files:[new File(['image'],name,{type:'image/png'})]}});
}
it('can close the compact window with its visible button and reopen without losing the draft',async()=>{
  const {container,input}=await composer();addImage(container,'kept.png');
  fireEvent.click(screen.getByRole('button',{name:'quickChat.close'}));expect(window.hana?.quickChatHide).toHaveBeenCalledOnce();
  await act(async()=>{shown?.();});expect(input).toHaveValue('保留这份草稿');expect(screen.getByText('kept.png')).toBeVisible();
  expect(TestSocket.instances).toHaveLength(0);
});
it('hides with Escape while preserving input and does not dismiss during composition',async()=>{
  const {input}=await composer();fireEvent.compositionStart(input);fireEvent.keyDown(input,{key:'Escape'});
  expect(window.hana?.quickChatHide).not.toHaveBeenCalled();fireEvent.compositionEnd(input);
  fireEvent.keyDown(input,{key:'Escape'});expect(window.hana?.quickChatHide).toHaveBeenCalledOnce();expect(input).toHaveValue('保留这份草稿');
});
it('also dismisses when focus is on the window rather than the input',async()=>{
  await composer();fireEvent.keyDown(window,{key:'Escape'});expect(window.hana?.quickChatHide).toHaveBeenCalledOnce();
});
it('keeps unsent text and images when returning after the reuse timeout',async()=>{
  const {container,input}=await composer();addImage(container,'kept.png');
  vi.spyOn(Date,'now').mockReturnValue(1000);fireEvent(window,new Event('pagehide'));
  vi.spyOn(Date,'now').mockReturnValue(181000);
  await act(async()=>{shown?.();});
  expect(input).toHaveValue('保留这份草稿');expect(screen.getByText('kept.png')).toBeVisible();
});
it('retains the draft and attachments if the socket closes before connecting',async()=>{
  const {container,input}=await composer();addImage(container,'unsent.png');
  fireEvent.click(screen.getByRole('button',{name:'chat.send'}));
  await waitFor(()=>expect(TestSocket.instances).toHaveLength(1));
  await act(async()=>{TestSocket.instances[0].close();});
  expect(input).toHaveValue('保留这份草稿');expect(screen.getByText('unsent.png')).toBeVisible();
  expect(screen.getByRole('button',{name:'chat.send'})).toBeEnabled();
  expect(TestSocket.instances[0].send).not.toHaveBeenCalled();
});
it('preserves text and images added while the previous message is preparing',async()=>{
  let resolve!:(value:any)=>void;detached=()=>new Promise(r=>{resolve=r;});
  const {container,input}=await composer();
  fireEvent.click(screen.getByRole('button',{name:'chat.send'}));
  await waitFor(()=>expect(resolve).toBeTypeOf('function'));
  fireEvent.change(input,{target:{value:'下一条还没发的内容'}});addImage(container,'next.png');
  await act(async()=>{resolve({path:'/quick/draft.jsonl',sessionId:'quick-draft',agentId:'test'});});
  await waitFor(()=>expect(TestSocket.instances).toHaveLength(1));
  await act(async()=>{TestSocket.instances[0].open();});
  expect(TestSocket.instances[0].send).toHaveBeenCalledOnce();
  expect(JSON.parse(TestSocket.instances[0].send.mock.calls[0][0]).text).toBe('保留这份草稿');
  expect(input).toHaveValue('下一条还没发的内容');expect(screen.getByText('next.png')).toBeVisible();
});
it('does not send a delayed connection after the quick-chat renderer unmounts',async()=>{
  const {unmount}=await composer();fireEvent.click(screen.getByRole('button',{name:'chat.send'}));
  await waitFor(()=>expect(TestSocket.instances).toHaveLength(1));
  unmount();await act(async()=>{TestSocket.instances[0].open();});
  expect(TestSocket.instances[0].send).not.toHaveBeenCalled();
});
it('times out without clearing the draft or replaying when the connection arrives late',async()=>{
  const {input}=await composer();vi.useFakeTimers();
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'chat.send'}));});
  expect(TestSocket.instances).toHaveLength(1);
  await act(async()=>{await vi.advanceTimersByTimeAsync(10_000);});
  expect(input).toHaveValue('保留这份草稿');
  expect(screen.getByRole('alert')).toHaveTextContent('quickChat.connectionFailed');
  expect(screen.getByRole('button',{name:'chat.send'})).toBeEnabled();
  await act(async()=>{TestSocket.instances[0].open();});
  expect(TestSocket.instances[0].send).not.toHaveBeenCalled();
});
it('rejects repeated Enter while a single submission is being prepared',async()=>{
  let release!:(value:any)=>void;detached=vi.fn(()=>new Promise(r=>{release=r;}));
  const {input}=await composer();
  await act(async()=>{fireEvent.keyDown(input,{key:'Enter'});fireEvent.keyDown(input,{key:'Enter'});});
  expect(detached).toHaveBeenCalledOnce();
  await act(async()=>{release({path:'/quick/once.jsonl',sessionId:'once'});});
  await act(async()=>{TestSocket.instances[0].open();});
  expect(TestSocket.instances[0].send).toHaveBeenCalledOnce();
});
it('submits durable attachment references instead of a temporary preview id',async()=>{
  const {container}=await composer();addImage(container,'kept.png');
  fireEvent.click(screen.getByRole('button',{name:'chat.send'}));
  await waitFor(()=>expect(TestSocket.instances).toHaveLength(1));
  await act(async()=>{TestSocket.instances[0].open();});
  const message=JSON.parse(TestSocket.instances[0].send.mock.calls[0][0]);
  expect(message.displayMessage.attachments).toEqual([{path:'/uploads/kept.png',fileId:'image-test',name:'kept.png',isDir:false,mimeType:'image/png'}]);
  expect(message.images[0]).toMatchObject({type:'image',mimeType:'image/png'});
});
it('keeps text and images when the upload is rejected and does not send the prompt',async()=>{
  const {container,input}=await composer();addImage(container,'kept.png');
  const request=vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async(...args)=>String(args[0]).includes('upload-blob')
    ? {ok:true,json:async()=>({uploads:[{error:'rejected'}]})} as Response : request(...args));
  fireEvent.click(screen.getByRole('button',{name:'chat.send'}));
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('quickChat.attachmentFailed'));
  expect(input).toHaveValue('保留这份草稿');expect(screen.getByText('kept.png')).toBeVisible();
  expect(TestSocket.instances).toHaveLength(0);
});
it('stops only the current reply while preserving the next draft',async()=>{
  const {input}=await composer();fireEvent.click(screen.getByRole('button',{name:'chat.send'}));
  await waitFor(()=>expect(TestSocket.instances).toHaveLength(1));
  await act(async()=>{TestSocket.instances[0].open();});
  act(()=>{useStore.getState().addStreamingSession('/quick/draft.jsonl',{streamId:'current-stream'});});
  fireEvent.change(input,{target:{value:'下一条草稿'}});
  fireEvent.click(screen.getByRole('button',{name:'chat.stop'}));
  expect(JSON.parse(TestSocket.instances[0].send.mock.calls.at(-1)![0])).toEqual({type:'abort',sessionId:'quick-draft',sessionPath:'/quick/draft.jsonl',streamId:'current-stream'});
  expect(input).toHaveValue('下一条草稿');
});
