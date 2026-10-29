import {useEffect,useState,type ReactNode} from 'react';
import type {MarkdownHeading} from '../../utils/markdown-document';
import './DocumentNavigation.css';
interface Props {documentId:string;headings:MarkdownHeading[];activeHeadingId:string|null;editable:boolean;wrapLines:boolean;onJump:(heading:MarkdownHeading)=>void;onFind:()=>void;onGotoLine:()=>void;onToggleWrap:()=>void;onFold?:()=>void;onUnfold?:()=>void;children?:ReactNode}
/** Persistent entry points; the outline occupies its own row and never covers the document. */
export function DocumentNavigation({documentId,headings,activeHeadingId,editable,wrapLines,onJump,onFind,onGotoLine,onToggleWrap,onFold,onUnfold,children}:Props){
 const [outline,setOutline]=useState(false),[query,setQuery]=useState('');
 useEffect(()=>{setOutline(false);setQuery('');},[documentId]);
 const shown=headings.filter(h=>h.text.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
 return <div className="enigma-document-navigation">
  <div className="enigma-document-tools" role="toolbar" aria-label="文档阅读工具">
   {headings.length>0&&<button type="button" aria-expanded={outline} onClick={()=>setOutline(v=>!v)} title="打开可搜索目录；支持各级标题">目录 <small>{headings.length}</small></button>}
   <button type="button" onClick={onFind} title={editable?'查找、替换、大小写、整词和正则表达式 · ⌘/Ctrl+F':'查找正文 · ⌘/Ctrl+F'}>{editable?'查找 / 替换':'查找'}</button>
   {editable&&<><button type="button" onClick={onGotoLine} title="按行号、相对偏移或百分比定位">跳转行</button><button type="button" aria-pressed={wrapLines} onClick={onToggleWrap} title="只改变显示方式，不修改文件换行">自动换行</button></>}
   {onFold&&<button type="button" onClick={onFold} title="折叠代码或章节结构">折叠</button>}{onUnfold&&<button type="button" onClick={onUnfold} title="展开全部已折叠结构">展开</button>}
   {children}
  </div>
  {outline&&<nav className="enigma-document-outline" aria-label="文档目录"><input aria-label="筛选目录" placeholder="筛选标题…" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){setOutline(false);e.stopPropagation();}}}/><div>{shown.length?shown.map(h=><button type="button" key={h.id} style={{paddingInlineStart:8+(h.level-1)*12}} aria-current={h.id===activeHeadingId?'location':undefined} onClick={()=>onJump(h)} title={`第 ${h.line+1} 行 · ${h.level} 级标题`}>{h.text}</button>):<p>没有匹配的章节</p>}</div></nav>}
 </div>;
}
