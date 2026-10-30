import {useEffect,useState} from 'react';
import {chooseDraftVersion,flushInputDrafts,getDraftRecoveryCopies,restoreDraftCopy,retryInputDraft,useDraftSaveState} from '../../stores/input-draft-persistence';
import './DraftSaveNotice.css';
export function DraftSaveNotice({draftKey}:{draftKey:string|null}){
 const savedStatus=useDraftSaveState(s=>draftKey?s.items[draftKey]:undefined),[expanded,setExpanded]=useState(false);
 const status=savedStatus||{state:'saved' as const,localDurable:true};
 useEffect(()=>setExpanded(false),[draftKey]);
 useEffect(()=>{const open=()=>setExpanded(true);window.addEventListener('enigma-draft-recovery',open);return()=>window.removeEventListener('enigma-draft-recovery',open);},[]);
 if(!draftKey||(!savedStatus&&!expanded))return null;
 const needsAttention=status.localDurable===false||['conflict','local-error','unsupported','rejected'].includes(status.state);
 if(!needsAttention&&!expanded)return null;
 const label=status.localDurable===false&&status.state!=='saved'?'本机恢复副本未写入，请复制当前输入，避免关闭时丢失。':{pending:'草稿已存本机，正在同步…',saved:'草稿已同步',offline:'草稿已存本机，连接恢复后自动同步',conflict:'另一个窗口更新了草稿。当前输入和已同步版本均已保留。','local-error':'本机草稿副本未保存成功。请复制输入内容，避免关闭时丢失。',unsupported:'草稿已存本机。更新服务后才能安全同步。',rejected:'服务未接受草稿（大小或容量限制），本机副本已保留。'}[status.state];
 const copies=expanded?getDraftRecoveryCopies(draftKey):[];
 return <div className={`enigma-draft-save is-${status.state}`} aria-live="polite">
  <span>{needsAttention?label:'草稿恢复'}</span>
  {expanded&&<button type="button" aria-label="关闭草稿恢复" onClick={()=>setExpanded(false)}>关闭</button>}
  {['offline','local-error','rejected'].includes(status.state)&&<button type="button" onClick={()=>{retryInputDraft(draftKey);flushInputDrafts();}}>重试保存</button>}
  {status.state==='conflict'&&<>
   <button type="button" onClick={()=>setExpanded(v=>!v)} aria-expanded={expanded}>比较版本</button>
   {expanded&&<div className="enigma-draft-compare"><strong>已同步版本</strong><pre>{status.remote?.text||'（空草稿）'}</pre><button type="button" onClick={()=>chooseDraftVersion(draftKey,'remote')}>使用已同步版本</button><button type="button" onClick={()=>chooseDraftVersion(draftKey,'local')}>保留当前输入并同步</button></div>}
  </>}
  {(status.state!=='saved'||copies.length>0)&&status.state!=='conflict'&&<button type="button" onClick={()=>setExpanded(v=>!v)} aria-expanded={expanded}>恢复副本</button>}
  {expanded&&status.state!=='conflict'&&copies.length>0&&<div className="enigma-draft-compare">{copies.map(copy=><article key={copy.id}><time>{new Date(copy.updatedAt).toLocaleString()}</time><pre>{copy.text||'（空草稿）'}</pre><button type="button" onClick={()=>restoreDraftCopy(copy)}>恢复此副本</button></article>)}</div>}
  {expanded&&status.state!=='conflict'&&!copies.length&&<span>没有需要恢复的未同步副本。</span>}
 </div>;
}
