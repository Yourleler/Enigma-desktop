import {useEffect,useState} from 'react';
import {hanaFetch} from '../../hooks/use-hana-fetch';
import {useRepositoryContext,type RepositoryContext} from '../chat/RepositoryContext';
import {AppIcon} from '../../ui/app-icons';
export interface ResourceMention {kind:'resource';id:string;name:string;detail:string;reference:string}
export function ResourceMentionPicker({kind,query,onSelect}:{kind:'repositories'|'branches'|'github';query:string;onSelect:(item:ResourceMention)=>void}){
 const {repositories,request}=useRepositoryContext(),[root,setRoot]=useState(''),[repo,setRepo]=useState(''),[branchQuery,setBranchQuery]=useState(''),[page,setPage]=useState(1),[rows,setRows]=useState<any[]>([]),[next,setNext]=useState<number|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const selectedRoot=root||repositories.find(r=>r.git)?.path||'';
 useEffect(()=>{setRoot('');setRepo('');setPage(1);setError('');},[kind]);
 useEffect(()=>{
  if(kind==='repositories')return;
  if(kind==='branches'&&!selectedRoot){setRows([]);return;}
  let active=true;setBusy(true);setError('');setRows([]);
  const promise=kind==='github'?hanaFetch('/api/enigma/github/resources?'+new URLSearchParams({page:String(page),...(repo?{repo}: {})}),{throwOnHttpError:false}):hanaFetch('/api/enigma/repositories/context',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...request,branchRoot:selectedRoot}),throwOnHttpError:false});
  promise.then(async response=>{const value=await response.json();if(!response.ok)throw Error(value.error);if(active){setRows(kind==='github'?value.items:value.branches.map((name:string)=>({name})));setNext(value.nextPage||null);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setBusy(false);});
  return()=>{active=false;};
 },[kind,selectedRoot,repo,page,JSON.stringify(request)]);
 const choose=(name:string,reference:string)=>onSelect({kind:'resource',id:reference,name,reference,detail:reference});
 const needle=kind==='github'&&repo?branchQuery:query;
 const filtered=rows.filter(row=>!needle||`${row.name} ${row.description||''}`.toLowerCase().includes(needle.toLowerCase()));
 const local=(item:RepositoryContext,branch?:string)=>choose(branch?`${item.name} · ${branch}`:item.name,`本地仓库：${item.path}${branch?`\n参考分支：${branch}（仅引用，不切换工作分支）`:''}`);
 return <div className="enigma-resource-picker">
  {kind==='repositories'?<>{repositories.filter(r=>!query||`${r.name} ${r.path}`.toLowerCase().includes(query.toLowerCase())).map(r=><button key={r.path} onMouseDown={e=>e.preventDefault()} onClick={()=>local(r)}><AppIcon name="project" size={17}/><span>{r.name}<small>{r.branch||'工作目录'} · {r.path}</small></span></button>)}{!repositories.length&&<p>先在输入框下方添加仓库或工作目录。</p>}</>:<>
   {kind==='branches'&&<select aria-label="选择分支所属仓库" value={selectedRoot} onChange={e=>{setRoot(e.target.value);setPage(1);}}>{repositories.filter(r=>r.git).map(r=><option key={r.path} value={r.path}>{r.name}</option>)}</select>}
   {kind==='github'&&<div className="enigma-resource-breadcrumb">{repo?<><button onClick={()=>{setRepo('');setPage(1);}}>← 仓库</button><strong>{repo}</strong><button onClick={()=>choose(repo,`GitHub 仓库：https://github.com/${repo}`)}>引用整个仓库</button></>:<p>GitHub 已登录账号可访问的仓库</p>}</div>}
   {kind==='github'&&repo&&<input aria-label="搜索GitHub分支" placeholder="搜索分支" value={branchQuery} onChange={e=>setBranchQuery(e.target.value)}/>}
   {busy&&<p role="status">正在读取…</p>}{error&&<p role="alert">{error}</p>}
   {filtered.map(row=><button key={row.name} onMouseDown={e=>e.preventDefault()} onClick={()=>{if(kind==='github'&&!repo){setRepo(row.name);setBranchQuery('');setPage(1);}else if(kind==='github')choose(`${repo} · ${row.name}`,`GitHub 仓库：https://github.com/${repo}\n参考分支：${row.name}\n固定提交：${row.sha}\n链接：${row.url}`);else local(repositories.find(r=>r.path===selectedRoot)!,row.name);}}><AppIcon name={kind==='github'&&!repo?'project':'loop'} size={17}/><span>{row.name}<small>{kind==='github'&&!repo?`${row.private?'私有仓库':'公开仓库'} · ${row.branch}`:'引用此分支'}</small></span></button>)}
   {!busy&&!error&&!filtered.length&&<p>没有匹配的资源。</p>}
   {kind==='github'&&<footer>{page>1&&<button onClick={()=>setPage(page-1)}>上一页</button>}{next&&<button onClick={()=>setPage(next)}>下一页</button>}<small>选择后引用仓库与分支，不会自动克隆或切换本地分支。</small></footer>}
  </>}
 </div>;
}
