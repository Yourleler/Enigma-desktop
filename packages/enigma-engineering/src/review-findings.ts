import {hash} from './storage.js';
export interface ReviewFinding {
 id:string;severity:'P0'|'P1'|'P2'|'P3';title:string;fact:string;impact:string;suggestion:string;
 anchors:{repo:string;file:string;line:number;endLine:number;side:'baseline'|'target'}[];
 state:'open'|'pending-recheck'|'resolved'|'ignored';reason?:string;updatedAt?:string;verification?:string;
}
/** The model supplies claims; source identity and ranges are checked here. */
export function parseReviewFindings(text:string,version:string,files:{repo:string;file:string}[]){
 let value:any;try{value=JSON.parse(text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{return {summary:text,findings:[] as ReviewFinding[],structured:false};}
 if(typeof value.summary!=='string'||!Array.isArray(value.findings)||value.findings.length>80)return {summary:text,findings:[] as ReviewFinding[],structured:false};
 const allowed=new Set(files.map(f=>`${f.repo}:${f.file}`));const findings:ReviewFinding[]=[];
 for(const item of value.findings){
  if(!item||!['P0','P1','P2','P3'].includes(item.severity)||typeof item.title!=='string'||!item.title.trim()||typeof item.fact!=='string'||typeof item.impact!=='string'||typeof item.suggestion!=='string'||!Array.isArray(item.anchors))continue;
  const anchors=item.anchors.filter((a:any)=>a&&allowed.has(`${a.repo}:${a.file}`)&&Number.isSafeInteger(a.line)&&a.line>0&&Number.isSafeInteger(a.endLine??a.line)&&(a.endLine??a.line)>=a.line&&(a.endLine??a.line)-a.line<=300).slice(0,8).map((a:any)=>({repo:a.repo,file:a.file,line:a.line,endLine:a.endLine??a.line,side:a.side==='baseline'?'baseline':'target'}));
  if(!anchors.length)continue;
  findings.push({id:hash(JSON.stringify([version,item.title,anchors])).slice(0,24),severity:item.severity,title:item.title.slice(0,200),fact:item.fact.slice(0,4000),impact:item.impact.slice(0,4000),suggestion:item.suggestion.slice(0,4000),anchors,state:'open'});
 }
 const verdicts=Array.isArray(value.verdicts)?value.verdicts.filter((v:any)=>typeof v?.id==='string'&&['resolved','still-present','unverified'].includes(v.status)&&typeof v.evidence==='string').slice(0,80).map((v:any)=>({id:v.id.slice(0,100),status:v.status,evidence:v.evidence.slice(0,4000),anchors:Array.isArray(v.anchors)?v.anchors.filter((a:any)=>a&&typeof a.repo==='string'&&typeof a.file==='string'&&Number.isSafeInteger(a.line)&&a.line>0).slice(0,8).map((a:any)=>({repo:a.repo,file:a.file,line:a.line,endLine:Number.isSafeInteger(a.endLine)&&a.endLine>=a.line&&a.endLine-a.line<=300?a.endLine:a.line,side:'target' as const})):[]})):[];
 return {summary:value.summary.slice(0,30000),findings,structured:true,verdicts};
}
