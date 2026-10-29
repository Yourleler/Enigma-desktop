import { readFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Workspace } from './workspace.js';
import type { Checkpoint, Observation } from './types.js';
import { PlanStore } from './planning.js';
import { id, writeJson, readJson, redact, hash, safeId } from './storage.js';

export interface ReviewInput { baseline: string; goal: string; requirements: { text: string; reference: string }[]; evidence?: string[]; task?:string; planFile?:string }
export interface ReviewSnapshot {
  schema: 1; id: string; createdAt: string; goal: string; requirements: ReviewInput['requirements'];
  baseline: Checkpoint; target: Checkpoint; changes: { repo: string; file: string; change: string; patch?: string }[];
  observation: Observation; evidence: { id: string; kind: string; current: boolean }[];
  plan?: { id: string; revision: number };
  task?:string;
}
export function readReviewChanges(review:ReviewSnapshot,offset=0,limit=20){
  if(!Number.isInteger(offset)||offset<0||offset>review.changes.length||!Number.isInteger(limit)||limit<1||limit>40)throw new Error('审查差异分页范围无效。');
  const changes:({repo:string;file:string;change:string;patch?:string;patchTruncated?:boolean})[]=[];let remaining=60000;
  for(const change of review.changes.slice(offset,offset+limit)){
    const header=JSON.stringify({repo:change.repo,file:change.file,change:change.change}).length;
    if(changes.length&&remaining<header+500)break;
    const patch=change.patch?.slice(0,Math.max(0,Math.min(12000,remaining-header)));
    changes.push({...change,patch,patchTruncated:!!change.patch&&patch!==change.patch});remaining-=header+(patch?.length||0);
  }
  return {changes,totalFiles:review.changes.length,offset,nextOffset:offset+changes.length<review.changes.length?offset+changes.length:null,note:'差异片段有长度上限；被截断的文件可用review_read读取冻结源码。翻页使用nextOffset，不代表这些文件已被完整审查。'};
}
export async function prepareReview(workspace: Workspace, input: ReviewInput): Promise<ReviewSnapshot> {
  if(input.task)safeId(input.task);
  if (!input.goal?.trim() || input.goal.length > 4000 || input.requirements.reduce((sum, item) => sum + item.text.length, 0) > 24000 || (input.evidence?.length ?? 0) > 30) throw new Error('Invalid review input budget');
  return await workspace.exclusive(async () => {
    if ((await workspace.operations()).some(operation => ['pending', 'unknown'].includes(operation.status))) throw new Error('Review requires resolved operation effects');
    const before = await workspace.observe();
    const baseline = await workspace.loadCheckpoint(input.baseline);
    const plan = await new PlanStore(workspace,input.planFile).current();
    const target = await workspace.checkpoint('review target', { references: input.evidence,session:input.task,plan:plan?{id:plan.id,revision:plan.revision}:null });
    const changes = await workspace.compare(baseline.id, target.id);
    const evidence = await Promise.all((input.evidence ?? []).map(async id => { const observed = await workspace.evidenceStatus(id); return { id, kind: observed.entry.kind, current: observed.valid }; }));
    if (JSON.stringify(before) !== JSON.stringify(await workspace.observe())) throw new Error('Code changed during review capture');
    const snapshot: ReviewSnapshot = { schema: 1, id: id('review'), createdAt: new Date().toISOString(), goal: input.goal, requirements: input.requirements,task:input.task,
      baseline, target, changes, evidence, observation: before, plan: plan ? { id: plan.id, revision: plan.revision } : undefined };
    const path = join(workspace.data, 'reviews', snapshot.id); await mkdir(path, { recursive: true });
    await writeJson(join(path, 'input.json'), JSON.parse(redact(JSON.stringify(snapshot), workspace.secrets)));
    return snapshot;
  });
}
export async function readReviewSource(workspace: Workspace, review: ReviewSnapshot, repo: string, file: string, start = 1, end = start + 100) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end - start > 300) throw new Error('Review source read needs a bounded line range');
  const snapshot = review.target.repos.find(snapshot => snapshot.repo.id === repo); if (!snapshot) throw new Error('Repository is outside the frozen review target');
  const version = snapshot.files[file]; if (!version) throw new Error('File is outside the frozen review target');
  const bytes = await readFile(join(workspace.data, 'blobs', version.hash));
  if (hash(bytes) !== version.hash || bytes.length > 8000000) throw new Error('Frozen review blob is corrupt or too large');
  const lines = new TextDecoder('utf-8', { fatal: true }).decode(bytes).split('\n');
  if (start > lines.length) throw new Error('Review source range starts outside the file');
  const content=redact(lines.slice(start-1,end).join('\n'),workspace.secrets),visible=content.slice(0,24000);
  return { repo, file, hash: version.hash, line: start, endLine: Math.min(end,start+visible.split('\n').length-1),totalLines:lines.length, content:visible,truncated:content.length>visible.length };
}
export async function finishReview(workspace: Workspace, review: ReviewSnapshot, result: { status: 'completed' | 'cancelled' | 'failed'; text: string; model: string; session?: string; provider?:string;requests?:number;coverage?:{files:number;inlineDiffFiles:number;additionalFiles:number;providedDiffFiles:number} }) {
  const current = JSON.stringify(await workspace.observe()) === JSON.stringify(review.observation);
  const report = { schema: 1, id: review.id, baseline: review.baseline.id, target: review.target.id, task:review.task,goal:review.goal,model: result.model, session: result.session,
    status: result.status === 'completed' && !current ? 'stale' : result.status, sourceCurrent: current, text: redact(result.text, workspace.secrets),provider:result.provider,requests:result.requests,
    evidence: review.evidence,coverage:result.coverage, createdAt: new Date().toISOString(), limitations: ['Model review is advisory, not independent proof of test completion.', 'Source is frozen at the captured target; runtime behavior requires actual checks.'] };
  await writeJson(join(workspace.data, 'reviews', review.id, 'report.json'), report); return report;
}

