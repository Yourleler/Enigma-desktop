import {useEffect,useRef,useState} from 'react';
import {useStore} from '../../stores';
import {sessionScopedValue} from '../../stores/session-slice';
import {selectIsStreamingSession} from '../../stores/session-selectors';
import {dockScope,patchDockView,useRightDock,type SideChatRef} from '../../stores/right-dock-store';
import {loadMessages,loadSessions,switchSession} from '../../stores/session-actions';
import {SubagentSessionPreview} from '../chat/SubagentSessionPreview';
import {subscribeStreamKey} from '../../services/stream-key-dispatcher';
import {getWebSocket} from '../../services/websocket';
import {hanaFetch} from '../../hooks/use-hana-fetch';
import {engineeringRequest} from '../../engineering/state';
import {renderMarkdown} from '../../utils/markdown';
import type {SessionConfirmationBlock} from '../../stores/chat-types';
// Connector (MCP) form questions need the full form renderer; a bare approve would submit an empty answer.
import {SessionConfirmationPrompt} from '../input/SessionConfirmationPrompt';
import type {AttachedFile} from '../../stores/input-slice';
import {AttachmentChip} from '../shared/AttachmentChip';
import {AppIcon} from '../../ui/app-icons';
import {FormSelectControl} from '../../engineering/FormSelect';
import {readAppFileDragPayload,clearAppFileDragPayload} from '../../utils/app-file-drag';
import './SideConversation.css';

const EMPTY_FILES:AttachedFile[]=[];
function draftDocument(text:string,files:AttachedFile[]){return {type:'doc',content:[{type:'paragraph',content:[...(text?[{type:'text',text}]:[]),...files.map(file=>({type:'fileBadge',attrs:{...file,inlineAttachment:true}}))]}]};}
function filesFromDocument(doc:any):AttachedFile[]{return doc?.content?.flatMap((part:any)=>part.content||[]).filter((part:any)=>part.type==='fileBadge').map((part:any)=>part.attrs)||EMPTY_FILES;}
const base64=(file:File)=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('文件读取失败'));reader.readAsDataURL(file);});

