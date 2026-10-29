import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
const mode=process.argv[2]||'check';
if(!['check','pack'].includes(mode))throw new Error('Use check or pack');
const overlay=(await import('../build/enigma-electron-builder.cjs')).default;
if(overlay.appId==='com.hanako.app'||overlay.publish[0].repo!=='Enigma-desktop')throw new Error('Enigma release identity must be independent');
if(mode==='check'){console.log(JSON.stringify({product:overlay.productName,appId:overlay.appId,updateRepository:`${overlay.publish[0].owner}/${overlay.publish[0].repo}`,output:overlay.directories.output,signatureVerification:'existing signed seed kit remains required'}));}
else{
  const run=(command,args)=>new Promise((resolve,reject)=>{const child=spawn(command,args,{stdio:'inherit',env:{...process.env,ENIGMA_DESKTOP_PRODUCT:'1'}});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`${command} exited ${code}`)));});
  await run('npm',['run','build:computer-use-helper']);await run('npm',['run','build:client']);await run('npm',['run','build:server']);await run('npm',['run','verify:seed-kit']);
  await run('npx',['electron-builder','--dir','--config','build/enigma-electron-builder.cjs']);
  if(process.platform==='darwin'&&process.env.CSC_IDENTITY_AUTO_DISCOVERY==='false')await run(process.execPath,['scripts/sign-local.cjs',path.join('dist-enigma',`mac-${process.arch}`,'Enigma.app')]);
  const directory=path.resolve('dist-enigma');if(!(await fs.stat(directory)).isDirectory())throw new Error('Enigma artifact directory was not created');console.log(`Built Enigma into ${directory}`);
}
