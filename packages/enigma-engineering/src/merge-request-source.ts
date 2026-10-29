import type {Workspace} from './workspace.js';
import {runProcess} from './process.js';
export interface MergeRequestSource {repo:string;url:string;base:string;target:string;number:number;remote:string}
export function githubRequest(url:string){const parsed=new URL(url),match=/^\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\/?$/.exec(parsed.pathname);if(parsed.protocol!=='https:'||parsed.hostname!=='github.com'||parsed.username||parsed.password||!match)throw new Error('Select a GitHub pull request URL');return {owner:match[1]!,repository:match[2]!,number:Number(match[3])};}
export function githubRemote(remote:string){const match=/^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(remote.trim());return match?{owner:match[1]!,repository:match[2]!}:null;}
/** Remote identity is matched to a registered origin before metadata is read.
 * Fetching only immutable API-resolved commits does not switch HEAD or index.
 */
export async function resolveMergeRequest(workspace:Workspace,url:string,options:{repo?:string;fetch?:boolean;signal?:AbortSignal}={}):Promise<MergeRequestSource>{
  const request=githubRequest(url),matches=[];
  for(const repo of workspace.config.repos.filter(repo=>!options.repo||repo.id===options.repo)){
    const result=await runProcess(['git','remote','get-url','origin'],repo.root,{internalGit:true,signal:options.signal});if(result.status!=='passed')continue;const origin=githubRemote(result.output.trim());if(origin?.owner.toLowerCase()===request.owner.toLowerCase()&&origin.repository.toLowerCase()===request.repository.toLowerCase())matches.push(repo);
  }
  if(matches.length!==1)throw new Error('Pull request must match one registered repository origin; select repo explicitly when needed');
  const repo=matches[0]!,metadata=await runProcess(['gh','api',`repos/${request.owner}/${request.repository}/pulls/${request.number}`],workspace.root,{signal:options.signal,timeoutMs:15000,limit:100000});
  if(metadata.status!=='passed'||metadata.truncated)throw new Error('Pull request metadata is unavailable; no revision was inferred');
  const response=JSON.parse(metadata.output);if(response.number!==request.number||response.base?.repo?.full_name?.toLowerCase()!==`${request.owner}/${request.repository}`.toLowerCase()||!response.base?.sha||!response.head?.sha||![response.base.sha,response.head.sha].every(sha=>/^[a-f0-9]{40}$/.test(sha)))throw new Error('Pull request identity or immutable revisions do not match');
  for(const revision of [response.base.sha,response.head.sha]){
    const available=await runProcess(['git','cat-file','-e',`${revision}^{commit}`],repo.root,{internalGit:true,signal:options.signal});
    if(available.status==='passed')continue;
    if(!options.fetch)throw new Error('Exact pull request commits are not local; fetch requires explicit source approval');
    if(repo.access!=='write')throw new Error('Pull request commit fetch cannot alter a read-only repository');
    const fetched=await runProcess(['git','fetch','--no-tags','origin',revision],repo.root,{internalGit:true,signal:options.signal,timeoutMs:60000});if(fetched.status!=='passed')throw new Error('Exact pull request commit could not be fetched from its registered origin');
  }
  return {repo:repo.id,url,base:response.base.sha,target:response.head.sha,number:request.number,remote:'origin'};
}
