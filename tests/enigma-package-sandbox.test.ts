import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../packages/enigma-engineering/dist/test/fixtures.js';
import {Workspace,TaskPackages} from 'enigma-next';
import {runProcess} from 'enigma-next/process';
import {withNativeEngineeringExecution} from '../plugins/enigma/execution-policy.ts';

it.skipIf(process.platform!=='darwin')('initializes a package outside the launcher sandbox while later commands obey imported repository grants',async()=>{
 const {root,workspace}=await fixture();
 try{
  const packaged=await new TaskPackages(workspace).export({goal:'sandbox import',source:{agent:'pi'},notes:[]});
  const launcherRoot=path.join(root,'launcher');await fs.mkdir(launcherRoot);const launcher=await Workspace.open(launcherRoot),native=path.join(root,'profile/agents/test/sessions');await fs.mkdir(native,{recursive:true});
  const engine={hanakoHome:path.join(root,'profile'),getEngineeringExecutionPreferences:()=>({sandbox:true,network:false})},sourcePath=path.join(native,'source.jsonl');
  const restored=await withNativeEngineeringExecution(engine,launcher,sourcePath,()=>TaskPackages.restore(packaged.directory,path.join(root,'restored'),{writeRepos:['sdk'],expectedManifest:packaged.manifestHash}));
  expect(restored.workspace.repo('library').access).toBe('read');
  const deniedFile=path.join(restored.workspace.repo('library').root,'denied.txt'),allowedFile=path.join(restored.workspace.repo('sdk').root,'allowed.txt');
  const attempt=async(file:string)=>withNativeEngineeringExecution(engine,restored.workspace,sourcePath,()=>runProcess([process.execPath,'-e','require("fs").writeFileSync(process.argv[1],"test")',file],restored.workspace.root,{timeoutMs:5000}));
  expect((await attempt(deniedFile)).status).toBe('failed');await expect(fs.access(deniedFile)).rejects.toMatchObject({code:'ENOENT'});
  expect((await attempt(allowedFile)).status).toBe('passed');expect(await fs.readFile(allowedFile,'utf8')).toBe('test');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