export function SideConversation({scope,active}:{scope:string;active:boolean}){
 const source=useStore(s=>s.currentSessionPath),connection=useStore(s=>s.activeServerConnectionId),ref=useRightDock(s=>s.views[scope]?.sideChat);
 const models=useStore(s=>s.models);
 const [includeContext,setIncludeContext]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState<SessionConfirmationBlock|null>(null);
 const text=useStore(s=>ref?sessionScopedValue(s,s.drafts,ref.sessionPath)||'':''),doc=useStore(s=>ref?sessionScopedValue(s,s.draftDocs,ref.sessionPath):undefined);
 const files=filesFromDocument(doc),streaming=useStore(s=>ref?selectIsStreamingSession(s,ref.sessionPath):false);
 const [running,setRunning]=useState(false),scroll=useRef<HTMLDivElement>(null),picker=useRef<HTMLInputElement>(null),flight=useRef(false);
 const [newChat,setNewChat]=useState(false);
 const [modelPending,setModelPending]=useState(false);
 const submitted=useRef<{sessionPath:string;text:string;doc:unknown}|null>(null);
 const owned=()=>dockScope(useStore.getState())===scope&&useStore.getState().activeServerConnectionId===connection;
 useEffect(()=>{setPending(null);setRunning(false);setError('');if(!ref)return;void loadMessages(ref.sessionPath);
  return subscribeStreamKey(ref.sessionPath,(event:any)=>{
   if(!owned())return;
   if(['turn_start','text_delta','tool_start','thinking_start'].includes(event.type)){
    setRunning(true);const sent=submitted.current,latest=useStore.getState();
    if(sent?.sessionPath===ref.sessionPath){
     if(sessionScopedValue(latest,latest.drafts,ref.sessionPath)===sent.text&&sessionScopedValue(latest,latest.draftDocs,ref.sessionPath)===sent.doc)latest.clearDraft(ref.sessionPath);
     submitted.current=null;
    }
   }
   if(event.type==='content_block'&&event.block?.type==='session_confirmation'&&event.block.status==='pending')setPending(event.block);
   // The form prompt posts its own answer; once the agent moves on, the question has been resolved.
   if(['text_delta','tool_end','thinking_start'].includes(event.type))setPending(current=>current?.kind==='mcp_elicitation'?null:current);
   if(event.type==='turn_end'){setRunning(false);setPending(null);void loadMessages(ref.sessionPath);}
   if(event.type==='error'){setRunning(false);setError(String(event.message||event.error||'侧边对话未完成'));}
  });
 },[ref?.sessionId,scope,connection]);
 useEffect(()=>{
  if(!ref||!active||!modelPending)return;let disposed=false;const target=ref;
  const check=async()=>{try{const response=await hanaFetch('/api/models/selection?sessionPath='+encodeURIComponent(target.sessionPath));const data=await response.json();if(disposed||!owned())return;
    if(data.selection?.state==='applied'){patchDockView(scope,{sideChat:{...target,model:data.selection.id,provider:data.selection.provider}});setModelPending(false);setNotice('侧边模型已切换');}
    else if(['failed','cancelled'].includes(data.selection?.state)){setModelPending(false);setError(data.selection.error||'侧边模型切换已取消');}
  }catch{/* Keep the last confirmed identity until the next successful query. */}};
  void check();const timer=setInterval(()=>{if(!document.hidden)void check();},1000);return()=>{disposed=true;clearInterval(timer);};
 },[ref?.sessionId,scope,connection,active,modelPending]);
  const save=(nextText:string,nextFiles=files)=>{if(ref&&owned())useStore.getState().setDraft(ref.sessionPath,nextText,draftDocument(nextText,nextFiles));};
 const create=async()=>{
  if(!source||flight.current)return;flight.current=true;setBusy(true);setError('');
  try{const created=await engineeringRequest('/side-chat/new',source,{includeContext});
   patchDockView(scope,{sideChat:created as SideChatRef});await loadSessions();if(owned()){setNewChat(false);await loadMessages(created.sessionPath);}
  }catch(reason){if(owned())setError(reason instanceof Error?reason.message:String(reason));}
  finally{flight.current=false;if(owned())setBusy(false);}
 };
 const upload=async(incoming:File[])=>{
  if(!ref||flight.current||!incoming.length)return;flight.current=true;setBusy(true);setError('');const target=ref;
  try{const attached:AttachedFile[]=[];for(const file of incoming){
   const bytes=await base64(file);if(useStore.getState().activeServerConnectionId!==connection)throw Error('服务连接已切换，停止上传');
   const response=await hanaFetch('/api/upload-blob',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionPath:target.sessionPath,name:file.name,mimeType:file.type||'application/octet-stream',base64Data:bytes}),throwOnHttpError:false});
   const data=await response.json(),item=data.uploads?.[0];if(!response.ok||!item||item.error)throw Error(item?.error||data.error||'文件未附加');attached.push({fileId:item.fileId,path:item.dest||item.filePath,name:item.name||file.name,mimeType:file.type});
   if(useStore.getState().activeServerConnectionId!==connection)return;
   const latest=useStore.getState(),current=filesFromDocument(sessionScopedValue(latest,latest.draftDocs,target.sessionPath));
   latest.setDraft(target.sessionPath,sessionScopedValue(latest,latest.drafts,target.sessionPath)||'',draftDocument(sessionScopedValue(latest,latest.drafts,target.sessionPath)||'',[...current,attached.at(-1)!]));
  }}catch(reason){if(owned())setError(reason instanceof Error?reason.message:String(reason));}
  finally{flight.current=false;if(owned())setBusy(false);}
 };
 const send=async()=>{
  if(!ref||busy||running||streaming||(!text.trim()&&!files.length))return;
  const ws=getWebSocket();if(!ws||ws.readyState!==1){setError('未连接，输入已保留');return;}
  const target=ref,clientMessageId=crypto.randomUUID(),payloadText=[text,...files.map(file=>`[附件] ${file.fileId?file.name:file.path}`)].filter(Boolean).join('\n\n');
  const attachments=files.map(file=>({...file,isDir:!!file.isDirectory}));
  try{submitted.current={sessionPath:target.sessionPath,text,doc};ws.send(JSON.stringify({type:'prompt',sessionId:target.sessionId,sessionPath:target.sessionPath,clientMessageId,text:payloadText,
   displayMessage:{text,attachments},sessionFileRefs:files.filter(file=>file.fileId).map(file=>({fileId:file.fileId,sessionId:target.sessionId,sessionPath:target.sessionPath,label:file.name,kind:'attachment'}))}));
   useStore.getState().appendOptimisticUserMessage(target.sessionPath,{id:clientMessageId,role:'user',text,textHtml:renderMarkdown(text),timestamp:Date.now(),attachments,sendStatus:'pending'});
   setRunning(true);setError('');
  }catch(reason){submitted.current=null;setError(reason instanceof Error?reason.message:'消息未发送，输入已保留');}
 };
 const confirm=async(action:'confirmed'|'rejected')=>{
  if(!pending||busy)return;setBusy(true);const request=pending;
  try{const response=await hanaFetch('/api/confirm/'+encodeURIComponent(request.confirmId),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action}),throwOnHttpError:false});if(!response.ok)throw Error('授权结果未确认');if(owned())setPending(null);}
  catch(reason){if(owned())setError(String(reason));}finally{if(owned())setBusy(false);}
 };
 const dropPaths=async(paths:string[])=>{
  if(!ref||flight.current)return;flight.current=true;setBusy(true);setError('');const target=ref;
  try{const response=await hanaFetch('/api/upload',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionPath:target.sessionPath,paths}),throwOnHttpError:false});const result=await response.json();
   if(!response.ok)throw Error(result.error||'文件未附加');
   if(useStore.getState().activeServerConnectionId!==connection)return;
   const entries=(result.uploads||[]).filter((file:any)=>!file.error).map((file:any)=>({path:file.dest||file.filePath,fileId:file.fileId,name:file.name,isDirectory:file.isDirectory}));
   const latest=useStore.getState(),currentText=sessionScopedValue(latest,latest.drafts,target.sessionPath)||'';
   latest.setDraft(target.sessionPath,currentText,draftDocument(currentText,[...filesFromDocument(sessionScopedValue(latest,latest.draftDocs,target.sessionPath)),...entries]));
   if((result.uploads||[]).some((file:any)=>file.error))throw Error('部分附件未成功，已保留成功附加的文件');
  }catch(reason){if(owned())setError(String(reason));}finally{flight.current=false;if(owned())setBusy(false);}
 };
 const changeModel=async(value:string)=>{
  if(!ref||busy)return;const target=ref;setBusy(true);setError('');const slash=value.indexOf('/');
  try{const response=await hanaFetch('/api/models/switch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionPath:target.sessionPath,provider:value.slice(0,slash),modelId:value.slice(slash+1)}),throwOnHttpError:false});const result=await response.json();if(!response.ok)throw Error(result.error||'模型未切换');
   patchDockView(scope,{sideChat:{...target,model:result.model?.id||target.model,provider:result.model?.provider||target.provider}});
   if(result.selection?.state==='pending'&&owned()){setNotice('模型将在侧边任务的下一次请求切换。');setModelPending(true);}
  }catch(reason){if(owned())setError(String(reason));}finally{if(owned())setBusy(false);}
 };
 return <div className="enigma-side-conversation" data-input-ctx-zone="" onDragOver={event=>{if(event.dataTransfer.types.includes('Files')||readAppFileDragPayload(event.dataTransfer)){event.preventDefault();event.stopPropagation();}}} onDrop={event=>{event.preventDefault();event.stopPropagation();const payload=readAppFileDragPayload(event.dataTransfer);if(payload){void dropPaths(payload.files.map(file=>file.path));clearAppFileDragPayload(payload.dragId);}else void upload(Array.from(event.dataTransfer.files));}}>
  <header><div><strong>侧边对话</strong><small>{ref?.contextIncluded?'已附带创建时的主对话文字背景。':'独立提问或处理问题，主对话继续保留。'}</small></div>{ref&&<><button type="button" onClick={()=>setNewChat(true)} data-tooltip="另开侧边对话，旧对话保留在历史中">新建</button><button type="button" onClick={()=>void switchSession(ref.sessionPath)} data-tooltip="在主栏使用完整编辑器继续此对话">打开完整对话</button></>}</header>
  {(!ref||newChat)?<section className="enigma-side-start"><p>可讨论当前任务、读取资料或安排修复。文件操作沿用原对话的权限，新的写入仍按权限规则确认。</p><label><input type="checkbox" checked={includeContext} onChange={event=>setIncludeContext(event.target.checked)}/> 附带主对话的文字背景</label><button type="button" disabled={!source||busy} onClick={()=>void create()}>{busy?'正在创建…':'开始侧边对话'}</button>{newChat&&<button onClick={()=>setNewChat(false)}>返回现有对话</button>}{!source&&<p>先开始一个主对话，再在旁边提问。</p>}</section>:<>
   <div ref={scroll} className="enigma-side-messages"><SubagentSessionPreview taskId={`side:${ref.sessionId}`} sessionId={ref.sessionId} sessionPath={ref.sessionPath} agentId={ref.agentId} streamStatus={running||streaming?'running':'done'} scrollContainerRef={scroll}/></div>
   {pending?.kind==='mcp_elicitation'&&<div className="enigma-side-elicitation"><SessionConfirmationPrompt block={pending}/></div>}
   {pending&&pending.kind!=='mcp_elicitation'&&<section className="enigma-side-approval"><strong>{pending.kind==='tool_action_approval'?'允许 Enigma 执行这次操作':pending.title}</strong><pre>{pending.subject?.label}\n{pending.subject?.detail}</pre><button disabled={busy} onClick={()=>void confirm('rejected')}>拒绝</button><button disabled={busy} onClick={()=>void confirm('confirmed')}>仅同意这次</button></section>}
   <div className="enigma-side-compose"><FormSelectControl label="侧边模型" disabled={busy} value={`${ref.provider}/${ref.model}`} options={models.map(model=>({value:`${model.provider}/${model.id}`,label:model.name||model.id}))} onChange={value=>void changeModel(value)}/><div className="enigma-side-files">{files.map((file,index)=><AttachmentChip key={file.fileId||file.path} icon={<AppIcon name="file" size={14}/>} name={file.name} removeLabel={`移除侧边附件 ${file.name}`} onRemove={()=>save(text,files.filter((_,i)=>i!==index))}/>)}</div><textarea aria-label="侧边对话输入" value={text} rows={3} onChange={event=>save(event.target.value)} placeholder="在这里独立提问… Enter 换行"/>
    <div><button type="button" disabled={busy} onClick={()=>picker.current?.click()}>添加文件</button><input ref={picker} type="file" hidden multiple onChange={event=>{void upload(Array.from(event.target.files||[]));event.target.value='';}}/>{running||streaming?<button type="button" onClick={()=>{const ws=getWebSocket();ws?.send(JSON.stringify({type:'abort',sessionId:ref.sessionId,sessionPath:ref.sessionPath}));}}>停止侧边任务</button>:<button type="button" disabled={busy||(!text.trim()&&!files.length)} onClick={()=>void send()}>发送</button>}</div>
   </div>
  </>}{notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
 </div>;
}
