import {afterEach,it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {SessionManager,ModelRuntime} from '../lib/pi-sdk/index.ts';
import {fauxProvider,fauxAssistantMessage} from '@earendil-works/pi-ai';
import {conversationChanges} from '../core/conversation-change-capture.ts';
import {ChangeWorkbench} from '../plugins/enigma/change-workbench.ts';
import {createUsageLedger} from '../lib/llm/usage-ledger.ts';
const roots:string[]=[];afterEach(async()=>{for(const r of roots.splice(0))await fs.rm(r,{recursive:true,force:true});});
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-workbench-'));roots.push(root);const work=path.join(root,'files');await fs.mkdir(work);const home=path.join(root,'profile');await fs.mkdir(home);const manager=SessionManager.create(work,path.join(home,'agents','test','sessions'));manager.appendMessage({role:'user',content:[{type:'text',text:'Keep the API stable'}],timestamp:Date.now()});const session=manager.getSessionFile()!;
 const faux=fauxProvider({models:[{id:'reviewer',contextWindow:100000,maxTokens:6000}]});const runtime=await ModelRuntime.create({authPath:path.join(home,'auth.json'),modelsPath:path.join(home,'models.json'),refreshOnCreate:false});runtime.registerNativeProvider(faux.provider);
 const engine:any={hanakoHome:home,modelsJsonPath:path.join(home,'models.json'),getSessionIdForPath:()=>manager.getSessionId(),getSessionManifest:()=>({workspaceScope:{primaryCwd:work}}),getSessionWorkspaceFolders:()=>[],getSessionAuthorizedFolders:()=>[],getSessionByPath:()=>({sessionManager:manager,model:faux.getModel()}),modelRegistry:{ready:async()=>runtime,streamSimple:runtime.streamSimple.bind(runtime)},currentModel:faux.getModel(),getSessionModelSelection:async()=>faux.getModel(),isSessionStreaming:()=>true};
 const capture=conversationChanges(engine),api=new ChangeWorkbench(engine,{binding:async()=>null});return {root,work,home,manager,session,engine,capture,api,faux};
}
async function untilDone(api:ChangeWorkbench,sp:string,id:string){for(let n=0;n<200;n++){const job=await api.job(sp,id);if(job.status!=='running')return job;await new Promise(r=>setTimeout(r,30));}throw Error('Review job timed out');}
it('opens ordinary-directory changes, reads frozen content after edits, and detects stale originals',async()=>{
 const f=await fixture();await fs.writeFile(path.join(f.work,'main.ts'),'export const answer = 1;');const turn=await f.capture.begin(f.session,'Change answer',f.manager.getLeafId());await fs.writeFile(path.join(f.work,'main.ts'),'export const answer = 2;');await f.capture.end(f.session,turn);
 const source=await f.api.capture(f.session,{source:'conversation'});expect(source.changes[0].after.content).toContain('2');await fs.writeFile(path.join(f.work,'main.ts'),'export const answer = 3;');const saved=await f.api.source(f.session,source.id);expect(saved.current).toBe(false);expect(saved.changes[0].after.content).toContain('2');
 await expect(f.api.source('another',source.id)).rejects.toThrow();
});
it('runs independent structured review and keeps ignore/reopen reasons tied to its snapshot',async()=>{
 const f=await fixture();await fs.writeFile(path.join(f.work,'main.ts'),'export const answer = 1;');const turn=await f.capture.begin(f.session,'Change answer',null);await fs.writeFile(path.join(f.work,'main.ts'),'export const answer = 2;');await f.capture.end(f.session,turn);
 const source=await f.api.capture(f.session,{source:'conversation'});const repo=source.roots[0].id;
 f.faux.setResponses([fauxAssistantMessage(JSON.stringify({summary:'One source finding',findings:[{severity:'P1',title:'Return shape changed',fact:'Value changed',impact:'Consumers rely on it',suggestion:'Restore documented value',anchors:[{repo,file:'main.ts',line:1,endLine:1}]}]}))]);
 const job=await f.api.analyze(f.session,source.id,'review');const result=await untilDone(f.api,f.session,job.id);expect(result.status,result.error).toBe('completed');expect(result.result.findings).toHaveLength(1);const finding=result.result.findings[0];
 await expect(f.api.action(f.session,job.id,'ignore',finding.id,'')).rejects.toThrow('原因');
 const ignored:any=await f.api.action(f.session,job.id,'ignore',finding.id,'Accepted contract update');expect(ignored.result.findings[0].state).toBe('ignored');
 await expect(f.api.action(f.session,job.id,'repair',finding.id)).rejects.toThrow('仅待处理');
 const reopened:any=await f.api.action(f.session,job.id,'reopen',finding.id);expect(reopened.result.findings[0].state).toBe('open');
 expect(await fs.readFile(path.join(f.work,'main.ts'),'utf8')).toContain('2');
});
it('supports document source anchors for model reading',async()=>{
 const f=await fixture();const turn=await f.capture.begin(f.session,'Write note',null);await fs.writeFile(path.join(f.work,'note.md'),'# Result\nA documented decision.');await f.capture.end(f.session,turn);const source=await f.api.capture(f.session,{source:'conversation'});
 f.faux.setResponses([context=>{const text=JSON.stringify(context);const nodeId=/file-[a-f0-9]{20}/.exec(text)?.[0];expect(nodeId).toBeTruthy();return fauxAssistantMessage(JSON.stringify({chapters:[{id:'note',title:'记录决策',summary:'文档保存了一项决定。',nodes:[nodeId]}],insights:[]}));}]);
 const job=await f.api.analyze(f.session,source.id,'reading');const result=await untilDone(f.api,f.session,job.id);expect(result.status,result.error).toBe('completed');expect(result.result.nodes[0].source.file).toBe('note.md');
});

