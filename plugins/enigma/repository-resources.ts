import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import {conversationChanges} from '../../core/conversation-change-capture.ts';
const exec=promisify(execFile);
async function git(root:string,args:string[]){return (await exec('git',['-C',root,'-c','core.fsmonitor=false',...args],{timeout:8000,maxBuffer:512000,env:{...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'}})).stdout.trim();}
export async function repositoryResources(engine:any,sessionPath:string|undefined,selected:string[]=[]){
 const roots=sessionPath?(await conversationChanges(engine).resolveRoots(sessionPath)).map(r=>r.root):selected;
 return Promise.all([...new Set(roots)].map(async root=>{
  const real=await fs.realpath(root);if(!(await fs.stat(real)).isDirectory())throw Error('请选择目录');
  let branch='',gitRoot='';try{gitRoot=await fs.realpath(await git(real,['rev-parse','--show-toplevel']));branch=await git(real,['branch','--show-current']);}catch{gitRoot='';}
  return {path:real,name:path.basename(real),git:!!gitRoot,gitRoot:gitRoot||null,branch:gitRoot?(branch||'分离 HEAD'):null};
 }));
}
export async function repositoryBranches(root:string){return (await git(root,['for-each-ref','--format=%(refname:short)','refs/heads','refs/remotes'])).split('\n').filter(Boolean);}
export async function githubResources(input:{repo?:string;page?:number}={}){
 const page=input.page||1;if(!Number.isSafeInteger(page)||page<1)throw Error('页码无效');
 if(input.repo&&!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repo))throw Error('仓库应为 owner/repo');
 const endpoint=input.repo?`repos/${input.repo}/branches?per_page=100&page=${page}`:`user/repos?per_page=100&sort=pushed&page=${page}`;
 try{
  const {stdout}=await exec('gh',['api','--hostname','github.com','--method','GET',endpoint],{timeout:20000,maxBuffer:4*1024*1024,env:{...process.env,GH_PROMPT_DISABLED:'1'}});
  const data=JSON.parse(stdout);
  return {items:data.map((item:any)=>input.repo?{name:item.name,sha:item.commit.sha,url:`https://github.com/${input.repo}/tree/${encodeURIComponent(item.name)}`}:{name:item.full_name,url:item.html_url,branch:item.default_branch,private:item.private,description:item.description||''}),nextPage:data.length===100?page+1:null};
 }catch(error){
  if((error as any).code==='ENOENT')throw Error('请先安装 GitHub CLI，并在终端运行 gh auth login。');
  throw Error('无法读取 GitHub，请确认 gh auth login 已登录且账号有访问权限。');
 }
}
