import {useEffect,useState,type ReactNode} from 'react';
import type {MarkdownHeading} from '../../utils/markdown-document';
import {previewCopyInfo} from '../../utils/preview-copy';
import {SurfaceMenu} from '../../engineering/SurfaceMenu';
import './DocumentNavigation.css';
interface Props {documentId:string;contentType?:string;language?:string|null;findOpen?:boolean;headings:MarkdownHeading[];activeHeadingId:string|null;editable:boolean;wrapLines:boolean;onJump:(heading:MarkdownHeading)=>void;onFind:()=>void;onGotoLine:()=>void;onToggleWrap:()=>void;onFold?:()=>void;onUnfold?:()=>void;children?:ReactNode}
function SearchIcon(){return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>;}
function HelpIcon(){return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 1.7-2.5 1.9-2.5 3.5M12 17h.01"/></svg>;}
/** Keep navigation on the left, and document actions, search and help on the right. */
export function DocumentNavigation({documentId,contentType,language,findOpen,headings,activeHeadingId,editable,wrapLines,onJump,onFind,onGotoLine,onToggleWrap,onFold,onUnfold,children}:Props){
 const [outline,setOutline]=useState(false),[query,setQuery]=useState('');
 useEffect(()=>{setOutline(false);setQuery('');},[documentId]);
 const shown=headings.filter(h=>h.text.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
 const findHint=editable?'查找和替换当前文件内容 · ⌘/Ctrl+F':contentType==='html'?'查找当前网页内的可见文字 · ⌘/Ctrl+F':'查找当前文档正文 · ⌘/Ctrl+F';
 return <div className="enigma-document-navigation">
  <div className="enigma-document-tools" role="toolbar" aria-label="文档阅读工具">
   <div className="enigma-document-leading">
    {headings.length>0?<button type="button" aria-expanded={outline} onClick={()=>setOutline(v=>!v)} data-tooltip="查看或筛选文档章节" title="打开可搜索目录；支持各级标题">目录 <small>{headings.length}</small></button>:<span className="enigma-document-mode">{contentType==='html'?'网页预览':editable?'文件编辑':'文件预览'}</span>}
   </div>
   <div className="enigma-document-actions" data-document-type={contentType}>
    {children}
    {editable&&<SurfaceMenu label="阅读选项" hint="跳转行、自动换行与章节折叠" icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>}>
     <button type="button" aria-label="跳转行" onClick={onGotoLine}>跳转行<small>输入行号、相对偏移或百分比</small></button>
     <button type="button" aria-label="自动换行" aria-pressed={wrapLines} onClick={onToggleWrap}>自动换行<small>{wrapLines?'已开启':'已关闭'} · 只改变显示，不改动文件</small></button>
     {onFold&&<button type="button" onClick={onFold}>折叠全部章节</button>}{onUnfold&&<button type="button" onClick={onUnfold}>展开全部章节</button>}
    </SurfaceMenu>}
    <button className="enigma-document-find-trigger" type="button" onClick={onFind} aria-label={editable?'查找 / 替换':'查找正文'} aria-expanded={editable?undefined:findOpen} data-tooltip={findHint} title={findHint}><SearchIcon/><span>查找</span></button>
    <SurfaceMenu label="文件预览帮助" hint="了解查找范围、复制内容及文件操作" icon={<HelpIcon/>} stayOpen panelClassName="enigma-document-help">
     <strong>文件操作说明</strong>
     <p><b>查找</b>{editable?'搜索当前文件内容，可替换、区分大小写或使用正则表达式。':'只搜索当前打开文档'+(contentType==='html'?'中的可见网页文字。':'的正文。')}</p>
     <p><b>{previewCopyInfo(contentType,language).label}</b>{previewCopyInfo(contentType,language).description}复制选中的部分请使用 ⌘/Ctrl+C。</p>
     <p><b>其他操作</b>相机图标制作内容截图。{contentType==='markdown'?'眼睛图标切换阅读与编辑；行号、换行和折叠在“阅读选项”中。':'悬停其他图标可查看对应操作名称。'}</p>
     <p className="enigma-document-help-shortcuts">⌘/Ctrl+F 查找 · Enter 下一项 · Shift+Enter 上一项 · Esc 关闭</p>
    </SurfaceMenu>
   </div>
  </div>
  {outline&&<nav className="enigma-document-outline" aria-label="文档目录"><input aria-label="筛选目录" placeholder="筛选标题…" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){setOutline(false);e.stopPropagation();}}}/><div>{shown.length?shown.map(h=><button type="button" key={h.id} style={{paddingInlineStart:8+(h.level-1)*12}} aria-current={h.id===activeHeadingId?'location':undefined} onClick={()=>onJump(h)} title={`第 ${h.line+1} 行 · ${h.level} 级标题`}>{h.text}</button>):<p>没有匹配的章节</p>}</div></nav>}
 </div>;
}