function readingMaterial(context:any):any{
 const find=(value:any):string|undefined=>typeof value==='string'&&(value.startsWith('用中文解释以下固定版本变更的第')||value.startsWith('整理已校验的分批解读'))?value:value&&typeof value==='object'?Object.values(value).map(find).find(Boolean):undefined;
 const text=find(context);expect(text).toBeTruthy();return JSON.parse(text!.slice(text!.indexOf('\n')+1));
}
async function largeReadingFixture(){
 const f=await fixture(),turn=await f.capture.begin(f.session,'Explain all documents',null);
 for(let i=0;i<14;i++)await fs.writeFile(path.join(f.work,`note-${i}.md`),'"quoted" 中文 '.repeat(600));
 await f.capture.end(f.session,turn);return {...f,source:await f.api.capture(f.session,{source:'conversation'})};
}
it('sends complete JSON batches covering all published nodes and changes and persists their scope',async()=>{
 const f=await largeReadingFixture(),sent:any[]=[];
 f.engine.usageLedger=createUsageLedger();
 f.faux.setResponses(Array.from({length:12},()=>context=>{const batch=readingMaterial(context);if(batch.sources)return fauxAssistantMessage(JSON.stringify({chapters:[{title:'整体说明',summary:'按行为合并各批来源。',groups:batch.chapters.map((row:any)=>row.id)}],insights:[]}));sent.push(batch);const message=fauxAssistantMessage(JSON.stringify({chapters:batch.nodes.length?[{id:'note',title:'本批文档',summary:'所提供文档包含相同测试材料。',nodes:[batch.nodes[0].id]}]:[],insights:[]}));return message;}));
 const started=await f.api.analyze(f.session,f.source.id,'reading'),job=await untilDone(f.api,f.session,started.id);
 expect(job.status,job.error).toBe('completed');expect(sent.length).toBeGreaterThan(1);
 expect(new Set(sent.flatMap(batch=>batch.nodes.map((n:any)=>n.id))).size).toBe(14);
 expect(new Set(sent.flatMap(batch=>batch.changes.map((c:any)=>c.file))).size).toBe(14);
 expect(job.result.modelCoverage).toMatchObject({status:'complete',requests:sent.length,completedRequests:sent.length,nodes:14,totalNodes:14,changes:14,totalChanges:14});
 const usage=f.engine.usageLedger.list().entries;expect(usage).toHaveLength(sent.length+1);expect(usage.filter((entry:any)=>entry.metadata.phase==='source').map((entry:any)=>entry.metadata.batch)).toEqual(sent.map((_,i)=>i+1));expect(usage.filter((entry:any)=>entry.metadata.phase==='synthesis')).toHaveLength(1);expect(job.result.modelSynthesis.status).toBe('complete');for(const entry of usage){expect(entry.usage.totalTokens).toBeGreaterThan(0);expect(entry.usage.output.reasoningTokens).toBeNull();}
 const restored=await new ChangeWorkbench(f.engine,{binding:async()=>null}).job(f.session,job.id);expect(restored.result.modelCoverage).toEqual(job.result.modelCoverage);
});
it('keeps source analysis and earlier valid batches when a later model response is malformed',async()=>{
 const f=await largeReadingFixture();
 f.faux.setResponses([context=>{const batch=readingMaterial(context);return fauxAssistantMessage(JSON.stringify({chapters:[{id:'first',title:'已取得的说明',summary:'第一批材料的说明。',nodes:[batch.nodes[0].id]}],insights:[]}));},fauxAssistantMessage('{broken')]);
 const started=await f.api.analyze(f.session,f.source.id,'reading'),job=await untilDone(f.api,f.session,started.id);
 expect(job.status).toBe('failed');expect(job.error).toContain('未返回有效JSON');expect(job.result.nodes).toHaveLength(14);
 expect(job.result.modelCoverage).toMatchObject({status:'partial',requests:2,completedRequests:1});
 expect(job.result.chapters[0].title).toBe('已取得的说明');
});
it('requires explicit independent recheck evidence before resolving an earlier finding',async()=>{
 const f=await fixture();await fs.writeFile(path.join(f.work,'main.ts'),'export const answer = 1;');let turn=await f.capture.begin(f.session,'Change answer',null);await fs.writeFile(path.join(f.work,'main.ts'),'export const answer = 2;');await f.capture.end(f.session,turn);
 const source=await f.api.capture(f.session,{source:'conversation'}),repo=source.roots[0].id;
 f.faux.setResponses([fauxAssistantMessage(JSON.stringify({summary:'Review',findings:[{severity:'P1',title:'Value mismatch',fact:'Value is 2',impact:'Contract mismatch',suggestion:'Use 3',anchors:[{repo,file:'main.ts',line:1}]}]}))]);
 let job=await f.api.analyze(f.session,source.id,'review');const old=await untilDone(f.api,f.session,job.id),finding=old.result.findings[0];
 turn=await f.capture.begin(f.session,'Repair',null);await fs.writeFile(path.join(f.work,'main.ts'),'export const answer = 3;');await f.capture.end(f.session,turn);
 f.faux.setResponses([fauxAssistantMessage(JSON.stringify({summary:'Rechecked',findings:[],verdicts:[{id:finding.id,status:'resolved',evidence:'Frozen main.ts line 1 returns 3.',anchors:[{repo,file:'main.ts',line:1,endLine:1}]}]}))]);
 job=await f.api.action(f.session,old.id,'recheck') as any;const result=await untilDone(f.api,f.session,job.id);
 expect(result.status,result.error).toBe('completed');expect(result.result.previousFindings[0].state).toBe('resolved');expect((await f.api.job(f.session,old.id)).result.findings[0].verification).toContain('line 1');
});
it('keeps stale-source findings open and refuses automatic repair',async()=>{
 const f=await fixture();const turn=await f.capture.begin(f.session,'Create',null);await fs.writeFile(path.join(f.work,'main.ts'),'export const a=1;');await f.capture.end(f.session,turn);const source=await f.api.capture(f.session,{source:'conversation'}),repo=source.roots[0].id;
 f.faux.setResponses([fauxAssistantMessage(JSON.stringify({summary:'Review',findings:[{severity:'P2',title:'Needs check',fact:'a is 1',impact:'Different result',suggestion:'Check it',anchors:[{repo,file:'main.ts',line:1}]}]}))]);const started=await f.api.analyze(f.session,source.id,'review');const job=await untilDone(f.api,f.session,started.id);
 await fs.writeFile(path.join(f.work,'main.ts'),'export const a=2;');expect((await f.api.job(f.session,job.id)).sourceCurrent).toBe(false);await expect(f.api.action(f.session,job.id,'repair',job.result.findings[0].id)).rejects.toThrow('变化');
});
it('cancels an in-flight analysis and does not turn missing verdict evidence into a resolved finding',async()=>{
 const f=await fixture();const id=await f.capture.begin(f.session,'new',null);await fs.writeFile(path.join(f.work,'main.ts'),'export const a=1;');await f.capture.end(f.session,id);const source=await f.api.capture(f.session,{source:'conversation'});
 f.faux.setResponses([async()=>{await new Promise(r=>setTimeout(r,100));return fauxAssistantMessage(JSON.stringify({summary:'finished',findings:[]}));}]);
 const started=await f.api.analyze(f.session,source.id,'review');await f.api.action(f.session,started.id,'cancel');const job=await untilDone(f.api,f.session,started.id);expect(job.status).not.toBe('completed');
});

