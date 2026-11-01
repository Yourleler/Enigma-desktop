export interface RelationNode {id:string;role?:string;source?:{repo?:string;file?:string;line?:number;symbol?:string;snippet?:string;[key:string]:any};[key:string]:any}
export interface RelationEdge {from:string;to:string;confidence?:string;kind?:string;reason?:string;[key:string]:any}
export const GRAPH_NODE_WIDTH=214,GRAPH_NODE_HEIGHT=70;

/** Collapse directed cycles for ranking; keep every original node and edge visible. */
export function layoutRelations(nodes:RelationNode[],edges:RelationEdge[]){
 const unique=[...new Map(nodes.filter(n=>typeof n?.id==='string').map(n=>[n.id,n])).values()];
 const ids=new Set(unique.map(n=>n.id)),next=new Map(unique.map(n=>[n.id,[] as string[]])),previous=new Map(unique.map(n=>[n.id,[] as string[]]));
 const links=edges.filter(e=>ids.has(e.from)&&ids.has(e.to));
 for(const edge of links){next.get(edge.from)!.push(edge.to);previous.get(edge.to)!.push(edge.from);}
 const visited=new Set<string>(),order:string[]=[];
 for(const node of unique){
  if(visited.has(node.id))continue;
  const stack:[string,number][]=[[node.id,0]];visited.add(node.id);
  while(stack.length){const entry=stack[stack.length-1],out=next.get(entry[0])!;if(entry[1]<out.length){const id=out[entry[1]++];if(!visited.has(id)){visited.add(id);stack.push([id,0]);}}else{order.push(entry[0]);stack.pop();}}
 }
 const component=new Map<string,number>(),groups:string[][]=[];
 for(const first of order.reverse()){
  if(component.has(first))continue;const index=groups.length,group:string[]=[],stack=[first];component.set(first,index);
  while(stack.length){const id=stack.pop()!;group.push(id);for(const parent of previous.get(id)!)if(!component.has(parent)){component.set(parent,index);stack.push(parent);}}
  groups.push(group);
 }
 const outgoing=groups.map(()=>new Set<number>()),incoming=groups.map(()=>0),rank=groups.map(()=>0);
 for(const edge of links){const a=component.get(edge.from)!,b=component.get(edge.to)!;if(a!==b&&!outgoing[a].has(b)){outgoing[a].add(b);incoming[b]++;}}
 const ready=incoming.flatMap((n,i)=>n===0?[i]:[]);
 for(let i=0;i<ready.length;i++){const a=ready[i];for(const b of outgoing[a]){rank[b]=Math.max(rank[b],rank[a]+1);if(--incoming[b]===0)ready.push(b);}}
 const rows=new Map<number,number>(),position=new Map<string,{x:number;y:number}>();
 const sorted=[...unique].sort((a,b)=>rank[component.get(a.id)!]-rank[component.get(b.id)!]||`${a.source?.repo}/${a.source?.file}/${a.source?.symbol}/${a.id}`.localeCompare(`${b.source?.repo}/${b.source?.file}/${b.source?.symbol}/${b.id}`));
 for(const node of sorted){const column=rank[component.get(node.id)!],row=rows.get(column)||0;position.set(node.id,{x:28+column*290,y:24+row*108});rows.set(column,row+1);}
 const width=Math.max(360,48+(Math.max(0,...rank))*290+GRAPH_NODE_WIDTH),height=Math.max(220,48+Math.max(0,...rows.values())*108);
 return {nodes:unique,edges:links,position,width,height,missingEdges:edges.length-links.length,cycles:groups.filter(g=>g.length>1).length};
}

export function relationPath(a:{x:number;y:number},b:{x:number;y:number},self=false){
 const x=a.x+GRAPH_NODE_WIDTH,y=a.y+GRAPH_NODE_HEIGHT/2,toX=b.x,toY=b.y+GRAPH_NODE_HEIGHT/2;
 if(self)return `M${x} ${y} C${x+58} ${y-72},${a.x-58} ${y-72},${a.x} ${y}`;
 if(toX>x){const mid=(x+toX)/2;return `M${x} ${y} C${mid} ${y},${mid} ${toY},${toX} ${toY}`;}
 const bend=x+42;return `M${x} ${y} C${bend} ${y},${bend} ${toY},${b.x+GRAPH_NODE_WIDTH} ${toY}`;
}
