import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Workspace } from './workspace.js';
import { BackgroundRuns } from './background.js';
import { ensureDir, hash, id, readJson, safeId, writeJson } from './storage.js';
import type { Observation } from './types.js';

export interface CheckpointIntegrationPreview {
  schema: 1; id: string; owner: string; worker: string; baseline: string;
  childRoot: string; child: Observation; expected: string; proposed: string;
  criteriaHash: string; writeRepos: string[];
  changes: {repo:string;file:string;state:'apply'|'already-present'|'conflict';reason?:string}[];
  applyAllowed: boolean; createdAt: string;
}

const same=(left:unknown,right:unknown)=>JSON.stringify(left)===JSON.stringify(right);

/** Select settled code results with an optimistic, source-grounded preview.
 * Divergent edits require a new worker decision; there is no model-decided
 * overwrite or implicit restoration of files outside the selected changes.
 */
export class CheckpointIntegrations {
  constructor(readonly workspace:Workspace) {}
  private async directory(preview:string){return ensureDir(join(this.workspace.data,'merge-previews',safeId(preview)));}
  async preview(input:{owner:string;worker:string;childRoot:string;baseline:string;writeRepos:string[]}) {
    safeId(input.owner);safeId(input.worker);
    const child=await Workspace.open(input.childRoot);
    const origin=await readJson<{checkpoint:string;sourceWorkspace:string;state:string}>(join(child.data,'fork-origin.json'));
    if(origin.state!=='complete'||origin.sourceWorkspace!==this.workspace.root||origin.checkpoint!==input.baseline)throw new Error('Worker source provenance does not match the integration baseline');
    if((await child.operations()).some(operation=>['unknown','pending'].includes(operation.status))||(await new BackgroundRuns(child).unresolved()).length)throw new Error('Worker effects are unresolved');
    return this.workspace.exclusive(async()=>{
      await this.workspace.reload();
      const baseline=await this.workspace.loadCheckpoint(input.baseline);
      const observed=await child.observe(),childCheckpoint=await child.exclusive(()=>child.checkpoint('selected worker result'));
      if(!same(observed,await child.observe()))throw new Error('Worker changed during integration preview');
      const expected=await this.workspace.checkpoint('before managed integration'),proposed=structuredClone(expected);
      proposed.id=id('checkpoint');proposed.label=`managed integration:${input.worker}`;
      const preview:CheckpointIntegrationPreview={schema:1,id:id('integration'),owner:input.owner,worker:input.worker,baseline:input.baseline,
        childRoot:child.root,child:observed,expected:expected.id,proposed:proposed.id,criteriaHash:hash(JSON.stringify(this.workspace.config.checks)),
        writeRepos:[...input.writeRepos],changes:[],applyAllowed:false,createdAt:new Date().toISOString()};
      if(baseline.repos.length!==childCheckpoint.repos.length)throw new Error('Worker repository set changed');
      for(const base of baseline.repos){
        const ours=proposed.repos.find(repo=>repo.repo.id===base.repo.id),theirs=childCheckpoint.repos.find(repo=>repo.repo.id===base.repo.id);
        if(!ours||!theirs)throw new Error('Worker repository set differs from the current parent');
        for(const file of new Set([...Object.keys(base.files),...Object.keys(theirs.files)])){
          const original=base.files[file],chosen=theirs.files[file],current=ours.files[file];
          if(same(original,chosen))continue;
          const change:CheckpointIntegrationPreview['changes'][number]={repo:base.repo.id,file,state:'apply'};preview.changes.push(change);
          if(!input.writeRepos.includes(base.repo.id)||this.workspace.repo(base.repo.id).access!=='write'){change.state='conflict';change.reason='Selected change is outside current repository grants';}
          else if(same(current,chosen))change.state='already-present';
          else if(!same(current,original)){change.state='conflict';change.reason='Parent and worker changed the same file differently';}
          else if(!chosen)delete ours.files[file];
          else{
            const bytes=await readFile(join(child.data,'blobs',chosen.hash));if(hash(bytes)!==chosen.hash)throw new Error('Worker blob integrity mismatch');
            const target=join(this.workspace.data,'blobs',chosen.hash);
            await writeFile(target,bytes,{mode:0o600,flag:'wx'}).catch(error=>{if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;});
            if(hash(await readFile(target))!==chosen.hash)throw new Error('Integration blob integrity mismatch');
            ours.files[file]=chosen;
          }
        }
      }
      preview.applyAllowed=!preview.changes.some(change=>change.state==='conflict');
      if(!same(observed,await child.observe()))throw new Error('Worker changed before integration publication');
      await writeJson(join(this.workspace.data,'checkpoints',`${proposed.id}.json`),proposed);
      await writeJson(join(await this.directory(preview.id),'managed-preview.json'),preview);
      return preview;
    });
  }
  async apply(previewId:string,owner:string,writeRepos:string[],signal?:AbortSignal){
    const preview=await readJson<CheckpointIntegrationPreview>(join(await this.directory(previewId),'managed-preview.json'));
    if(preview.schema!==1||preview.id!==previewId||preview.owner!==owner||!preview.applyAllowed
      ||preview.changes.some(change=>change.state!=='already-present'&&!writeRepos.includes(change.repo)))throw new Error('Integration is conflicting or outside current ownership/grants');
    const child=await Workspace.open(preview.childRoot);
    if(!same(preview.child,await child.observe())||(await new BackgroundRuns(child).unresolved()).length)throw new Error('Worker changed or has unresolved effects after preview');
    return this.workspace.exclusive(async()=>{
      await this.workspace.reload();signal?.throwIfAborted();
      if(preview.criteriaHash!==hash(JSON.stringify(this.workspace.config.checks)))throw new Error('Original acceptance definitions changed after preview');
      await this.workspace.restore(preview.proposed,preview.expected);
      const verification=await this.workspace.verify(signal);
      const receipt={schema:1,id:id('integration-result'),owner,worker:preview.worker,preview:preview.id,createdAt:new Date().toISOString(),criteriaHash:preview.criteriaHash,verification};
      await writeJson(join(await this.directory(preview.id),'managed-result.json'),receipt);return receipt;
    });
  }
}