it('keeps three directory identities and invalidates a snapshot when unchanged context or new files change',async()=>{
 const f=await fixture(),other=path.join(f.root,'second'),docs=path.join(f.root,'docs');await fs.mkdir(other);await fs.mkdir(docs);
 f.engine.getSessionAuthorizedFolders=()=>[other,docs];
 await fs.writeFile(path.join(other,'context.ts'),'export const schema=1;');
 const id=await f.capture.begin(f.session,'Coordinate all directories',null);
 for(const [dir,file] of [[f.work,'main.ts'],[other,'main.ts'],[docs,'guide.md']])await fs.writeFile(path.join(dir,file),'new text');
 await f.capture.end(f.session,id);const source=await f.api.capture(f.session,{source:'conversation'});expect(source.roots).toHaveLength(3);expect(new Set(source.changes.map((c:any)=>c.repo)).size).toBe(3);
 expect((await f.api.source(f.session,source.id)).current).toBe(true);
 await fs.writeFile(path.join(other,'context.ts'),'export const schema=2;');expect((await f.api.source(f.session,source.id)).current).toBe(false);
 await fs.writeFile(path.join(other,'context.ts'),'export const schema=1;');await fs.writeFile(path.join(docs,'new.md'),'Added after review');expect((await f.api.source(f.session,source.id)).current).toBe(false);
 f.engine.getSessionAuthorizedFolders=()=>[other];await expect(f.api.source(f.session,source.id)).rejects.toThrow('权限已变化');
});
it('preserves a user ignore made while independent recheck is running',async()=>{
 const f=await fixture();const turn=await f.capture.begin(f.session,'Create',null);await fs.writeFile(path.join(f.work,'main.ts'),'export const a=1;');await f.capture.end(f.session,turn);
 const source=await f.api.capture(f.session,{source:'conversation'}),repo=source.roots[0].id;
 f.faux.setResponses([fauxAssistantMessage(JSON.stringify({summary:'Review',findings:[{severity:'P2',title:'Check value',fact:'a is 1',impact:'Contract risk',suggestion:'Check contract',anchors:[{repo,file:'main.ts',line:1}]}]}))]);
 const original=await f.api.analyze(f.session,source.id,'review'),old=await untilDone(f.api,f.session,original.id),finding=old.result.findings[0];
 let release!:()=>void,started!:()=>void;const waiting=new Promise<void>(r=>{release=r;}),ready=new Promise<void>(r=>{started=r;});
 f.faux.setResponses([async()=>{started();await waiting;return fauxAssistantMessage(JSON.stringify({summary:'Rechecked',findings:[],verdicts:[{id:finding.id,status:'resolved',evidence:'Read main.ts at line 1.',anchors:[{repo,file:'main.ts',line:1}]}]}));}]);
 const job=await f.api.action(f.session,old.id,'recheck') as any;await ready;await f.api.action(f.session,old.id,'ignore',finding.id,'Intentional decision');release();
 expect((await untilDone(f.api,f.session,job.id)).status).toBe('completed');const result=await f.api.job(f.session,old.id);expect(result.result.findings[0]).toMatchObject({state:'ignored',reason:'Intentional decision'});
});

