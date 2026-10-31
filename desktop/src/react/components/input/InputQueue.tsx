import {useCallback,useEffect,useState} from 'react';
import type {Editor} from '@tiptap/core';
import {useStore} from '../../stores';
import {hanaFetch} from '../../hooks/use-hana-fetch';
import './InputQueue.css';
export function InputQueue({editor}:{editor:Editor|null}){
 const session=useStore(s=>s.currentSessionPath),connection=useStore(s=>s.activeServerConnectionId);
 const [queue,setQueue]=useState<any>({items:[],paused:false}),[error,setError]=useState(''),[editing,setEditing]=useState<string|null>(null),[text,setText]=useState(''),[drag,setDrag]=useState<string|null>(null);
 const load=useCallback(async()=>{if(!session||document.hidden)return;try{const r=await hanaFetch(`/api/enigma/input-queue?sessionPath=${encodeURIComponent(session)}`,{throwOnHttpError:false});if(!r.ok)return;const q=await r.json();if(session===useStore.getState().currentSessionPath&&connection===useStore.getState().activeServerConnectionId)setQueue(Array.isArray(q.items)?q:{items:[],paused:false});}catch{}},[session,connection]);
 useEffect(()=>{setQueue({items:[],paused:false});setEditing(null);setError('');void load();const timer=setInterval(()=>void load(),1500);window.addEventListener('enigma-input-queued',load);document.addEventListener('visibilitychange',load);return()=>{clearInterval(timer);window.removeEventListener('enigma-input-queued',load);document.removeEventListener('visibilitychange',load);};},[load]);
 const action=async(body:any)=>{setError('');try{
  const r=await hanaFetch('/api/enigma/input-queue'+(body.action==='send'?'/send':''),{method:body.action==='send'?'POST':'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,sessionPath:session}),throwOnHttpError:false});const result=await r.json();if(!r.ok)throw Error(result.error||'队列操作失败');
  if(session!==useStore.getState().currentSessionPath||connection!==useStore.getState().activeServerConnectionId)return;
  if(body.action==='recall'&&editor){
   const doc=result.doc||{type:'doc',content:[{type:'paragraph',content:result.text?[{type:'text',text:result.text}]:[]}]};
   editor.chain().focus('end').insertContent(doc.content||[]).run();
   useStore.setState(state=>({attachedFiles:[...state.attachedFiles,...(result.attachments||[]).filter((file:any)=>!state.attachedFiles.some(existing=>existing.path===file.path))]}));
  }
  if(body.action==='edit')setEditing(null);await load();
 }catch(error){setError(error instanceof Error?error.message:'操作失败');}};
 if(!session||(!queue.items?.length&&!error))return null;
 return <section className="enigma-input-queue" aria-label="待发送消息"><header><span>消息队列 · {queue.items.length}</span><small>{queue.paused?'已暂停':queue.items.some((item:any)=>item.state==='sending')?'正在处理已交付的消息，其余按序发送':'当前回复结束后依次发送'}</small><button onClick={()=>void action({action:'pause',paused:!queue.paused})}>{queue.paused?'继续队列':'暂停队列'}</button></header>
  {queue.items.map((item:any,index:number)=><article key={item.id} draggable={item.state==='queued'} onDragStart={()=>setDrag(item.id)} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();if(drag)void action({action:'move',id:drag,index});setDrag(null);}}>
   <div className="enigma-queue-text"><span>{index+1}</span>{item.state==='sending'?<details><summary>{item.text?.slice(0,90)||'附件消息'}{item.text?.length>90?'…':''}</summary><p>{item.text||'附件消息'}</p></details>:<p>{item.text||'附件消息'}</p>}<small>{({queued:'等待发送',sending:'已交给助手，处理中',failed:'发送失败',unknown:'需要核对'} as any)[item.state]}</small></div>
   {item.error&&<p role="alert">{item.error}</p>}
   <div className="enigma-queue-actions"><button disabled={item.state==='sending'||index===0} onClick={()=>void action({action:'move',id:item.id,index:index-1})} aria-label={`上移第${index+1}条`}>↑</button><button disabled={item.state==='sending'||index===queue.items.length-1} onClick={()=>void action({action:'move',id:item.id,index:index+1})} aria-label={`下移第${index+1}条`}>↓</button>
    <button disabled={item.state!=='queued'} onClick={()=>{void action({action:'pause',paused:true});setEditing(item.id);setText(item.text);}}>编辑</button>
    <button disabled={item.state==='sending'} onClick={()=>void action({action:'recall',id:item.id})}>撤回输入框</button><button disabled={item.state==='sending'} onClick={()=>void action({action:'remove',id:item.id})}>删除</button>
    {item.state==='queued'&&<button onClick={()=>void action({action:'send',id:item.id})} data-tooltip="现在交给助手；开始接收后不能再撤回">立即引导</button>}
    {['failed','unknown'].includes(item.state)&&<button onClick={()=>void action({action:'retry',id:item.id})}>核对后重新排队</button>}
   </div>
   {editing===item.id&&<form onSubmit={event=>{event.preventDefault();void action({action:'edit',id:item.id,text});}}><textarea aria-label="编辑排队消息" value={text} onChange={event=>setText(event.target.value)}/><button type="submit">保存修改</button><button type="button" onClick={()=>setEditing(null)}>取消编辑</button></form>}
  </article>)}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
