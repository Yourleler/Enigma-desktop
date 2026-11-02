import {it,expect} from 'vitest';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {repositoryResources,repositoryBranches} from '../plugins/enigma/repository-resources';
it('lists multiple selected roots and references branches without changing the working checkout',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'enigma-repos-'));try{
 const repo=path.join(root,'repo'),docs=path.join(root,'docs');await fs.mkdir(repo);await fs.mkdir(docs);
 execFileSync('git',['init','-b','main',repo]);execFileSync('git',['-C',repo,'-c','user.name=Test','-c','user.email=test@example.com','commit','--allow-empty','-m','Initial']);execFileSync('git',['-C',repo,'branch','feature/topic']);
 const rows=await repositoryResources({},undefined,[repo,docs]);expect(rows.map(r=>[r.name,r.git])).toEqual([['repo',true],['docs',false]]);expect(rows[0].branch).toBe('main');
 expect(await repositoryBranches(repo)).toEqual(['feature/topic','main']);expect(execFileSync('git',['-C',repo,'branch','--show-current'],{encoding:'utf8'}).trim()).toBe('main');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
