import {useMemo,useState} from 'react';
import {readingRoles,readingText} from './reading-copy';

export function ReadingChapter({chapter,nodes,index,onSource}:{chapter:any;nodes:any[];index:number;onSource:(source:any)=>void}){
  const [open,setOpen]=useState(index===0),[query,setQuery]=useState(''),[limit,setLimit]=useState(8);
  const [expanded,setExpanded]=useState<Record<string,boolean>>({});
  const sources=useMemo(()=>{const byId=new Map(nodes.map(node=>[node.id,node]));return chapter.nodes.map((id:string)=>byId.get(id)).filter(Boolean);},[nodes,chapter.nodes]);
  const filtered=useMemo(()=>{const term=query.trim().toLocaleLowerCase();return term?sources.filter((node:any)=>`${node.source.repo}/${node.source.file} ${node.source.symbol||''} ${node.source.snippet||''}`.toLocaleLowerCase().includes(term)):sources;},[sources,query]);
  const title=chapter.authority==='navigation-hint'?(readingRoles[chapter.title]||chapter.title):chapter.title;
  return <details className="enigma-reading-chapter" open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary><span>{index+1}</span><strong>{title}</strong><small>{sources.length} 个来源</small></summary>
    {open&&<>
      <small>{chapter.authority==='model-inference'?'模型建议 · 需核对源码':'阅读导航提示'}</small>
      <p>{readingText(chapter.summary)}</p>
      <div className="enigma-chapter-sources">
        <label><span>查找本章来源</span><input aria-label={`查找本章来源 ${title}`} placeholder="文件、符号或片段内容" value={query} onChange={event=>{setQuery(event.target.value);setLimit(8);}}/></label>
        <small>显示 {Math.min(limit,filtered.length)} / {filtered.length} 个来源{query&&`，本章共 ${sources.length} 个`}</small>
        {filtered.slice(0,limit).map((node:any)=><div className="enigma-chapter-source" key={node.id}>
          <button className="enigma-chapter-source-toggle" aria-expanded={!!expanded[node.id]} onClick={()=>setExpanded(value=>({...value,[node.id]:!value[node.id]}))} title="展开或收起保存的源码片段"><span className="enigma-chapter-chevron" aria-hidden="true"/>{node.source.repo} / {node.source.file}:{node.source.line}{node.source.symbol&&node.source.symbol!==node.source.file.split('/').pop()&&<small>{node.source.symbol}</small>}</button>
          <button onClick={()=>onSource(node.source)} title="在全量 Diff 中定位此来源">查看差异</button>
          {expanded[node.id]&&<div className="enigma-reading-snippet"><pre>{node.source.snippet}</pre>{node.source.truncated&&<small>保存的片段有截断，请打开完整源码核对。</small>}</div>}
        </div>)}
        {!filtered.length&&<p role="status">本章没有匹配的来源。<button onClick={()=>setQuery('')}>清除查找</button></p>}
        {filtered.length>limit&&<button onClick={()=>setLimit(value=>value+24)}>继续显示来源（剩余 {filtered.length-limit}）</button>}
      </div>
    </>}
  </details>;
}
