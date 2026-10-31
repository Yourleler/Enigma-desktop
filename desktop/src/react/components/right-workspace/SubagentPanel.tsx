import {useEffect,useRef,useState} from 'react';
import {useStore} from '../../stores';
import {selectAgentActivities} from '../../stores/agent-activity-slice';
import {SubagentSessionPreview} from '../chat/SubagentSessionPreview';
import {hanaFetch} from '../../hooks/use-hana-fetch';
import {buildItemsFromHistory} from '../../utils/history-builder';

function hasTask(value:unknown,id:string,depth=0):boolean{
 if(depth>12||!value||typeof value!=='object')return false;
 if(Array.isArray(value))return value.some(v=>hasTask(v,id,depth+1));
 const row=value as Record<string,unknown>;return row.taskId===id||Object.values(row).some(v=>hasTask(v,id,depth+1));
}
export function SubagentPanel(){
 const session=useStore(s=>s.currentSessionPath),connection=useStore(s=>s.activeServerConnectionId),activities=useStore(selectAgentActivities(session));
 const rows=activities.filter(a=>a.kind==='subagent'),[chosen,setChosen]=useState(''),[error,setError]=useState(''),[locating,setLocating]=useState(false),scroll=useRef<HTMLDivElement>(null);
 const entry=rows.find(a=>a.id===chosen)||rows[0];
 useEffect(()=>{setChosen('');setError('');},[session,connection]);
 useEffect(()=>{if(entry?.childSessionPath)useStore.getState().setSubagentPreviewSessionPath(entry.id,entry.childSessionPath);},[entry?.id,entry?.childSessionPath]);
 const locate=async()=>{
  if(!entry||!session)return;setError('');setLocating(true);
  try{const r=await hanaFetch('/api/sessions/messages?all=1&path='+encodeURIComponent(session));const data=await r.json();if(!r.ok)throw Error('父对话暂不可读取');
   if(useStore.getState().currentSessionPath!==session||useStore.getState().activeServerConnectionId!==connection)return;
   const item=buildItemsFromHistory(data).find(item=>item.type==='message'&&hasTask(item.data.blocks,entry.id));
   if(item?.type!=='message'||!/^\d+$/.test(item.data.id))throw Error('原对话中没有找到可定位的子任务消息，执行记录仍可在这里查看');
   useStore.getState().requestMessageLocate({sessionPath:session,messageIndex:Number(item.data.id),term:''});
  }catch(e){if(useStore.getState().currentSessionPath===session&&useStore.getState().activeServerConnectionId===connection)setError(e instanceof Error?e.message:String(e));}finally{setLocating(false);}
 };
 return <section className="enigma-subagent-panel"><header><strong>协作助手</strong><p>查看本对话启动的子任务和执行记录。</p>{rows.length>0&&<select aria-label="选择子任务" value={entry?.id||''} onChange={e=>setChosen(e.target.value)}>{rows.map(row=><option key={row.id} value={row.id}>{row.label||row.agentName||row.id} · {({running:'运行中',done:'已结束',failed:'失败',aborted:'已停止'} as any)[row.status]}</option>)}</select>}{entry&&<button disabled={locating} onClick={locate}>{locating?'定位中…':'在父对话中定位'}</button>}</header>{error&&<p role="status">{error}</p>}{entry?<div ref={scroll} className="enigma-subagent-transcript"><p>{entry.summary}</p><SubagentSessionPreview taskId={entry.id} sessionId={entry.childSessionId} sessionPath={entry.childSessionPath} agentId={entry.agentId} streamStatus={entry.status} summary={entry.summary} scrollContainerRef={scroll}/></div>:<p>本对话还没有协作助手任务。</p>}</section>;
}
