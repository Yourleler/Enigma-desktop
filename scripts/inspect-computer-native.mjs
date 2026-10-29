import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {createComputerLabRuntime} from './interaction-computer-runtime.mjs';
const runtime=await createComputerLabRuntime({parent:process.argv[2],fixture:process.argv[3],helper:process.argv[4]});
let count=0;
async function execute(input){
  const result=await runtime.tool.execute('native-'+(++count),input,AbortSignal.timeout(30000),undefined,runtime.ctx);
  fs.writeFileSync(path.join(runtime.root,`step-${count}.json`),JSON.stringify({input,result},null,2));
  for(const block of result.content||[])if(block.type==='image')fs.writeFileSync(path.join(runtime.root,`step-${count}.png`),Buffer.from(block.data,'base64'));
  const {elements,...details}=result.details||{};
  console.log(JSON.stringify({step:count,details,text:result.content?.filter(block=>block.type==='text').map(block=>block.text.slice(0,750))}));
}
try {
  await new Promise(resolve=>setTimeout(resolve,800));
  console.log(JSON.stringify({root:runtime.root,pid:runtime.child.pid,appId:runtime.fixtureInfo.bundleId}));
  await execute({action:'list_windows',appId:runtime.fixtureInfo.bundleId});
  await execute({action:'status'});
  const lines=readline.createInterface({input:process.stdin});
  for await(const line of lines){if(line.trim()==='exit')break;try{await execute(JSON.parse(line));}catch(error){console.log(JSON.stringify({error:error.message}));}}
  lines.close();process.stdin.pause();
}catch(error){console.log(JSON.stringify({error:error.message}));process.exitCode=1;}
finally{await runtime.close();}
