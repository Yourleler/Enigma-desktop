import {lstat,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import type {Workspace} from './workspace.js';
import {exportHandoff,inspectHandoff,type ContextNote,type HandoffInput} from './handoff.js';
import {safeId,writeJson} from './storage.js';
import type {MemoryAccess} from './memory.js';

/** Deltas retain the requirement lane, even when the caller selects only new
 * background. The base is used for comparison, never as target authority. */
export async function exportDifferentialHandoff(workspace:Workspace,baseDirectory:string,destination:string,input:HandoffInput){
  const base=await inspectHandoff(workspace,baseDirectory,{memoryAccess:input.memoryAccess}),old=base.manifest;
  if(resolve(old.sourceWorkspace)!==workspace.root||old.source.agent!==input.source.agent||old.source.session!==input.source.session)throw new Error('Differential handoff base must belong to the same source workspace and conversation');
  if(!Array.isArray(input.notes))throw new Error('Select notes for the differential handoff');
  const original=old.notes.filter(note=>note.kind==='requirement'||note.role==='user');
  for(const note of original){const changed=input.notes.find(current=>current.reference===note.reference);if(changed&&(changed.role!==note.role||changed.kind!==note.kind||changed.text!==note.text))throw new Error('Original requirement provenance changed; use a fresh full handoff');}
  const originalMissing=original.filter(note=>!input.notes.some(current=>current.reference===note.reference));
  const selected=[...originalMissing,...input.notes];
  const notes=selected.filter(note=>note.kind==='requirement'||note.role==='user'||!old.notes.some(previous=>previous.reference===note.reference&&previous.role===note.role&&previous.kind===note.kind&&previous.text===note.text));
  const current=await exportHandoff(workspace,destination,{...input,notes});
  const omitted=selected.length-notes.length;
  const delta={schema:1,base:{id:old.id,documentHash:old.documentHash},current:current.id,
    changedNotes:notes.map(note=>({reference:note.reference,role:note.role,kind:note.kind})),omittedUnchangedBackground:omitted,
    changedRepositories:current.repos.filter(repo=>!old.repos.some(previous=>previous.id===repo.id&&previous.filesHash===repo.filesHash&&previous.head===repo.head&&previous.branch===repo.branch)),
    note:'All source/user requirements are included. Unchanged non-authoritative background is omitted and may need the earlier handoff; current repository/check provenance remains self-contained.'};
  await writeJson(join(destination,'delta.json'),delta);return {manifest:current,delta};
}
export async function inspectDifferentialHandoff(workspace:Workspace,directory:string,options:{memoryAccess?:MemoryAccess}={}){
  const current=await inspectHandoff(workspace,directory,options),file=join(directory,'delta.json');
  const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1000000)throw new Error('Invalid differential handoff metadata');
  const delta=JSON.parse(await readFile(file,'utf8'));
  if(delta.schema!==1||delta.current!==current.manifest.id||!delta.base?.id||!/^[a-f0-9]{64}$/.test(delta.base.documentHash)||!Number.isSafeInteger(delta.omittedUnchangedBackground)||delta.omittedUnchangedBackground<0||!Array.isArray(delta.changedNotes)||!Array.isArray(delta.changedRepositories))throw new Error('Invalid differential handoff provenance');
  safeId(delta.base.id);
  const noteKeys=(notes:{reference:string;role:ContextNote['role'];kind:ContextNote['kind']}[])=>notes.map(note=>`${note.reference}:${note.role}:${note.kind}`).sort();
  if(JSON.stringify(noteKeys(delta.changedNotes))!==JSON.stringify(noteKeys(current.manifest.notes)))throw new Error('Differential note list does not match the exported document');
  if(delta.changedRepositories.some((repo:unknown)=>!current.manifest.repos.some(current=>JSON.stringify(current)===JSON.stringify(repo))))throw new Error('Differential repository provenance does not match the exported document');
  const warning=delta.omittedUnchangedBackground?`This delta omits ${delta.omittedUnchangedBackground} unchanged background items. Use the previously shared handoff ${delta.base.id} if those details are needed; do not invent omitted content.`:'';
  return {...current,delta,warnings:[...current.warnings,...(warning?[warning]:[])],prompt:current.prompt+(warning?'\n'+warning:'')};
}
export async function inspectPortableHandoff(workspace:Workspace,directory:string,options:{memoryAccess?:MemoryAccess}={}){
  try{await lstat(join(directory,'delta.json'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return inspectHandoff(workspace,directory,options);throw error;}
  return inspectDifferentialHandoff(workspace,directory,options);
}
