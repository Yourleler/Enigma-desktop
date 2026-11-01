import {useState} from 'react';
import {readingText} from './reading-copy';
import {RelationshipGraph} from './RelationshipGraph';

export function ChangeMap({reading,onSource}:{reading:any;onSource:(anchor:any)=>void}){
 const [view,setView]=useState('code');
 if(!reading)return <p className="enigma-review-empty">先生成智能阅读，再查看有源码依据的关系图。</p>;
 const sections=view==='repos'?(reading.architecture||[]).map((r:any)=>({id:r.repo,title:r.repo,summary:r.responsibility,nodes:r.nodes,dependsOn:r.dependsOn})):reading.layers||[];
 return <section className="enigma-change-map"><nav className="enigma-reading-tabs" aria-label="关系查看方式">{[['code','源码关系'],['repos','仓库关系'],['layers','分层阅读']].map(([id,label])=><button key={id} aria-pressed={view===id} onClick={()=>setView(id)}>{label}</button>)}</nav>{view!=='code'?<div className="enigma-map-sections"><p>{view==='repos'?'仓库职责与已登记依赖，点击源码查看对应实现。':'按保存的阅读分层展示；分层说明是阅读建议，不代表已经执行验证。'}</p>{sections.map((section:any)=><details key={section.id} open><summary>{section.title}</summary><p>{readingText(section.summary)}</p>{section.dependsOn?.length>0&&<small>依赖：{section.dependsOn.join('、')}</small>}{(section.nodes||[]).map((id:string)=>{const node=reading.nodes.find((n:any)=>n.id===id);return node?<button key={id} onClick={()=>onSource(node.source)}>{node.source.symbol||node.source.file}<small>{node.source.repo} · {node.source.file}:{node.source.line}</small></button>:null;})}</details>)}{!sections.length&&<p>这份阅读记录没有{view==='repos'?'仓库关系':'分层说明'}，可重新生成解读；已有源码关系仍可查看。</p>}</div>:<RelationshipGraph key={reading.id||reading.version} scope={reading.id||reading.version} nodes={reading.nodes||[]} edges={reading.edges||[]} onSource={onSource}/>}{!!reading.gaps?.length&&<details><summary>未展开范围 · {reading.gaps.length}</summary>{reading.gaps.map((g:string,i:number)=><p key={i}>{readingText(g)}</p>)}</details>}</section>;
}
