import {useMemo,useState} from 'react';

const roleNames:Record<string,string>={entry:'入口',contract:'接口契约',implementation:'实现',consumer:'调用方',test:'测试',configuration:'配置',documentation:'文档'};
export function ChangeMap({reading,onSource}:{reading:any;onSource:(anchor:any)=>void}){
 const [zoom,setZoom]=useState(1),[role,setRole]=useState('all');
 const nodes=useMemo(()=>(reading?.nodes||[]).filter((n:any)=>role==='all'||n.role===role).slice(0,120),[reading,role]);
 const roles=[...new Set((reading?.nodes||[]).map((n:any)=>n.role))] as string[];
 const position=new Map(nodes.map((n:any,i:number)=>[n.id,{x:(i%3)*230+20,y:Math.floor(i/3)*96+20}]));
 const height=Math.max(220,Math.ceil(nodes.length/3)*96+30);
 if(!reading)return <p className="enigma-review-empty">先生成智能阅读，再查看有源码依据的关系图。</p>;
 return <section className="enigma-change-map"><header><select aria-label="关系图角色" value={role} onChange={e=>setRole(e.target.value)}><option value="all">全部源码角色</option>{roles.map(r=><option key={r} value={r}>{roleNames[r]||r}</option>)}</select><button onClick={()=>setZoom(z=>Math.max(.4,z-.15))} aria-label="缩小关系图">−</button><button onClick={()=>setZoom(1)}>{Math.round(zoom*100)}%</button><button onClick={()=>setZoom(z=>Math.min(1.8,z+.15))} aria-label="放大关系图">＋</button><span>{nodes.length} 个节点</span></header><p>连线来自源码分析；静态关系不代表运行结果。点击节点查看同版本源码。</p><div className="enigma-change-map-scroll"><div style={{width:720*zoom,height:height*zoom}}><div style={{width:720,height,transform:`scale(${zoom})`,transformOrigin:'top left',position:'relative'}}>
  <svg width="720" height={height} aria-hidden="true" style={{position:'absolute',inset:0}}>{(reading.edges||[]).map((edge:any,i:number)=>{const a:any=position.get(edge.from),b:any=position.get(edge.to);return a&&b?<path key={i} d={`M${a.x+100} ${a.y+56} C${a.x+100} ${a.y+85},${b.x+100} ${b.y-25},${b.x+100} ${b.y}`} fill="none" stroke="var(--accent)" strokeOpacity={edge.confidence==='confirmed'?.55:.3} strokeDasharray={edge.confidence==='confirmed'?undefined:'4 4'}/>:null;})}</svg>
  {nodes.map((node:any)=>{const p:any=position.get(node.id);return <button key={node.id} className="enigma-map-node" style={{left:p.x,top:p.y}} onClick={()=>onSource(node.source)}><strong>{node.source?.symbol||node.source?.file}</strong><small>{roleNames[node.role]||node.role} · {node.source?.file}:{node.source?.line}</small></button>;})}
 </div></div></div>{!!reading.gaps?.length&&<details><summary>未展开范围 · {reading.gaps.length}</summary>{reading.gaps.map((g:string,i:number)=><p key={i}>{g}</p>)}</details>}</section>;
}
