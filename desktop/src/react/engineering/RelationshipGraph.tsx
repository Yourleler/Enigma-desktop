import {useEffect,useId,useLayoutEffect,useMemo,useRef,useState,type PointerEvent} from 'react';
import {Overlay} from '../ui/Overlay';
import {AppIcon} from '../ui/app-icons';
import {SearchField} from '../ui/SearchField';
import {layoutRelations,relationPath,GRAPH_NODE_HEIGHT,GRAPH_NODE_WIDTH,type RelationNode,type RelationEdge} from './graph-layout';
import './RelationshipGraph.css';

const roleNames:Record<string,string>={entry:'入口',contract:'接口契约',implementation:'实现',consumer:'调用方',test:'测试',configuration:'配置',documentation:'文档'};
const relationNames:Record<string,string>={calls:'调用',call:'调用',imports:'导入',import:'导入',depends:'依赖','depends-on':'依赖',implements:'实现',references:'引用','type-reference':'类型引用',tests:'测试覆盖','import-binding':'导入符号绑定','call-site':'调用位置','outgoing-call':'向外调用','incoming-call':'调用来源','symbol-reference':'符号引用','same-file':'同文件关系','schema-type-reference':'Schema 类型引用'};
const label=(node:RelationNode)=>node.source?.symbol||node.source?.file||node.id;
const sourceLabel=(node:RelationNode)=>`${node.source?.repo||'目录未记录'} / ${node.source?.file||'文件未记录'}${node.source?.line?`:${node.source.line}`:''}`;
type Camera={x:number;y:number;width:number;height:number;zoom:number};
interface GraphView {query:string;role:string;repo:string;selected:string;mini:boolean;zoom:number;camera:Camera}
const savedViews=new Map<string,GraphView>();

