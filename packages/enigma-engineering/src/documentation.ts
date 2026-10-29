import { readFile,readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Workspace } from './workspace.js';
import { ensureDir,hash,id,readJson,redact,safeId,writeJson } from './storage.js';
import { runProcess } from './process.js';
import type { Observation } from './types.js';

export interface DocumentClaimInput {
  id:string;section:string;text:string;authority:'source'|'user-decision'|'inference'|'unverified';
  sources?:{repo:string;file:string;start:number;end:number}[];
  fact?:{key:string;version:string;value:string};
}
export interface DocumentExample {id:string;section:string;repo:string;argv:string[];expected:string;timeoutMs?:number}
export interface DocumentationInput {repo:string;file:string;title:string;claims:DocumentClaimInput[];examples?:DocumentExample[]}
export interface DocumentationRecord extends DocumentationInput {
  schema:1;id:string;createdAt:string;documentHash:string;
  anchors:{claim:string;repo:string;file:string;start:number;end:number;hash:string}[];
}
export interface DocumentExampleReceipt {schema:1;id:string;document:string;example:string;source:Observation;documentHash:string;status:string;output:string;expectedMatched:boolean;at:string}

function sectionRange(content:string,heading:string){
  const lines=content.split('\n'),matches=lines.flatMap((line,index)=>line===heading?[index]:[]);
  if(matches.length!==1||!/^#{1,6} /.test(heading))throw new Error('Document section must name one exact Markdown heading');
  const start=matches[0]!,level=heading.match(/^#+/)![0].length;
  const next=lines.findIndex((line,index)=>index>start&&/^#{1,6} /.test(line)&&line.match(/^#+/)![0].length<=level);
  return {lines,start,end:next<0?lines.length:next};
}

/** Source claims and executable examples are versioned independently from a
 * writer's prose. Old/history sections remain explicit; only affected sections
 * are eligible for an optimistic scoped update.
 */
export class DocumentationStore {
  constructor(readonly workspace:Workspace){}
  private async directory(){return ensureDir(join(this.workspace.data,'documentation'));}
  async register(input:DocumentationInput){
    if(!input.title?.trim()||input.title.length>200||!input.file?.endsWith('.md')||!Array.isArray(input.claims)||input.claims.length>80||(input.examples?.length||0)>20)throw new Error('Register a bounded Markdown document and claims/examples');
    const content=await readFile(await this.workspace.path(input.repo,input.file),'utf8');if(content.length>200000)throw new Error('Document exceeds inspection budget');
    const record:DocumentationRecord={schema:1,id:id('document'),createdAt:new Date().toISOString(),repo:input.repo,file:input.file,title:input.title,claims:[],examples:[],documentHash:hash(content),anchors:[]};
    const identifiers=new Set<string>();
    for(const claim of input.claims){
      safeId(claim.id);if(identifiers.has(claim.id)||!claim.text?.trim()||claim.text.length>4000||!['source','user-decision','inference','unverified'].includes(claim.authority))throw new Error('Invalid document claim');identifiers.add(claim.id);
      const section=sectionRange(content,claim.section),body=section.lines.slice(section.start,section.end).join('\n');if(!body.includes(claim.text))throw new Error('Claim text must appear within its named section');
      if(claim.authority==='source'&&!claim.sources?.length)throw new Error('Source-supported claims require actual source anchors');
      if((claim.sources?.length||0)>12)throw new Error('Claim source budget exceeded');
      for(const source of claim.sources||[]){
        if(!Number.isInteger(source.start)||!Number.isInteger(source.end)||source.start<1||source.end<source.start||source.end-source.start>300)throw new Error('Provide bounded source lines');
        const bytes=await readFile(await this.workspace.path(source.repo,source.file));if(bytes.length>8000000)throw new Error('Document source exceeds budget');const lines=new TextDecoder('utf-8',{fatal:true}).decode(bytes).split('\n');if(source.end>lines.length)throw new Error('Claim source lines are outside the actual file');
        record.anchors.push({claim:claim.id,...source,hash:hash(bytes)});
      }
      if(claim.fact&&(!claim.fact.key?.trim()||!claim.fact.version?.trim()||typeof claim.fact.value!=='string'||claim.fact.value.length>1000))throw new Error('Document fact needs an explicit key, version and bounded value');
      record.claims.push({id:claim.id,section:claim.section,text:claim.text,authority:claim.authority,sources:claim.sources,fact:claim.fact});
    }
    for(const example of input.examples||[]){safeId(example.id);if(identifiers.has(example.id)||!Array.isArray(example.argv)||!example.argv.length||example.argv.length>100||example.argv.some(arg=>typeof arg!=='string'||arg.includes('\0'))||typeof example.expected!=='string'||example.expected.length>12000||example.timeoutMs!==undefined&&(!Number.isInteger(example.timeoutMs)||example.timeoutMs<1||example.timeoutMs>120000))throw new Error('Invalid document example');identifiers.add(example.id);this.workspace.repo(example.repo);sectionRange(content,example.section);record.examples!.push({id:example.id,section:example.section,repo:example.repo,argv:[...example.argv],expected:example.expected,timeoutMs:example.timeoutMs});}
    await writeJson(join(await this.directory(),`${record.id}.json`),JSON.parse(redact(JSON.stringify(record),this.workspace.secrets)));return record;
  }
  async read(document:string){
    const record=await readJson<DocumentationRecord>(join(await this.directory(),`${safeId(document)}.json`));if(record.schema!==1||record.id!==document)throw new Error('Invalid documentation identity');
    let current=false;try{current=hash(await readFile(await this.workspace.path(record.repo,record.file)))===record.documentHash;}catch{}
    const claims=[];
    for(const claim of record.claims){const problems:string[]=[];if(!current)problems.push('Document content changed');for(const anchor of record.anchors.filter(anchor=>anchor.claim===claim.id))try{if(hash(await readFile(await this.workspace.path(anchor.repo,anchor.file)))!==anchor.hash)problems.push(`Source changed: ${anchor.repo}:${anchor.file}`);}catch{problems.push(`Source unavailable: ${anchor.repo}:${anchor.file}`);}
      claims.push({...claim,current:!problems.length,problems,supported:claim.authority==='source'&&!problems.length});}
    const examples=[];for(const example of record.examples||[]){let receipt:DocumentExampleReceipt|null=null;try{receipt=await readJson(join(await this.directory(),`${record.id}-${safeId(example.id)}-latest.json`));}catch{}const valid=receipt?.status==='passed'&&receipt.documentHash===record.documentHash&&current&&JSON.stringify(receipt.source)===JSON.stringify(await this.workspace.observe());examples.push({...example,receipt,valid});}
    return {record,current,claims,examples,affectedSections:[...new Set(claims.filter(claim=>!claim.current).map(claim=>claim.section))],note:'Source anchors support stated behavior, not invented design motives. Examples require actual execution; declarations and model prose alone do not certify correctness.'};
  }
  async runExample(document:string,exampleId:string,signal?:AbortSignal){
    const publication=await this.read(document);if(!publication.current)throw new Error('Document changed; re-register current examples');
    const example=publication.record.examples?.find(example=>example.id===exampleId);if(!example)throw new Error('Select a registered document example');
    const source=await this.workspace.observe(),execution=await this.workspace.exclusive(()=>this.workspace.mutate(example.repo,'command',()=>runProcess(example.argv,this.workspace.repo(example.repo).root,{timeoutMs:example.timeoutMs??30000,signal})));
    const expectedMatched=execution.output.includes(example.expected),unchanged=JSON.stringify(source)===JSON.stringify(await this.workspace.observe());
    const receipt:DocumentExampleReceipt={schema:1,id:id('document-example'),document,example:exampleId,documentHash:publication.record.documentHash,source,status:execution.status==='passed'&&expectedMatched&&unchanged?'passed':!unchanged?'stale':execution.status==='passed'?'failed':execution.status,output:redact(execution.output,this.workspace.secrets),expectedMatched,at:new Date().toISOString()};
    await writeJson(join(await this.directory(),`${document}-${safeId(exampleId)}-latest.json`),receipt);return receipt;
  }
  async updateSection(document:string,section:string,expectedHash:string,replacement:string){
    if(replacement.length>60000||!replacement.startsWith(section+'\n'))throw new Error('Replacement must retain the exact named section heading');
    return this.workspace.exclusive(async()=>{
      const {record}=await this.read(document),file=await this.workspace.path(record.repo,record.file,'write'),content=await readFile(file,'utf8');if(hash(content)!==expectedHash)throw new Error('Document changed after update preparation');
      const range=sectionRange(content,section),next=[...range.lines.slice(0,range.start),replacement.trimEnd(),...range.lines.slice(range.end)].join('\n');
      await this.workspace.mutate(record.repo,'document-section',async()=>{if(hash(await readFile(file))!==expectedHash)throw new Error('Concurrent document edit');await writeJson(join(await this.directory(),`${id('document-update')}.json`),{schema:1,document,section,expectedHash,at:new Date().toISOString()});await (await import('node:fs/promises')).writeFile(file,next);});
      return {updated:true,repo:record.repo,file:record.file,hash:hash(next),section,note:'Re-register affected claims and rerun examples; old declarations remain historical.'};
    });
  }
  async consistency(){
    const entries=await this.list(),facts=new Map<string,{document:string;claim:string;value:string}[]>();
    for(const entry of entries)for(const claim of entry.claims)if(claim.current&&claim.fact){const key=`${claim.fact.key}@${claim.fact.version}`;facts.set(key,[...facts.get(key)||[],{document:entry.record.id,claim:claim.id,value:claim.fact.value}]);}
    return {conflicts:[...facts].filter(([,values])=>new Set(values.map(value=>value.value)).size>1).map(([key,claims])=>({key,claims})),note:'Only explicit facts at the same version are compared. Historical versions are kept separate; semantic claims remain advisory.'};
  }
  async list(){const results=[];for(const file of(await readdir(await this.directory())).filter(file=>/^document-[a-f0-9-]+\.json$/.test(file)).slice(-100))results.push(await this.read(file.slice(0,-5)));return results;}
}
