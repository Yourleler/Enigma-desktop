import {SearchField} from '../ui/SearchField';
import {useState} from 'react';
import {AppIcon} from '../ui/app-icons';

type FileChange={repo:string;file:string;change:string;previousPath?:string;attribution?:string};
type TreeNode={name:string;path:string;children:Map<string,TreeNode>;file?:FileChange};
export function changeTree(files:FileChange[]){
 const root:TreeNode={name:'',path:'',children:new Map()};
 for(const file of files){let node=root;for(const part of file.file.split('/')){const path=node.path?`${node.path}/${part}`:part;if(!node.children.has(part))node.children.set(part,{name:part,path,children:new Map()});node=node.children.get(part)!;}node.file=file;}
 return root;
}
const fileId=(file:FileChange)=>`${file.repo}:${file.file}`;
const marks:Record<string,string>={added:'A',modified:'M',deleted:'D',renamed:'R',unknown:'?'};
const names:Record<string,string>={added:'新增',modified:'修改',deleted:'删除',renamed:'重命名',unknown:'范围未定'};
function Folder({node,selected,reviewed,onSelect}:{node:TreeNode;selected:string;reviewed:string[];onSelect:(file:FileChange)=>void}){
 if(node.file)return <button className="enigma-change-tree-file" aria-current={selected===fileId(node.file)?'true':undefined} title={`${node.file.file} · ${names[node.file.change]||node.file.change}${node.file.previousPath?` · 原路径 ${node.file.previousPath}`:''}${node.file.attribution==='unattributed'?' · 归属待确认':''}`} onClick={()=>onSelect(node.file!)}>
  <AppIcon name="file" size={14}/><span>{node.name}</span><small data-change={node.file.change}>{reviewed.includes(fileId(node.file))?'✓':marks[node.file.change]||'M'}</small>
 </button>;
 let current=node,label=node.name;
 while(current.children.size===1&&!current.file){const child=[...current.children.values()][0];if(child.file)break;current=child;label+=`/${child.name}`;}
 return <details className="enigma-change-tree-folder" open><summary><AppIcon name="chevronRight" size={12}/><AppIcon name="project" size={14}/><span title={label}>{label}</span></summary><div className="enigma-change-tree-children">{[...current.children.values()].sort((a,b)=>Number(!!a.file)-Number(!!b.file)||a.name.localeCompare(b.name)).map(child=><Folder key={child.path} node={child} selected={selected} reviewed={reviewed} onSelect={onSelect}/>)}</div></details>;
}
export function ChangeFileTree({files,roots,repositories,input,selected,reviewed,onSelect,onSource,query,onQuery,flat,onFlat}:{files:FileChange[];roots:any[];repositories:any[];input:any;selected:string;reviewed:string[];onSelect:(file:FileChange)=>void;onSource:(repo:string,kind:'working'|'staged'|'unstaged'|'commit',commit?:string)=>void;query:string;onQuery:(value:string)=>void;flat:boolean;onFlat:()=>void}){
 const [expandedRepos,setExpandedRepos]=useState<Record<string,boolean>>({});
 const renderFiles=(repo:string)=>{const matches=files.filter(file=>file.repo===repo);return flat?matches.map(file=><Folder key={fileId(file)} node={{name:file.file,path:file.file,children:new Map(),file}} selected={selected} reviewed={reviewed} onSelect={onSelect}/>):[...changeTree(matches).children.values()].map(node=><Folder key={node.path} node={node} selected={selected} reviewed={reviewed} onSelect={onSelect}/>);};
 const git=input?.source==='git';
 return <nav className="enigma-change-tree" aria-label="变更文件列表">
  <header><strong>变更文件</strong><button aria-label={flat?'切换目录树':'切换平铺列表'} title={flat?'按目录层级浏览':'按完整路径平铺'} onClick={onFlat}><AppIcon name={flat?'project':'layers'} size={15}/></button></header>
  <SearchField aria-label="搜索变更文件" placeholder="搜索文件或路径" value={query} onChange={e=>onQuery(e.target.value)}/>
  <div className="enigma-change-tree-scroll">
   {(git?repositories:roots).map(repo=>{const isSelected=!input?.repo||input.repo===repo.id;const matches=files.filter(file=>file.repo===repo.id);const open=expandedRepos[repo.id]??(isSelected||repositories.length<4);
    return <details key={repo.id} className="enigma-change-tree-repo" open={open} onToggle={e=>{const value=e.currentTarget.open;setExpandedRepos(previous=>previous[repo.id]===value?previous:{...previous,[repo.id]:value});}}>
     <summary><AppIcon name="chevronRight" size={12}/><AppIcon name="project" size={15}/><span title={repo.name||repo.id}>{repo.name||repo.id}</span><small>{git?repo.branch:matches.length}</small></summary>
     <div className="enigma-change-tree-children">{git?<>
      {([['working','全部未提交'],['staged','已暂存'],['unstaged','未暂存']] as const).map(([kind,label])=>{const active=isSelected&&input.kind===kind;const state=repo.state;const count=!state?null:kind==='working'?new Set([...state.staged,...state.unstaged,...state.untracked,...state.conflicts]).size:kind==='staged'?state.staged.length:state.unstaged.length+state.untracked.length;return <div key={kind}>
       <button className="enigma-change-tree-scope" aria-current={active?'true':undefined} aria-label={`${repo.name} ${label}`} title={`${label}${kind==='working'?'，相对 HEAD，包含已暂存内容':kind==='unstaged'?'，相对暂存区，包含新文件':''}`} onClick={()=>onSource(repo.id,kind)}><AppIcon name={active?'chevronDown':'chevronRight'} size={12}/><span>{label}</span><small>{count??'—'}</small></button>
       {active&&<div className="enigma-change-tree-children">{renderFiles(repo.id)}{!matches.length&&<p>{query?'没有匹配文件':'此范围没有变更'}</p>}</div>}
      </div>;})}
      <details open={isSelected&&input.kind==='commit'}><summary><AppIcon name="chevronRight" size={12}/><span>最近提交</span><small>{repo.commits.length}</small></summary><div className="enigma-change-tree-children">{repo.commits.map((commit:any)=>{const active=isSelected&&input.kind==='commit'&&input.target?.[repo.id]===commit.id;return <div key={commit.id}><button className="enigma-change-tree-commit" aria-current={active?'true':undefined} aria-label={`查看提交 ${commit.title} (${commit.id.slice(0,8)})`} title={`${commit.title}\n${commit.id}`} onClick={()=>onSource(repo.id,'commit',commit.id)}><AppIcon name={active?'chevronDown':'chevronRight'} size={12}/><span>{commit.title}</span></button>{active&&<div className="enigma-change-tree-children">{renderFiles(repo.id)}</div>}</div>;})}</div></details>
      {isSelected&&input.kind==='commit'&&!repo.commits.some((commit:any)=>input.target?.[repo.id]===commit.id)&&<details open><summary><AppIcon name="chevronRight" size={12}/><span>所选比较范围</span><small>{matches.length}</small></summary><div className="enigma-change-tree-children">{renderFiles(repo.id)}</div></details>}
      {repo.stateError&&<p>{repo.stateError}</p>}
     </>:renderFiles(repo.id)}</div>
    </details>;
   })}
   {!files.length&&!git&&<p>没有匹配文件</p>}
  </div>
 </nav>;
}
