import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {it,expect} from 'vitest';
import {pruneServerNodeModulesViaNft} from '../scripts/build-server-phases.mjs';

it('keeps conditional require dependencies reachable from protected CommonJS modules',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'enigma-export-trace-'));
  try {
    const lib=path.join(root,'node_modules/conditional');fs.mkdirSync(lib,{recursive:true});
    fs.writeFileSync(path.join(lib,'package.json'),JSON.stringify({name:'conditional',exports:{'.':{import:'./esm.mjs',require:'./cjs.cjs'}}}));
    fs.writeFileSync(path.join(lib,'esm.mjs'),'export default "esm";');fs.writeFileSync(path.join(lib,'cjs.cjs'),'module.exports="cjs";');
    fs.writeFileSync(path.join(root,'main.cjs'),'console.log(require("conditional"));');
    await pruneServerNodeModulesViaNft({outDir:root,nftRoots:['main.cjs'],externalPackageNames:[],runWithTargetNode:()=>{},log:()=>{}});
    expect(execFileSync(process.execPath,['main.cjs'],{cwd:root,encoding:'utf8'}).trim()).toBe('cjs');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
