// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {SideConversation} from '../SideConversation';
import {useStore} from '../../../stores';
import {dockScope,useRightDock} from '../../../stores/right-dock-store';
import {hanaFetch} from '../../../hooks/use-hana-fetch';
import {engineeringRequest} from '../../../engineering/state';
const mocks=vi.hoisted(()=>({send:vi.fn(),listeners:new Map<string,(event:any)=>void>()}));
vi.mock('../../../services/websocket',()=>({getWebSocket:()=>({readyState:1,send:mocks.send})}));
vi.mock('../../../services/stream-key-dispatcher',()=>({subscribeStreamKey:(path:string,fn:(event:any)=>void)=>{mocks.listeners.set(path,fn);return()=>mocks.listeners.delete(path);}}));
vi.mock('../../chat/SubagentSessionPreview',()=>({SubagentSessionPreview:({sessionPath}:{sessionPath:string})=><div>预览 {sessionPath}</div>}));
vi.mock('../../../stores/session-actions',()=>({loadMessages:vi.fn(async()=>{}),loadSessions:vi.fn(async()=>{}),switchSession:vi.fn()}));
vi.mock('../../../hooks/use-hana-fetch',()=>({hanaFetch:vi.fn(),hanaUrl:(path:string)=>path}));
vi.mock('../../../engineering/state',async load=>({...await load<any>(),engineeringRequest:vi.fn()}));
const side={sessionPath:'/side.jsonl',sessionId:'side',agentId:'agent',model:'main',provider:'test'};
let scope:string;
beforeEach(()=>{
 vi.clearAllMocks();mocks.listeners.clear();
 useStore.setState({currentSessionPath:'/main.jsonl',currentSessionId:'main',activeServerConnectionId:'test-connection',deskBasePath:'',drafts:{},draftDocs:{},draftQuotes:{},streamingSessions:[],sessions:[{path:'/side.jsonl',sessionId:'side'}] as any,models:[{id:'main',provider:'test',name:'Main'}] as any});
 scope=dockScope(useStore.getState());useRightDock.setState({views:{[scope]:{tab:'sidechat',expanded:false,sideChat:side}}});
 vi.mocked(hanaFetch).mockResolvedValue(new Response(JSON.stringify({uploads:[{fileId:'file-one',dest:'/files/note.txt',name:'note.txt'}]}),{status:200}));
});
afterEach(cleanup);
it('sends to its own session and waits for response acceptance before consuming the draft',async()=>{
 useStore.getState().setDraft('/main.jsonl','keep main');render(<SideConversation scope={scope} active/>);
 fireEvent.change(screen.getByLabelText('侧边对话输入'),{target:{value:'side question'}});fireEvent.click(screen.getByRole('button',{name:'发送'}));
 const payload=JSON.parse(mocks.send.mock.calls[0][0]);expect(payload).toMatchObject({sessionId:'side',sessionPath:'/side.jsonl',text:'side question'});
 expect(useStore.getState().drafts.side).toBe('side question');expect(useStore.getState().drafts.main).toBe('keep main');
 act(()=>mocks.listeners.get('/side.jsonl')!({type:'text_delta',delta:'response'}));expect(useStore.getState().drafts.side).toBeUndefined();expect(useStore.getState().drafts.main).toBe('keep main');
 fireEvent.click(screen.getByRole('button',{name:'停止侧边任务'}));expect(JSON.parse(mocks.send.mock.calls.at(-1)![0])).toMatchObject({type:'abort',sessionId:'side',sessionPath:'/side.jsonl'});
});
it('keeps edits made after sending and sends a failed socket draft nowhere',()=>{
 render(<SideConversation scope={scope} active/>);fireEvent.change(screen.getByLabelText('侧边对话输入'),{target:{value:'first'}});fireEvent.click(screen.getByRole('button',{name:'发送'}));
 fireEvent.change(screen.getByLabelText('侧边对话输入'),{target:{value:'later draft'}});act(()=>mocks.listeners.get('/side.jsonl')!({type:'text_delta',delta:'ok'}));expect(useStore.getState().drafts.side).toBe('later draft');
 act(()=>mocks.listeners.get('/side.jsonl')!({type:'turn_end'}));mocks.send.mockImplementationOnce(()=>{throw Error('disconnected');});fireEvent.click(screen.getByRole('button',{name:'发送'}));
 expect(useStore.getState().drafts.side).toBe('later draft');expect(screen.getByRole('alert')).toHaveTextContent('disconnected');
});
it('creates a detached side conversation without switching the main identity',async()=>{
 useRightDock.setState({views:{[scope]:{tab:'sidechat',expanded:false}}});vi.mocked(engineeringRequest).mockResolvedValue(side);
 render(<SideConversation scope={scope} active/>);fireEvent.click(screen.getByRole('button',{name:'开始侧边对话'}));
 await waitFor(()=>expect(screen.getByLabelText('侧边对话输入')).toBeVisible());expect(engineeringRequest).toHaveBeenCalledWith('/side-chat/new','/main.jsonl',{includeContext:true});expect(useStore.getState().currentSessionPath).toBe('/main.jsonl');
});
it('uploads into the side session, persists the attachment with the draft and removes only that attachment',async()=>{
 const {container}=render(<SideConversation scope={scope} active/>);fireEvent.change(screen.getByLabelText('侧边对话输入'),{target:{value:'read this'}});
 fireEvent.change(container.querySelector('input[type=file]')!,{target:{files:[new File(['note'],'note.txt',{type:'text/plain'})]}});
 await screen.findByRole('button',{name:'移除侧边附件 note.txt'});
 expect(JSON.parse(vi.mocked(hanaFetch).mock.calls[0][1]!.body as string)).toMatchObject({sessionPath:'/side.jsonl',name:'note.txt'});
 expect(JSON.stringify(useStore.getState().draftDocs.side)).toContain('file-one');fireEvent.click(screen.getByRole('button',{name:'移除侧边附件 note.txt'}));
 expect(useStore.getState().drafts.side).toBe('read this');expect(JSON.stringify(useStore.getState().draftDocs.side)).not.toContain('file-one');
});
it('sends the same validated attachment presentation shape used by the main composer',()=>{
 useStore.getState().setDraft('/side.jsonl','Read the file',{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Read the file'},{type:'fileBadge',attrs:{fileId:'file-one',path:'/files/generated.txt',name:'original.txt'}}]}]});
 render(<SideConversation scope={scope} active/>);fireEvent.click(screen.getByRole('button',{name:'发送'}));
 expect(JSON.parse(mocks.send.mock.calls[0][0]).displayMessage).toMatchObject({text:'Read the file',attachments:[{name:'original.txt',path:'/files/generated.txt',isDir:false}]});
 expect(JSON.parse(mocks.send.mock.calls[0][0]).text).toBe('Read the file\n\n[附件] original.txt');
});
it('keeps an approval bound to its side request instead of the focused main conversation',async()=>{
 render(<SideConversation scope={scope} active/>);act(()=>mocks.listeners.get('/side.jsonl')!({type:'content_block',block:{type:'session_confirmation',kind:'tool_action_approval',status:'pending',confirmId:'side-confirm',title:'Allow',subject:{label:'read'}}}));
 fireEvent.click(screen.getByRole('button',{name:'仅同意这次'}));await waitFor(()=>expect(hanaFetch).toHaveBeenCalledWith('/api/confirm/side-confirm',expect.objectContaining({body:JSON.stringify({action:'confirmed'})})));
 expect(useStore.getState().currentSessionId).toBe('main');
});