it('polls and cancels running analysis without repeated source snapshots',async()=>{
 const f=await fixture();const turn=await f.capture.begin(f.session,'Create',null);await fs.writeFile(path.join(f.work,'main.ts'),'export const a=1;');await f.capture.end(f.session,turn);const source=await f.api.capture(f.session,{source:'conversation'});
 let release!:()=>void,started!:()=>void;const waiting=new Promise<void>(r=>{release=r;}),ready=new Promise<void>(r=>{started=r;});
 f.faux.setResponses([async()=>{started();await waiting;return fauxAssistantMessage(JSON.stringify({summary:'done',findings:[]}));}]);
 const job=await f.api.analyze(f.session,source.id,'review');await ready;const spy=vi.spyOn(f.api,'source');
 try{
  const status=await f.api.job(f.session,job.id);expect(status.status).toBe('running');expect(status).not.toHaveProperty('sourceCurrent');
  await expect(f.api.job('another',job.id)).rejects.toThrow();
  await f.api.action(f.session,job.id,'cancel');expect(spy).not.toHaveBeenCalled();
 }finally{spy.mockRestore();release();}
 expect((await untilDone(f.api,f.session,job.id)).status).toBe('cancelled');
});

it('keeps completed source batches when only the synthesis reply fails',async()=>{
 const f=await largeReadingFixture();
 f.faux.setResponses(Array.from({length:12},()=>context=>{const batch=readingMaterial(context);return fauxAssistantMessage(batch.sources?'invalid synthesis':JSON.stringify({chapters:[{title:'Useful source chapter',summary:'A checked source reference',nodes:[batch.nodes[0].id]}],insights:[]}));}));
 const started=await f.api.analyze(f.session,f.source.id,'reading'),job=await untilDone(f.api,f.session,started.id);
 expect(job.status).toBe('failed');expect(job.result.modelCoverage.status).toBe('complete');expect(job.result.modelSynthesis.status).toBe('failed');expect(job.result.chapters.length).toBeGreaterThan(1);expect(job.result.modelSynthesis.chapters).toEqual(job.result.chapters);
});
it('summarizes sealed conversation changes without returning source bodies or claiming live totals',async()=>{
 const f=await fixture();await fs.writeFile(path.join(f.work,'a.ts'),'old\n');const first=await f.capture.begin(f.session,'Update',null);await fs.writeFile(path.join(f.work,'a.ts'),'new\nnext\n');await f.capture.end(f.session,first);
 const summary=await f.api.summary(f.session);expect(summary).toMatchObject({added:2,removed:1,from:first,to:first,pending:false});expect(summary.files[0]).toMatchObject({file:'a.ts',added:2,removed:1});expect(summary.files[0]).not.toHaveProperty('before');
 const active=await f.capture.begin(f.session,'Next turn',null);const interim=await f.api.summary(f.session);expect(interim).toMatchObject({pending:true,to:first,added:2,removed:1});f.capture.release(f.session,active);
});
