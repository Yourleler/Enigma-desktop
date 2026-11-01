import {SearchField} from '../ui/SearchField';
import { GlassSelection } from '../ui/GlassSelection';
import { useEffect, useRef, useState } from 'react';
import { engineeringRequest, openEngineering, useEngineering } from './state';

const empty:any[]=[];
interface Page {files:string[];totalFiles:number;totalMatches:number;offset:number;limit:number;version?:string;nextOffset:number|null;truncated?:boolean}
export function FileTree({repo}:{repo?:string}){
  const repositories=useEngineering(s=>s.snapshot?.overview?.repositories||empty),sessionPath=useEngineering(s=>s.sessionPath),connection=useEngineering(s=>s.connectionId);
  const [selected,setSelected]=useState(repo||repositories[0]?.id||''),[draft,setDraft]=useState(''),[query,setQuery]=useState('');
  const [page,setPage]=useState<Page|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
  const pending=useRef<AbortController|null>(null),generation=useRef(0);
  useEffect(()=>{if(repo&&repositories.some((r:any)=>r.id===repo))setSelected(repo);else if(!repositories.some((r:any)=>r.id===selected))setSelected(repositories[0]?.id||'');},[repo,repositories,selected]);
  const read=async(offset:number,version?:string)=>{
    if(!selected||!sessionPath)return;
    pending.current?.abort();const controller=new AbortController(),ticket=++generation.current;pending.current=controller;setLoading(true);setError('');
    const params=new URLSearchParams({query,offset:String(offset),limit:'500'});if(version)params.set('version',version);
    try{
      const value=await engineeringRequest(`/files/${encodeURIComponent(selected)}?${params}`,sessionPath,undefined,controller.signal);
      if(ticket!==generation.current||controller.signal.aborted)return;
      if(!Array.isArray(value.files))throw new Error('服务未返回有效的文件列表。');
      setPage({...value,totalFiles:value.totalFiles??value.files.length,totalMatches:value.totalMatches??value.files.length,offset:value.offset??0,limit:value.limit??500,nextOffset:value.nextOffset??null});
    }catch(error){if(ticket===generation.current&&!controller.signal.aborted)setError(error instanceof Error?error.message:String(error));}
    finally{if(ticket===generation.current){setLoading(false);pending.current=null;}}
  };
  useEffect(()=>{
    setPage(null);setError('');setLoading(false);void read(0);
    return()=>{generation.current++;pending.current?.abort();pending.current=null;};
  },[selected,sessionPath,connection,query,refresh]);
  const search=(event:React.FormEvent)=>{event.preventDefault();if(query===draft.trim())setRefresh(n=>n+1);else setQuery(draft.trim());};
  return <section className="enigma-files">
    <div className="enigma-repo-picker" aria-label="代码仓库" data-glass-segmented=""><GlassSelection selection={selected}/>{repositories.map((item:any)=><button key={item.id} aria-pressed={item.id===selected} data-active={item.id===selected} data-tooltip={`浏览 ${item.id} 的当前文件`} onClick={()=>{setSelected(item.id);setDraft('');setQuery('');}}>{item.id}</button>)}</div>
    <form className="enigma-file-search" onSubmit={search}><SearchField aria-label="按路径查找文件" placeholder="按完整路径或文件名查找" value={draft} maxLength={500} onChange={event=>setDraft(event.target.value)}/><button disabled={!selected||loading}>查找</button><button type="button" disabled={!selected||loading} data-tooltip="重新读取文件路径，回到第一页" onClick={()=>setRefresh(n=>n+1)}>刷新文件列表</button></form>
    <p className="enigma-source-note">搜索覆盖当前仓库的全部可管理文件，每页最多 500 个。依赖、凭证等路径按原规则排除。</p>
    {loading&&<p role="status">正在读取文件路径…</p>}
    {error&&<div className="enigma-error" role="alert">{error}<button onClick={()=>setRefresh(n=>n+1)}>重新读取列表</button></div>}
    {page&&<>
      <p className="enigma-source-note">{page.totalMatches?`显示第 ${page.offset+1}–${page.offset+page.files.length} 个，共 ${page.totalMatches} 个${query?'匹配':''}文件`:'没有匹配的文件'} · 仓库共 {page.totalFiles} 个文件</p>
      {page.truncated&&!page.version&&<p className="enigma-source-note">当前服务返回了部分文件，请更新服务以使用完整搜索和分页。</p>}
      <nav className="enigma-file-list" aria-label={`${selected} 文件列表`} aria-busy={loading}><FileBranches key={`${selected}:${query}:${page.offset}:${page.version}`} files={page.files} repo={selected} expanded={!!query}/></nav>
      {(page.offset>0||page.nextOffset!==null)&&<div className="enigma-inline-actions"><button disabled={loading||!!error||page.offset===0} onClick={()=>void read(Math.max(0,page.offset-page.limit),page.version)}>上一页</button><button disabled={loading||!!error||page.nextOffset===null} onClick={()=>void read(page.nextOffset!,page.version)}>下一页</button><span className="enigma-source-note">按文件路径分页</span></div>}
    </>}
    {!selected&&<p className="enigma-empty">先在“项目与仓库”加入要浏览的仓库。</p>}
  </section>;
}
function FileBranches({files,repo,prefix='',expanded=false}:{files:string[];repo:string;prefix?:string;expanded?:boolean}){
  const folders=new Map<string,string[]>(),leaves:string[]=[];
  for(const file of files){const relative=file.slice(prefix.length),slash=relative.indexOf('/');if(slash<0)leaves.push(file);else{const name=relative.slice(0,slash);let children=folders.get(name);if(!children){children=[];folders.set(name,children);}children.push(file);}}
  return <>{[...folders.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([folder,children])=><details key={folder} className="enigma-file-folder" open={expanded||undefined}><summary aria-label={`${prefix}${folder} 文件夹，本页 ${children.length} 个文件`}><span aria-hidden="true">▱ </span>{folder} <small>{children.length}</small></summary><div><FileBranches files={children} repo={repo} prefix={`${prefix}${folder}/`} expanded={expanded}/></div></details>)}
    {leaves.sort().map(file=><button aria-label={`打开 ${file}`} data-tooltip={`读取 ${repo} / ${file} 的当前内容`} key={file} onClick={()=>openEngineering({id:`file:${repo}:${file}`,title:file.split('/').pop()!,group:'reading',repo,file})}><span aria-hidden="true">▧</span><span>{file.slice(prefix.length)}</span><small>打开</small></button>)}</>;
}
