/** Launch a new packaged-browser acceptance fixture. UI checks stay pending
 * until native interaction and observed results have been recorded. */
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {prepareEnigmaProfile} from './enigma-profile.mjs';
import {createInteractionLab} from './create-interaction-lab.mjs';

if(!process.argv[2]||!process.argv[3])throw new Error('Pass the candidate .app path and an external evidence directory');
const app=path.resolve(process.argv[2]);
const executable=path.join(app,'Contents/MacOS/Enigma');
fs.accessSync(executable,fs.constants.X_OK);
const lab=await createInteractionLab({parent:path.resolve(process.argv[3])});
const profile=path.join(lab.root,'desktop-profile');
await prepareEnigmaProfile({dataRoot:profile,workspace:lab.root});
fs.mkdirSync(path.join(profile,'user'),{recursive:true});
fs.writeFileSync(path.join(profile,'user/preferences.json'),JSON.stringify({setupComplete:true}));
const log=fs.openSync(path.join(lab.root,'app.log'),'w');
const env={...process.env,HANA_HOME:profile,ENIGMA_DESKTOP_DATA:profile,ENIGMA_DESKTOP_PRODUCT:'1'};
delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(executable,[],{env,stdio:['ignore',log,log]});
const record={status:'awaiting-native-interaction',app,profile,url:lab.url,checks:[
  'Enter Chinese and a normal key in the new browser fixture.',
  'Collapse/reopen and detach/redock; verify form values remain.',
  'Find text, advance results, zoom/reset and use keyboard shortcuts.',
  'Open another tab, navigate back/forward, then close that tab.',
  'Download the fixture text and preview its actual bytes.',
  'Accept/cancel prompts; check focus and settings occlusion.',
  'Visit /delayed.html and stop before eight seconds; verify address recovery.',
  'Verify candidate version and save observed results separately.',
]};
fs.writeFileSync(path.join(lab.root,'packaged-browser-checklist.json'),JSON.stringify(record,null,2));
console.log(JSON.stringify({root:lab.root,...record}));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill('SIGTERM'));
try{await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});}
finally{fs.closeSync(log);await lab.close();}
