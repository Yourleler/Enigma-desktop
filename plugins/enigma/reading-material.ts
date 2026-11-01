type MaterialNode={id:string;role?:string;source:Record<string,any>;responsibility?:string};
type MaterialChange={repo:string;file:string;change?:string;patch?:string;patchTruncated?:boolean;before?:{omitted?:string};after?:{omitted?:string}};
export interface ReadingMaterialBatch {nodes:MaterialNode[];edges:any[];changes:any[]}
export interface ModelReadingCoverage {
 status:'pending'|'partial'|'complete';requests:number;completedRequests:number;plannedRequests:number;
 nodes:number;totalNodes:number;changes:number;totalChanges:number;edges:number;totalEdges:number;
 characters:number;clippedNodes:number;clippedPatches:number;
}

/** Pack complete JSON documents, never a substring of a serialized document. */
export function prepareReadingMaterial(report:{nodes:MaterialNode[];edges:any[]},changes:MaterialChange[],maxCharacters=90000){
 if(!Number.isInteger(maxCharacters)||maxCharacters<2000)throw Error('模型材料预算无效');
 const batches:ReadingMaterialBatch[]=[],pendingChanges=new Map(changes.map(c=>[`${c.repo}:${c.file}`,c]));
 let current:ReadingMaterialBatch={nodes:[],edges:[],changes:[]};
 let clippedNodes=0,clippedPatches=0;
 const patchLimit=Math.min(8000,Math.floor(maxCharacters/3)),snippetLimit=Math.min(6000,Math.floor(maxCharacters/4));
 const compactChange=(c:MaterialChange)=>{const partial=!!c.patchTruncated||(c.patch?.length||0)>patchLimit;if(partial)clippedPatches++;return {repo:c.repo,file:c.file,change:c.change,patch:c.patch?.slice(0,patchLimit),patchTruncated:partial,omitted:c.after?.omitted||c.before?.omitted};};
 const append=(node:MaterialNode|undefined,change:any)=>{
  let candidate={nodes:[...current.nodes,...(node?[node]:[])],edges:[],changes:[...current.changes,...(change?[change]:[])]};
  // Reserve space for batch instructions and relationship metadata.
  if(JSON.stringify(candidate).length>maxCharacters-1000&&(current.nodes.length||current.changes.length)){batches.push(current);current={nodes:[],edges:[],changes:[]};candidate={nodes:node?[node]:[],edges:[],changes:change?[change]:[]};}
  if(JSON.stringify(candidate).length>maxCharacters-1000)throw Error('一个源码条目的标识与片段超过本模型材料预算，请缩小文件范围或更换上下文更大的模型。');
  current=candidate;
 };
 for(const node of report.nodes){
  const s=node.source||{},raw=typeof s.snippet==='string'?s.snippet:'',clipped=raw.length>snippetLimit;if(clipped||s.truncated)clippedNodes++;
  const compact:MaterialNode={id:node.id,role:node.role,source:{repo:s.repo,file:s.file,line:s.line,endLine:s.endLine,symbol:s.symbol,kind:s.kind,snippet:raw.slice(0,snippetLimit),truncated:!!s.truncated||clipped},responsibility:node.responsibility?.slice(0,500)};
  const key=`${s.repo}:${s.file}`,change=pendingChanges.get(key);if(change)pendingChanges.delete(key);
  append(compact,change?compactChange(change):undefined);
 }
 for(const change of pendingChanges.values())append(undefined,compactChange(change));
 if(current.nodes.length||current.changes.length)batches.push(current);
 const deliveredEdges=new Set<number>();
 for(const batch of batches){const ids=new Set(batch.nodes.map(n=>n.id));for(const [index,edge] of report.edges.entries())if(ids.has(edge.from)&&ids.has(edge.to)){
  const entry={from:edge.from,to:edge.to,kind:edge.kind,confidence:edge.confidence};batch.edges.push(entry);if(JSON.stringify(batch).length>maxCharacters){batch.edges.pop();continue;}deliveredEdges.add(index);
 }}
 return {batches,coverage:{status:'pending',requests:0,completedRequests:0,plannedRequests:batches.length,nodes:0,totalNodes:report.nodes.length,changes:0,totalChanges:changes.length,edges:0,totalEdges:report.edges.length,characters:0,clippedNodes,clippedPatches} as ModelReadingCoverage,deliveredEdges:deliveredEdges.size};
}

export function validateReadingAnnotation(input:any,batch:ReadingMaterialBatch,index:number){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('模型解读不是有效对象');
 if(!Array.isArray(input.chapters)||!Array.isArray(input.insights))throw Error('模型解读缺少章节或说明数组');
 const ids=new Set(batch.nodes.map(n=>n.id));
 const rows=(value:any,key:'nodes'|'anchors')=>{
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>2)throw Error('模型每批最多返回2组说明，请重新生成');
  return value.map((row:any,i:number)=>{
   if(!row||!Array.isArray(row[key])||!row[key].length||row[key].length>(key==='nodes'?400:20)||row[key].some((id:any)=>typeof id!=='string'||!ids.has(id)))throw Error('模型引用了本批未提供的源码节点，或引用数量超出范围；未将该回复记为有效解读');
   const text=key==='nodes'?row.summary:row.text;
   if(typeof row.title!=='string'||!row.title.trim()||row.title.length>200||typeof text!=='string'||!text.trim()||text.length>6000)throw Error('模型说明缺少有效标题或正文');
   if(key==='anchors'&&!['explanation','risk'].includes(row.kind))throw Error('模型说明类型无效');
   return key==='nodes'?{id:`batch-${index+1}-${i+1}`,title:row.title,summary:text,nodes:row.nodes}:{title:row.title,text,anchors:row.anchors,kind:row.kind};
  });
 };
 return {chapters:rows(input.chapters,'nodes'),insights:rows(input.insights,'anchors')};
}