type ReviewReport=Awaited<ReturnType<typeof finishReview>>;
async function loadReviewSnapshot(workspace:Workspace,reviewId:string,task?:string){
  const snapshot=await readJson<ReviewSnapshot>(join(workspace.data,'reviews',safeId(reviewId),'input.json'));
  if(snapshot.schema!==1||snapshot.id!==reviewId||!snapshot.target?.repos||!snapshot.baseline?.id||!Array.isArray(snapshot.changes)||!Array.isArray(snapshot.requirements)||!Array.isArray(snapshot.evidence)||!snapshot.observation)throw new Error('审查来源记录不完整，请核对原报告。');
  const sourceTasks=[...new Set(snapshot.requirements.map(note=>/^pi:([^:]+):/.exec(note.reference)?.[1]).filter((task):task is string=>!!task))];
  const owner=snapshot.task||snapshot.target.session||(sourceTasks.length===1?sourceTasks[0]:undefined);
  if(task&&owner&&owner!==task)throw new Error('审查报告属于另一个任务。');
  return {snapshot,owner};
}
export async function readStoredReview(workspace:Workspace,reviewId:string,task?:string,current?:Observation){
  const {snapshot,owner}=await loadReviewSnapshot(workspace,reviewId,task),report=await readJson<ReviewReport>(join(workspace.data,'reviews',safeId(reviewId),'report.json'));
  if(report.schema!==1||report.id!==reviewId||report.baseline!==snapshot.baseline.id||report.target!==snapshot.target.id||report.task!==snapshot.task||typeof report.text!=='string')throw new Error('审查报告与来源版本不匹配。');
  const observation=current||await workspace.observe();
  const sourceCurrent=JSON.stringify(observation.fingerprints)===JSON.stringify(snapshot.observation.fingerprints);
  const environmentCurrent=observation.environment===snapshot.observation.environment&&observation.configuration===snapshot.observation.configuration;
  const evidence=await Promise.all(snapshot.evidence.map(async item=>{
    try{const entry=await readJson<import('./types.js').Evidence>(join(workspace.data,'evidence',safeId(item.id)+'.json'));return {...item,current:entry.validAtCapture===true&&entry.environment===observation.environment&&entry.configuration===observation.configuration&&JSON.stringify(entry.fingerprints)===JSON.stringify(observation.fingerprints)};}
    catch{return {...item,current:false,issue:'原证据不可读取'};}
  }));
  return {...report,sourceCurrent,environmentCurrent,recordedStatus:report.status,status:report.status==='completed'&&(!sourceCurrent||!environmentCurrent)?'stale':report.status,
    scope:owner?'current-task':'legacy-workspace',goal:snapshot.goal,changes:snapshot.changes,requirements:snapshot.requirements,evidence,
    coverage:report.coverage||{files:snapshot.changes.length,inlineDiffFiles:Math.min(80,snapshot.changes.length),additionalFiles:Math.max(0,snapshot.changes.length-80)},
    note:'审查意见对应冻结版本，不等于测试或任务完成。未记录对话归属的旧报告保留为项目历史。'};
}
export async function readStoredReviewSource(workspace:Workspace,reviewId:string,task:string,repo:string,file:string,start?:number,end?:number,side:'baseline'|'target'='target'){
  const {snapshot:review}=await loadReviewSnapshot(workspace,reviewId,task);
  return readReviewSource(workspace,side==='baseline'?{...review,target:review.baseline}:review,repo,file,start,end);
}
export async function listReviews(workspace:Workspace,task?:string){
  const directory=join(workspace.data,'reviews');let entries:string[]=[];
  try{entries=await readdir(directory);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const candidates:ReviewReport[]=[],unavailable:{id:string;reason:string}[]=[];
  for(const entry of entries)try{
    const report=await readJson<ReviewReport>(join(directory,safeId(entry),'report.json'));
    if(task&&report.task&&report.task!==task)continue;
    if(report.id!==entry||report.schema!==1||!['completed','cancelled','failed','stale'].includes(report.status))throw Error('Invalid report');
    if(task&&!report.task)await loadReviewSnapshot(workspace,entry,task);
    candidates.push(report);
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'&&!(error as Error).message.includes('另一个任务'))unavailable.push({id:entry,reason:'有审查记录无法读取，请核对来源文件。'});}
  candidates.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));const items=[];
  const observation=candidates.length?await workspace.observe():undefined;
  for(const report of candidates.slice(0,50))try{items.push(await readStoredReview(workspace,report.id,task,observation));}
  catch(error){if(!(error as Error).message.includes('另一个任务'))unavailable.push({id:report.id,reason:(error as Error).message});}
  return {items,unavailable,truncated:candidates.length>50};
}
