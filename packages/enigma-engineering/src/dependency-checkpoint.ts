import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Workspace} from './workspace.js';
import {BackgroundRuns} from './background.js';
import {hash,id,readJson,writeJson,safeId} from './storage.js';
import type {FileVersion} from './types.js';

export interface DependencyVersion {repo:string;file:string;before?:FileVersion;after?:FileVersion}
export interface DependencySource {task:string;root:string;baseline:string;writeRepos:string[];inputs?:DependencyVersion[]}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);

/** Freeze upstream outputs into a downstream starting checkpoint without
 * applying them to the user's working tree. Parent integration later requires
 * these inputs to have been explicitly selected into the parent first. */
export async function dependencyCheckpoint(parent:Workspace,task:string,sources:DependencySource[]){
 safeId(task);
 if(sources.length>12||new Set(sources.map(source=>source.task)).size!==sources.length)throw new Error('Dependency input requires at most 12 distinct owned tasks');
 return parent.exclusive(async()=>{
  const observed=await parent.observe(),original=await parent.checkpoint(`manager:${task}`),checkpoint=structuredClone(original);
  if(!sources.length)return {checkpoint:original,inputs:[] as DependencyVersion[]};
  const touched=new Map<string,{repo:string;file:string}>(),captured=[];
  for(const source of sources){
   safeId(source.task);const child=await Workspace.open(source.root),origin=await readJson<{state:string;sourceWorkspace:string;checkpoint:string}>(join(child.data,'fork-origin.json'));
   if(origin.state!=='complete'||origin.sourceWorkspace!==parent.root||origin.checkpoint!==source.baseline)throw new Error('Dependency workspace does not match its owned source checkpoint');
   if((await child.operations()).some(op=>['pending','unknown'].includes(op.status))||(await new BackgroundRuns(child).unresolved()).length)throw new Error('Dependency has unresolved effects');
   const before=await parent.loadCheckpoint(source.baseline),identity=await child.observe(),after=await child.exclusive(()=>child.checkpoint('dependency output'));
   captured.push({child,identity});
   const merge=async(change:DependencyVersion)=>{
    const repo=checkpoint.repos.find(r=>r.repo.id===change.repo);if(!repo)throw new Error('Dependency repository is not registered in the parent');
    await parent.path(change.repo,change.file);
    const current=repo.files[change.file];
    if(!same(current,change.before)&&!same(current,change.after))throw new Error(`Dependency code conflicts: ${change.repo}/${change.file}`);
    if(change.after){
     if(!/^[a-f0-9]{64}$/.test(change.after.hash))throw new Error('Invalid dependency blob identity');
     const bytes=await readFile(join(child.data,'blobs',change.after.hash));if(hash(bytes)!==change.after.hash)throw new Error('Dependency blob integrity mismatch');const blob=join(parent.data,'blobs',change.after.hash);
     await writeFile(blob,bytes,{mode:0o600,flag:'wx'}).catch(error=>{if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;});
     if(hash(await readFile(blob))!==change.after.hash)throw new Error('Dependency blob integrity mismatch');
     repo.files[change.file]=change.after;
    }else delete repo.files[change.file];
    touched.set(`${change.repo}:${change.file}`,{repo:change.repo,file:change.file});
   };
   for(const input of source.inputs||[]){
    if(!same(before.repos.find(repo=>repo.repo.id===input.repo)?.files[input.file],input.after))throw new Error('Dependency input does not match its starting checkpoint');
    await merge(input);
   }
   if(before.repos.length!==after.repos.length)throw new Error('Dependency repository set changed');
   for(const base of before.repos){
    const current=after.repos.find(repo=>repo.repo.id===base.repo.id);if(!current)throw new Error('Dependency repository identity changed');
    for(const file of new Set([...Object.keys(base.files),...Object.keys(current.files)])){
     if(same(base.files[file],current.files[file]))continue;
     if(!source.writeRepos.includes(base.repo.id))throw new Error(`Dependency changed a repository outside its grant: ${base.repo.id}`);
     await merge({repo:base.repo.id,file,before:base.files[file],after:current.files[file]});
    }
   }
  }
  for(const {child,identity} of captured)if(!same(identity,await child.observe()))throw new Error('Dependency changed while preparing downstream input');
  if(!same(observed,await parent.observe()))throw new Error('Parent changed while preparing dependency inputs');
  checkpoint.id=id('checkpoint');checkpoint.label=`dependency input:${task}`;checkpoint.purpose='dependency-input';
  await writeJson(join(parent.data,'checkpoints',`${checkpoint.id}.json`),checkpoint);
  const inputs=[...touched.values()].map(({repo,file})=>({repo,file,before:original.repos.find(r=>r.repo.id===repo)!.files[file],after:checkpoint.repos.find(r=>r.repo.id===repo)!.files[file]}));
  return {checkpoint,inputs};
 });
}
