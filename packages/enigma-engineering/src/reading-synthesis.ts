import type {TaskReading} from './task-reading.js';

export type ReadingChapter=NonNullable<TaskReading['chapters']>[number];
export type ReadingInsight=TaskReading['insights'][number];
export interface ReadingSynthesis {
  status:'pending'|'running'|'complete'|'failed';
  sourceBatches:number;
  requests:number;
  characters:number;
  nodes:number;
  edges:number;
  chapters:ReadingChapter[];
  insights:ReadingInsight[];
  error?:string;
}

export function synthesisMaterial(report:TaskReading,chapters:ReadingChapter[],insights:ReadingInsight[]){
  return {
    goal:report.goal,
    chapters:chapters.map(chapter=>({id:chapter.id,title:chapter.title,summary:chapter.summary,nodes:chapter.nodes})),
    insights:insights.map((insight,index)=>({id:`insight-${index+1}`,title:insight.title,text:insight.text,kind:insight.kind,anchors:insight.anchors})),
    sources:report.nodes.map(node=>({id:node.id,repo:node.source.repo,file:node.source.file,line:node.source.line,symbol:node.source.symbol})),
    relationships:report.edges,
  };
}

/** Group references expand deterministically; a summary cannot drop a source group. */
export function validateReadingSynthesis(input:any,material:ReturnType<typeof synthesisMaterial>){
  if(!input||!Array.isArray(input.chapters)||!Array.isArray(input.insights)||input.chapters.length>12||input.insights.length>12)throw Error('整体解读没有返回有效章节与说明');
  const nodes=new Set(material.sources.map(node=>node.id));
  const chapterGroups=new Map(material.chapters.map(group=>[group.id,group]));
  const insightGroups=new Map(material.insights.map(group=>[group.id,group]));
  const usedChapters=new Set<string>(),usedInsights=new Set<string>();
  const text=(row:any,key:string)=>{
    if(typeof row?.title!=='string'||!row.title.trim()||row.title.length>200||typeof row[key]!=='string'||!row[key].trim()||row[key].length>6000)throw Error('整体解读缺少有效标题或正文');
  };
  const groups=(value:any,known:Map<string,unknown>,used:Set<string>):string[]=>{
    if(!Array.isArray(value)||!value.length||value.some(id=>typeof id!=='string'||!known.has(id))||new Set(value).size!==value.length)throw Error('整体解读引用了未提供的来源组');
    for(const id of value){if(used.has(id))throw Error('整体解读重复使用了来源组，请合并重复说明');used.add(id);}
    return value;
  };
  const chapters:ReadingChapter[]=input.chapters.flatMap((row:any,index:number)=>{
    text(row,'summary');
    const ids=groups(row.groups,chapterGroups,usedChapters);
    const expanded=[...new Set(ids.flatMap(id=>chapterGroups.get(id)!.nodes))];
    if(expanded.some(id=>!nodes.has(id)))throw Error('整体解读来源已失效');
    const parts:ReadingChapter[]=[];
    for(let offset=0;offset<expanded.length;offset+=400)parts.push({id:`overview-${index+1}-${parts.length+1}`,title:row.title+(expanded.length>400?` · ${parts.length+1}`:''),summary:row.summary,nodes:expanded.slice(offset,offset+400),authority:'model-inference'});
    return parts;
  });
  const insights:ReadingInsight[]=input.insights.map((row:any)=>{
    text(row,'text');
    const ids=groups(row.groups,insightGroups,usedInsights);
    const allowed=new Set(ids.flatMap(id=>insightGroups.get(id)!.anchors));
    if(ids.some(id=>insightGroups.get(id)!.kind==='risk')&&row.kind!=='risk')throw Error('整体解读不能把已有风险降为普通说明');
    if(!['explanation','risk'].includes(row.kind)||!Array.isArray(row.anchors)||!row.anchors.length||row.anchors.length>20||row.anchors.some((id:any)=>!nodes.has(id)||!allowed.has(id)))throw Error('整体说明必须引用所选来源组的实际节点');
    return {title:row.title,text:row.text,kind:row.kind,anchors:[...new Set(row.anchors)] as string[],authority:'model-inference'};
  });
  if(chapters.length>30||usedChapters.size!==chapterGroups.size||usedInsights.size!==insightGroups.size)throw Error('整体解读遗漏了部分来源组；各批原始解读已保留');
  return {chapters,insights};
}
