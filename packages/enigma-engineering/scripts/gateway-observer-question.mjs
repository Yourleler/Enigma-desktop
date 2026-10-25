import { homedir as userHomeDirectory } from 'node:os';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { crossLanguageFixture } from '../dist/test/cross-language-fixtures.js';
import { RunObserver } from '../dist/src/observer.js';
import { askObserver } from '../dist/src/observer-questions.js';
import { explainSnapshot } from '../dist/src/pi-explanation.js';
import { configureGateway } from '../dist/src/model-config.js';
import { runProcess } from '../dist/src/process.js';
const output=resolve(process.argv[2]??userHomeDirectory() + '/Documents/Codex/2026-10-25/enigma-next-validation/live-observer-question');await mkdir(output,{recursive:true});
const {root,workspace}=await crossLanguageFixture();const agentDir=await configureGateway(workspace.data);
const observer=await RunObserver.create(root,'live-observer-query');workspace.activity=event=>observer.record(event);
const stop=join(root,'stop');observer.record({kind:'start',stage:'run',id:'actual-command'});
const ready=join(root,'ready');
const running=workspace.exclusive(()=>workspace.mutate('sdk','command',()=>runProcess([process.execPath,'-e',`const fs=require('fs');fs.writeFileSync(${JSON.stringify(ready)},'ready');const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(stop)}))clearInterval(timer)},50);`],workspace.repo('sdk').root,{timeoutMs:60000})));
try {
 for(let i=0;i<150;i++){try{await (await import('node:fs/promises')).readFile(ready);break;}catch{await new Promise(resolve=>setTimeout(resolve,20));}}
 await new Promise(resolve=>setTimeout(resolve,500));
 await observer.flush();
 const answer=await askObserver(root,'现在这个 Agent 是卡住了还是在运行，为什么没有输出？',{explain:(snapshot,question,signal)=>explainSnapshot(agentDir,snapshot,question,signal),timeoutMs:30000});
 assert(answer.available);assert(answer.usedModel,JSON.stringify(answer));
 assert(observer.state.active.some(stage=>stage.stage==='process'),'main command must still be running until after explanation');
 await writeFile(join(output,'report.json'),JSON.stringify({kind:'real-independent-observer-question',answer,mainCommandStillActive:true,explanationBackend:'existing Gateway',limitations:['one actual silent subprocess; model explanation restricted to observed snapshot','no proof of hidden internal progress']},null,2));
 console.log(JSON.stringify({report:join(output,'report.json'),usedModel:answer.usedModel,answer:answer.answer}));
} finally {await writeFile(stop,'stop');await running;await observer.close();await rm(root,{recursive:true,force:true});}
