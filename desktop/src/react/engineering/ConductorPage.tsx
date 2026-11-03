import {useEffect,useState} from 'react';
import {useStore} from '../stores';
import {hanaFetch} from '../hooks/use-hana-fetch';
import {switchSession} from '../stores/session-actions';
import {ConductorCreateDialog} from './ConductorCreate';
import {AppIcon} from '../ui/app-icons';
import './ConductorPage.css';
export function ConductorPage(){
 const [creating,setCreating]=useState(false),[items,setItems]=useState<any[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const connection=useStore(s=>s.activeServerConnectionId);
 const load=async()=>{setLoading(true);setError('');try{const response=await hanaFetch('/api/enigma/conductors',{throwOnHttpError:false});const value=await response.json();if(!response.ok)throw Error(value.error);setItems(value.conductors||[]);}catch(e){setError(e instanceof Error?e.message:'管家列表读取失败');}finally{setLoading(false);}};
 useEffect(()=>{void load();},[connection]);
 return <section className="enigma-conductor-page"><header><div><h2>任务管家</h2><p>组织多个工作对话，安排模型与仓库，跟踪执行和验收。</p></div></header>
  <nav aria-label="管家页面"><button aria-pressed={!creating} onClick={()=>setCreating(false)}>我的管家 <small>{items.length}</small></button><button aria-pressed={creating} onClick={()=>setCreating(true)}>新建管家</button></nav>
  <div className="enigma-conductor-content">{creating?<ConductorCreateDialog embedded close={()=>setCreating(false)}/>:<><div className="enigma-page-refresh"><button className="enigma-ghost-button" disabled={loading} onClick={()=>void load()}><AppIcon name="refresh" size={15} className={loading?'enigma-refreshing':''}/>{loading?'正在刷新…':'刷新列表'}</button></div>{error&&<p role="alert">{error}</p>}{!loading&&!items.length&&<div className="enigma-conductor-empty"><AppIcon name="conductor" size={32}/><h3>让一项工作有序推进</h3><p>管家可以把代码、资料和验证分给多个对话，你可以随时查看分工、停止任务或继续处理。</p><button className="enigma-primary" onClick={()=>setCreating(true)}>创建第一个管家</button></div>}{items.map(item=><button className="enigma-conductor-row" key={item.path} onClick={async()=>{await switchSession(item.path);useStore.getState().setActivePanel(null);useStore.getState().setCurrentTab('chat');}}><AppIcon name="conductor" size={20}/><span><strong>{item.title||'任务管家'}</strong><small>{item.modified?new Date(item.modified).toLocaleString('zh-CN'):''}</small></span><span>打开对话 →</span></button>)}</>}</div>
 </section>;
}
