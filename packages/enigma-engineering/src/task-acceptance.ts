import {join} from 'node:path';
import type {Workspace} from './workspace.js';
import {BackgroundRuns} from './background.js';
import {TaskEvents} from './task-events.js';
import {Artifacts} from './artifacts.js';
import {PlanStore} from './planning.js';
import {ensureDir,readJson,writeJson,safeId,id,hash} from './storage.js';
import type {UserNote} from './requirements.js';
import type {WorkbenchRequest} from './operation-history.js';
interface AcceptanceContext {planFile?:string;verification?:string;workbenchRequests?:WorkbenchRequest[]}

interface RequirementResolution {id:string;sourceHash:string;assessment:'addressed'|'not-applicable';reason:string;evidence:string[];artifacts:string[];at:string}
interface Assumption {id:string;text:string;failureCondition:string;status:'open'|'supported'|'refuted';evidence?:string;reason?:string;at:string}
interface AcceptanceLedger {schema:1;task:string;resolutions:RequirementResolution[];assumptions:Assumption[]}
/** Requirements remain host-resolved original messages. Model assessments are
 * explicit and traceable, while evidence validity and unfinished work are
 * checked mechanically before issuing a completion receipt.
 */
export class TaskAcceptance {
  constructor(readonly workspace:Workspace,readonly task:string){safeId(task);}
  private async file(){return join(await ensureDir(join(this.workspace.data,'acceptance')),`${this.task}.json`);}
  private async load():Promise<AcceptanceLedger>{try{const ledger=await readJson<AcceptanceLedger>(await this.file());if(ledger.schema!==1||ledger.task!==this.task)throw new Error('Acceptance task identity mismatch');return ledger;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {schema:1,task:this.task,resolutions:[],assumptions:[]};throw error;}}
  async resolve(notes:UserNote[],input:{id:string;assessment:'addressed'|'not-applicable';reason:string;evidence?:string[];artifacts?:string[]}){
    const source=notes.find(note=>note.id===input.id);if(!source||!['addressed','not-applicable'].includes(input.assessment)||!input.reason?.trim()||input.reason.length>4000||(input.evidence?.length||0)>12||(input.artifacts?.length||0)>12)throw new Error('Resolve an original user entry with a bounded explicit assessment');
    if(input.assessment==='addressed'&&!input.evidence?.length&&!input.artifacts?.length)throw new Error('Addressed requirements need actual source/check evidence or current artifacts');
    for(const evidence of input.evidence||[])if(!(await this.workspace.evidenceStatus(evidence)).valid)throw new Error('Requirement evidence is stale');
    for(const artifact of input.artifacts||[])if(!(await new Artifacts(this.workspace).read(artifact,this.task)).sourceCurrent)throw new Error('Requirement artifact source is stale');
    return this.workspace.exclusive(async()=>{const ledger=await this.load(),resolution:RequirementResolution={id:source.id,sourceHash:hash(source.text),assessment:input.assessment,reason:input.reason,evidence:input.evidence||[],artifacts:input.artifacts||[],at:new Date().toISOString()};ledger.resolutions=ledger.resolutions.filter(item=>item.id!==source.id);ledger.resolutions.push(resolution);await writeJson(await this.file(),ledger);return resolution;});
  }
  async assumption(input:{text:string;failureCondition:string}){
    if(!input.text?.trim()||!input.failureCondition?.trim()||input.text.length>2000||input.failureCondition.length>2000)throw new Error('An assumption needs a claim and a concrete falsifying condition');
    return this.workspace.exclusive(async()=>{const ledger=await this.load();if(ledger.assumptions.length>=30)throw new Error('Assumption budget reached');const item:Assumption={id:id('assumption'),text:input.text,failureCondition:input.failureCondition,status:'open',at:new Date().toISOString()};ledger.assumptions.push(item);await writeJson(await this.file(),ledger);return item;});
  }
  async testAssumption(assumption:string,status:'supported'|'refuted',evidence:string,reason:string){
    if(!['supported','refuted'].includes(status)||!reason?.trim()||reason.length>4000||(await this.workspace.evidenceStatus(evidence)).valid!==true)throw new Error('Assumption outcome requires current actual evidence and a reason');
    return this.workspace.exclusive(async()=>{const ledger=await this.load(),item=ledger.assumptions.find(item=>item.id===assumption);if(!item)throw new Error('Select an owned assumption');Object.assign(item,{status,evidence,reason,at:new Date().toISOString()});await writeJson(await this.file(),ledger);return item;});
  }
  async inspect(notes:UserNote[],options:AcceptanceContext={}){
    const source=await this.workspace.observe();
    const ledger=await this.load(),requirements=[],operationRequests=[];
    const evidenceReads=new Map<string,ReturnType<Workspace['evidenceStatus']>>(),artifactReads=new Map<string,ReturnType<Artifacts['read']>>();
    const readEvidence=(id:string)=>{let pending=evidenceReads.get(id);if(!pending){pending=this.workspace.evidenceStatus(id);evidenceReads.set(id,pending);}return pending;};
    const readArtifact=(id:string)=>{let pending=artifactReads.get(id);if(!pending){pending=new Artifacts(this.workspace).read(id,this.task);artifactReads.set(id,pending);}return pending;};
    const requestByEntry=new Map((options.workbenchRequests||[]).map(request=>[request.entry,request]));
    for(const note of notes){const resolution=ledger.resolutions.find(item=>item.id===note.id),problems=[];
      const request=requestByEntry.get(note.id),operation=request&&!request.goal&&request.sourceHash===hash(note.text)?request:undefined;
      const recorded=operation?.state==='completed'&&(operation.outcome===undefined||['passed','verified','completed','settled','acknowledged'].includes(operation.outcome));
      if(recorded){operationRequests.push({id:note.id,text:note.text,...operation,current:true,problems:[],assessment:'operation-receipt' as const});continue;}
      if(!resolution||resolution.sourceHash!==hash(note.text))problems.push('Original requirement has no current assessment');
      if(resolution)for(const evidence of resolution.evidence)try{if(!(await readEvidence(evidence)).valid)problems.push(`Evidence stale: ${evidence}`);}catch{problems.push(`Evidence unavailable: ${evidence}`);}
      if(resolution)for(const artifact of resolution.artifacts)try{if(!(await readArtifact(artifact)).sourceCurrent)problems.push(`Artifact source changed: ${artifact}`);}catch{problems.push(`Artifact unavailable: ${artifact}`);}
      if(operation)operationRequests.push({id:note.id,text:note.text,...operation,resolution,current:!problems.length,problems,assessment:'requires-review' as const});
      else requirements.push({id:note.id,text:note.text,resolution,current:!problems.length,problems});}
    const assumptions=[];for(const item of ledger.assumptions){let current=false;if(item.evidence)try{current=(await readEvidence(item.evidence)).valid;}catch{}assumptions.push({...item,current});}
    const operations=(await this.workspace.operations()).filter(operation=>['unknown','pending'].includes(operation.status));
    const background=await new BackgroundRuns(this.workspace).unresolved();
    const activeCommands=(await new BackgroundRuns(this.workspace).list(this.task)).filter(run=>run.spec.kind!=='service'&&!run.terminal);
    const waits=(await new TaskEvents(this.workspace).list(this.task)).filter(wait=>wait.spec.resume&&wait.state.status==='waiting');
    const plan=await new PlanStore(this.workspace,options.planFile).view();
    let verification:Awaited<ReturnType<Workspace['reusableVerification']>>|undefined,verificationIssue:string|undefined;
    if(options.verification)try{verification=await this.workspace.reusableVerification(options.verification);}
    catch{verificationIssue='原验收记录不可用，或仍有未核对的执行效果。请核对运行记录后重新验收。';}
    const gaps=[...requirements.filter(item=>!item.current).map(item=>`requirement:${item.id}`),...assumptions.filter(item=>item.status==='open'||!item.current).map(item=>`assumption:${item.id}`),...operations.map(item=>`operation:${item.id}`),...background.map(item=>`background:${item}`),...plan&&plan.completed<plan.total?['plan:unfinished']:[],...this.workspace.config.checks.length&&!verification?['original-checks:not-currently-verified']:[]];
    const sourceStable=JSON.stringify(source)===JSON.stringify(await this.workspace.observe());
    gaps.push(...waits.map(wait=>`wait:${wait.spec.id}`));
    gaps.push(...activeCommands.map(run=>`command:${run.spec.id}`));
    gaps.push(...operationRequests.filter(item=>!item.current).map(item=>`workbench:${item.id}`));
    if(!requirements.length)gaps.push('requirements:no-task-goal');
    if(!sourceStable)gaps.push('source:changed-during-acceptance');
    if(verificationIssue)gaps.push('verification:unavailable');
    return {requirements,operationRequests,assumptions,plan,verification,verificationIssue,gaps,waits,activeCommands,source,sourceStable,readyForReview:requirements.length>0&&!gaps.length,note:'Requirement and assumption coverage is an explicit model assessment, not a proof of semantic correctness. App-owned routine actions are linked to their actual receipts, not semantic task completion. Goal-bearing inputs, failed/unknown actions, current checks and unresolved effects still require review.'};
  }
  async receipt(notes:UserNote[],options:AcceptanceContext={}){
    return this.workspace.exclusive(async()=>{
    const assessment=await this.inspect(notes,options);if(!assessment.readyForReview)throw new Error(`Completion has unresolved requirements/evidence: ${assessment.gaps.join(', ')}`);
    const receipt={schema:1,id:id('completion'),task:this.task,at:new Date().toISOString(),assessment,source:assessment.source};
    await writeJson(join(await ensureDir(join(this.workspace.data,'acceptance')),`${receipt.id}.json`),receipt);return receipt;
    });
  }
}