export function RelationshipGraph({nodes,edges,onSource,scope}:{nodes:RelationNode[];edges:RelationEdge[];scope?:string;onSource:(anchor:any)=>void}){
 const [saved]=useState(()=>scope?savedViews.get(scope):undefined);
 const [query,setQuery]=useState(saved?.query||''),[role,setRole]=useState(saved?.role||'all'),[repo,setRepo]=useState(saved?.repo||'all'),[selected,setSelected]=useState(saved?.selected||'');
 const previousFilters=useRef(JSON.stringify([query,role,repo]));
 const [expanded,setExpanded]=useState(false),[mini,setMini]=useState(saved?.mini??true),[zoom,setZoom]=useState(saved?.zoom??1);
 const viewport=useRef<HTMLDivElement>(null),returnFocus=useRef<HTMLButtonElement>(null),close=useRef<HTMLButtonElement>(null),cleanup=useRef(()=>{});
 const cameraRef=useRef<Camera>(saved?.camera||{x:0,y:0,width:500,height:300,zoom:1}),[camera,setCamera]=useState(cameraRef.current);
 const id=useId().replace(/:/g,'');
 const filtered=useMemo(()=>nodes.filter(n=>(role==='all'||n.role===role)&&(repo==='all'||n.source?.repo===repo)&&`${label(n)} ${sourceLabel(n)}`.toLowerCase().includes(query.trim().toLowerCase())),[nodes,query,role,repo]);
 const layout=useMemo(()=>layoutRelations(filtered,edges),[filtered,edges]);
 const allById=useMemo(()=>new Map(nodes.map(n=>[n.id,n])),[nodes]);
 const selectedNode=allById.get(selected),relations=edges.filter(e=>e.from===selected||e.to===selected);
 const connected=new Set([selected,...relations.flatMap(e=>[e.from,e.to])]);
 const update=()=>{const el=viewport.current;if(!el)return;const value={x:el.scrollLeft/zoom,y:el.scrollTop/zoom,width:el.clientWidth/zoom,height:el.clientHeight/zoom,zoom};cameraRef.current=value;setCamera(value);};
 const callbacks=useRef({update}),frame=useRef(0);callbacks.current={update};
 const schedule=()=>{if(!frame.current)frame.current=requestAnimationFrame(()=>{frame.current=0;callbacks.current.update();});};
 useLayoutEffect(()=>{const el=viewport.current;if(!el)return;const old=cameraRef.current;el.scrollLeft=old.x*zoom;el.scrollTop=old.y*zoom;update();},[expanded,zoom]);
 useEffect(()=>{const el=viewport.current;if(!el||typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(schedule);observer.observe(el);return()=>observer.disconnect();},[expanded,layout.nodes.length]);
 useEffect(()=>()=>{cleanup.current();cancelAnimationFrame(frame.current);frame.current=0;},[]);
 useEffect(()=>()=>cleanup.current(),[expanded]);
 useEffect(()=>{if(selected&&!layout.position.has(selected))setSelected('');},[layout,selected]);
 useLayoutEffect(()=>{const key=JSON.stringify([query,role,repo]);if(previousFilters.current===key)return;previousFilters.current=key;if(viewport.current){viewport.current.scrollLeft=0;viewport.current.scrollTop=0;}update();},[query,role,repo]);
 useEffect(()=>{if(!scope)return;savedViews.delete(scope);savedViews.set(scope,{query,role,repo,selected,mini,zoom,camera});while(savedViews.size>24)savedViews.delete(savedViews.keys().next().value!);},[scope,query,role,repo,selected,mini,zoom,camera]);
 const changeZoom=(value:number)=>{const next=Math.max(.01,Math.min(2.5,value)),old=cameraRef.current,el=viewport.current;if(el){cameraRef.current={...old,x:Math.max(0,old.x+old.width/2-el.clientWidth/next/2),y:Math.max(0,old.y+old.height/2-el.clientHeight/next/2)};}setZoom(next);};
 const fit=()=>{const el=viewport.current;if(!el)return;cameraRef.current={...cameraRef.current,x:0,y:0};setZoom(Math.max(.01,Math.min(1,Math.min(el.clientWidth/layout.width,el.clientHeight/layout.height))));el.scrollTo(0,0);};
 const select=(node:RelationNode,center=false)=>{setSelected(node.id);if(center){const p=layout.position.get(node.id),el=viewport.current;if(p&&el){el.scrollTo(Math.max(0,(p.x+GRAPH_NODE_WIDTH/2)*zoom-el.clientWidth/2),Math.max(0,(p.y+GRAPH_NODE_HEIGHT/2)*zoom-el.clientHeight/2));update();}}};
 const pointer=(event:PointerEvent,kind:'canvas'|'mini')=>{
  if(event.button!==0||!viewport.current)return;
  if(kind==='canvas'&&(event.target as Element).closest('button'))return;
  event.preventDefault();cleanup.current();const el=viewport.current,start={x:event.clientX,y:event.clientY,left:el.scrollLeft,top:el.scrollTop},rect=event.currentTarget.getBoundingClientRect();
  const move=(point:{clientX:number;clientY:number})=>{if(kind==='canvas'){el.scrollLeft=start.left+start.x-point.clientX;el.scrollTop=start.top+start.y-point.clientY;}else{el.scrollLeft=Math.max(0,(point.clientX-rect.left)/rect.width*layout.width*zoom-el.clientWidth/2);el.scrollTop=Math.max(0,(point.clientY-rect.top)/rect.height*layout.height*zoom-el.clientHeight/2);}update();};
  if(kind==='mini')move(event);
  const stop=()=>cleanup.current();cleanup.current=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop);window.removeEventListener('pointercancel',stop);window.removeEventListener('blur',stop);};
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',stop);window.addEventListener('pointercancel',stop);window.addEventListener('blur',stop);
 };
 const closeExpanded=()=>{setExpanded(false);requestAnimationFrame(()=>returnFocus.current?.focus());};
 const controls=<div className="enigma-graph-controls">
  <SearchField aria-label="搜索关系图节点" placeholder="搜索符号、文件或目录" value={query} onChange={e=>setQuery(e.target.value)}/>
  <select aria-label="关系图角色" value={role} onChange={e=>setRole(e.target.value)}><option value="all">全部角色</option>{[...new Set(nodes.map(n=>n.role).filter(Boolean))].map(value=><option key={value} value={value}>{roleNames[value!]||value}</option>)}</select>
  <select aria-label="关系图仓库" value={repo} onChange={e=>setRepo(e.target.value)}><option value="all">全部目录</option>{[...new Set(nodes.map(n=>n.source?.repo).filter(Boolean))].map(value=><option key={value}>{value}</option>)}</select>
  <div className="enigma-graph-zoom"><button aria-label="缩小关系图" disabled={zoom<=.01} onClick={()=>changeZoom(zoom/1.2)}>−</button><button title="恢复100%" onClick={()=>changeZoom(1)}>{Math.round(zoom*100)}%</button><button aria-label="放大关系图" disabled={zoom>=2.5} onClick={()=>changeZoom(zoom*1.2)}>＋</button><button onClick={fit}>适应视图</button></div>
  <button aria-pressed={mini} onClick={()=>setMini(!mini)}>缩略图</button>
  {expanded?<button ref={close} aria-label="退出关系图大屏" onClick={closeExpanded}><AppIcon name="close" size={16}/></button>:<button ref={returnFocus} aria-label="放大关系图工作区" title="在应用内放大，Esc返回" onClick={()=>setExpanded(true)}><AppIcon name="monitor" size={16}/></button>}
 </div>;
 const visibleNodes=layout.nodes.filter(n=>{const p=layout.position.get(n.id)!;return n.id===selected||p.x+GRAPH_NODE_WIDTH>camera.x-300&&p.x<camera.x+camera.width+300&&p.y+GRAPH_NODE_HEIGHT>camera.y-300&&p.y<camera.y+camera.height+300;});
 const content=<section className="enigma-relationship-graph" aria-label="源码关系图">
  {controls}<div className="enigma-graph-legend"><span>{filtered.length} / {nodes.length} 个节点 · {layout.edges.length} 条连线</span><span>实线：静态绑定已确认</span><span>虚线：候选关系</span>{layout.missingEdges>0&&<span>{layout.missingEdges} 条关系的端点不在当前范围</span>}</div>
  <div className="enigma-graph-body"><div className="enigma-graph-canvas-wrap">
   {!filtered.length?<div className="enigma-graph-empty" role="status">{nodes.length?'没有匹配节点。':'该记录没有源码节点。'}{nodes.length>0&&<button onClick={()=>{setQuery('');setRole('all');setRepo('all');}}>清除筛选</button>}</div>:<div ref={viewport} className="enigma-graph-viewport" role="region" aria-label="可滚动关系图" tabIndex={0} onScroll={schedule} onPointerDown={e=>pointer(e,'canvas')}>
    <div style={{width:layout.width*zoom,height:layout.height*zoom}}><div className="enigma-graph-world" style={{width:layout.width,height:layout.height,transform:`scale(${zoom})`}}>
     <svg width={layout.width} height={layout.height} aria-hidden="true"><defs><marker id={id} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7Z" fill="var(--accent)"/></marker></defs>{layout.edges.map((edge,i)=><path key={i} d={relationPath(layout.position.get(edge.from)!,layout.position.get(edge.to)!,edge.from===edge.to)} fill="none" stroke="var(--accent)" strokeWidth={selected&&(edge.from===selected||edge.to===selected)?2:1.2} opacity={selected&&edge.from!==selected&&edge.to!==selected ? .14 : edge.confidence==='confirmed' ? .65 : .4} strokeDasharray={edge.confidence==='confirmed'?undefined:'5 4'} markerEnd={`url(#${id})`}/>)}</svg>
     {visibleNodes.map(node=>{const p=layout.position.get(node.id)!;return <button key={node.id} className="enigma-graph-node" style={{left:p.x,top:p.y,width:GRAPH_NODE_WIDTH,height:GRAPH_NODE_HEIGHT}} aria-pressed={selected===node.id} data-muted={selected&&!connected.has(node.id)||undefined} title={`${label(node)}\n${sourceLabel(node)}\n${roleNames[node.role||'']||node.role||'源码'}`} onClick={()=>select(node)}><strong>{label(node)}</strong><span>{sourceLabel(node)}</span><small>{roleNames[node.role||'']||node.role||'源码'}</small></button>;})}
    </div></div>
   </div>}
   {mini&&filtered.length>0&&<svg className="enigma-graph-minimap" viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio="none" role="slider" aria-label="关系图缩略导航" aria-valuemin={0} aria-valuemax={Math.max(0,Math.round(layout.height-camera.height))} aria-valuenow={Math.round(camera.y)} aria-valuetext="当前视口位置；点击或拖动定位，方向键移动" tabIndex={0} onPointerDown={e=>pointer(e,'mini')} onKeyDown={e=>{const el=viewport.current;if(!el||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();el.scrollBy(e.key==='ArrowLeft'?-el.clientWidth/2:e.key==='ArrowRight'?el.clientWidth/2:0,e.key==='Home'?-el.scrollHeight:e.key==='End'?el.scrollHeight:e.key==='ArrowUp'?-el.clientHeight/2:e.key==='ArrowDown'?el.clientHeight/2:0);update();}}>
    {layout.nodes.map(n=>{const p=layout.position.get(n.id)!;return <rect key={n.id} x={p.x} y={p.y} width={GRAPH_NODE_WIDTH} height={GRAPH_NODE_HEIGHT} fill={selected===n.id?'var(--accent)':'var(--text-muted)'} opacity={.55}/>;})}
    <rect x={camera.x} y={camera.y} width={Math.min(camera.width,layout.width)} height={Math.min(camera.height,layout.height)} fill="var(--accent-light)" stroke="var(--accent)" strokeWidth={Math.max(2,layout.width/180)} vectorEffect="non-scaling-stroke"/>
   </svg>}
  </div>
  {selectedNode&&<aside className="enigma-graph-inspector" aria-label="节点关系详情"><header><strong>{label(selectedNode)}</strong><button aria-label="关闭节点详情" onClick={()=>setSelected('')}><AppIcon name="close" size={14}/></button></header><p>{sourceLabel(selectedNode)}</p><button disabled={!selectedNode.source?.file} onClick={()=>{if(expanded)setExpanded(false);onSource(selectedNode.source);}}>查看同版本源码</button><p>静态关系不代表运行或测试结果。</p>{relations.length?<ul>{relations.map((edge,i)=>{const other=allById.get(edge.from===selected?edge.to:edge.from);return <li key={i}><small>{edge.from===selected?'连向':'来自'} · {edge.confidence==='confirmed'?'静态绑定已确认':'候选关系'}</small>{other?<button disabled={!layout.position.has(other.id)} onClick={()=>select(other,true)}>{label(other)}</button>:<span>目标节点未记录</span>}<p>{edge.reason||relationNames[edge.kind||'']||edge.kind||'未记录进一步说明'}</p></li>;})}</ul>:<p>当前记录没有该节点的连线。</p>}</aside>}
  </div><small className="enigma-graph-help">拖动空白区域平移，滚动或缩略图定位。点击节点查看依据，再打开同版本源码。</small>
 </section>;
 return expanded?<Overlay open scope="window" onClose={closeExpanded} initialFocusRef={close} className="enigma-graph-expanded" contentProps={{role:'dialog','aria-label':'放大的源码关系图','aria-modal':true}}>{content}</Overlay>:content;
}
