import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createBrowserLabRuntime} from './interaction-browser-runtime.mjs';
import {createInteractionModelRuntime} from './interaction-model-runtime.mjs';
import {completeSimple} from '../lib/pi-sdk/index.ts';
import {normalizeProviderPayload} from '../core/provider-compat.ts';
import {redactLogText} from '../lib/log-redactor.ts';
import {ModelCapabilityObservations,modelCapabilitySignature} from '../core/model-capability-observations.ts';
let browser,models;
try {
  models=await createInteractionModelRuntime({profile:process.argv[2]});
  browser=await createBrowserLabRuntime({parent:process.argv[3]||os.tmpdir()});
  await browser.manager.navigate(browser.lab.url+'/vision.html',browser.sessionPath);
  const capture=await browser.manager.screenshot(browser.sessionPath);
  fs.writeFileSync(path.join(browser.lab.root,'vision-probe.jpg'),Buffer.from(capture.base64,'base64'));
  const credentials=await models.manager.resolveModelWithCredentialsFresh(models.model);
  // Probe only: never rewrite the user's declared model capabilities here.
  const model={...models.model,input:['text','image']};
  const started=Date.now();
  const result=await completeSimple(model,{systemPrompt:'Read only the supplied test image. Do not guess an unreadable code.',messages:[{role:'user',timestamp:Date.now(),content:[{type:'text',text:'请只回复图片里浅紫色卡片内的八位英文数字编号。'}, {type:'image',data:capture.base64,mimeType:capture.mimeType}]}]},
    {apiKey:credentials.api_key,headers:credentials.headers,reasoning:'low',maxTokens:2048,signal:AbortSignal.timeout(120000),onPayload:payload=>normalizeProviderPayload(payload,model,{mode:'chat',reasoningLevel:'low'})});
  const answer=(result.content||[]).filter(block=>block.type==='text').map(block=>block.text).join('').trim();
  const expected=JSON.parse(fs.readFileSync(path.join(browser.lab.root,'vision-oracle.json'),'utf8')).code;
  const matched=answer.toUpperCase().includes(expected);
  const report={matched,model:model.id,modelSignature:modelCapabilitySignature(models.model),declaredInput:models.model.input,probeInput:model.input,answer,expected,elapsedMs:Date.now()-started,usage:result.usage,stopReason:result.stopReason};
  if(matched&&process.argv.includes('--record')) {
    const current=await createInteractionModelRuntime({profile:process.argv[2]});
    try {
      if(modelCapabilitySignature(current.model)!==report.modelSignature)throw new Error('Model configuration changed during the probe; result was not recorded');
      new ModelCapabilityObservations(process.argv[2]).recordImageSupport(models.model,{matched:true,imageSha256:createHash('sha256').update(Buffer.from(capture.base64,'base64')).digest('hex')});
      report.recorded=true;
    } finally {current.close();}
  }
  fs.writeFileSync(path.join(browser.lab.root,'vision-result.json'),JSON.stringify(report,null,2));
  console.log('ENIGMA_VISION '+JSON.stringify({matched,model:model.id,root:browser.lab.root,elapsedMs:report.elapsedMs,stopReason:result.stopReason}));
  if(!matched)process.exitCode=1;
} catch(error) {
  const report={matched:false,error:redactLogText(error.message)};
  if(browser)fs.writeFileSync(path.join(browser.lab.root,'vision-result.json'),JSON.stringify(report,null,2));
  console.log('ENIGMA_VISION '+JSON.stringify({...report,root:browser?.lab.root}));process.exitCode=1;
} finally {if(browser)await browser.close();models?.close();}
