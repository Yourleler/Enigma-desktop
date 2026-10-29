import fs from 'node:fs';
import path from 'node:path';
import {createComputerLabRuntime} from './interaction-computer-runtime.mjs';
import {createInteractionModelRuntime} from './interaction-model-runtime.mjs';
import {createAgentSession,SessionManager,SettingsManager,DefaultResourceLoader} from '../lib/pi-sdk/index.ts';
import {normalizeProviderContextMessages,normalizeProviderPayload} from '../core/provider-compat.ts';
import {redactLogText} from '../lib/log-redactor.ts';

let native,modelRuntime,session,timer,unsubscribe;
const steps=[],responses=[];let requests=0;
try {
  native=await createComputerLabRuntime({parent:process.argv[2],fixture:process.argv[3],helper:process.argv[4]});
  const windows=await native.host.listWindows(native.ctx,native.fixtureInfo.bundleId);
  const window=windows.find(win=>win.isOnScreen&&win.bounds?.height>400&&win.bounds?.width>400);
  if(!window)throw new Error('The new native fixture window is unavailable');
  const status=await native.provider.getStatus();
  if(!status.permissions?.every(permission=>permission.granted))throw new Error('Native system permissions are not ready: '+JSON.stringify(status.permissions));
  modelRuntime=await createInteractionModelRuntime({profile:process.argv[5]});
  const settings=SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false}});
  const compatibility=pi=>{
    pi.on('context',(event,ctx)=>({messages:normalizeProviderContextMessages(event.messages,ctx.model,{mode:'chat',reasoningLevel:'low'})}));
    pi.on('before_provider_request',(event,ctx)=>{if(++requests>40)throw new Error('Native model request limit reached');console.log(JSON.stringify({request:requests}));return normalizeProviderPayload(event.payload,ctx.model,{mode:'chat',reasoningLevel:'low'});});
  };
  const resources=new DefaultResourceLoader({cwd:native.root,agentDir:modelRuntime.directory,settingsManager:settings,noContextFiles:true,noSkills:true,noPromptTemplates:true,noThemes:true,disabledBuiltinExtensions:['mcp'],extensionFactories:[compatibility],
    systemPrompt:'You are testing an explicitly authorized newly created macOS app. Use only the computer tool against the supplied app and window. Inspect the real screenshot and accessible elements. Use the exact current lease/snapshot/element ids and screenshot coordinates; never invent targets. Each action returns a fresh state. Do not inspect or operate any other app, existing user document, terminal or system setting. Verify the receipt through the app before reporting completion.'});
  await resources.reload();
  const tool={...native.tool,execute:async(id,input,signal,onUpdate,ctx)=>{
    if(input.action==='list_apps'||input.appId&&input.appId!==native.fixtureInfo.bundleId||input.windowId&&input.windowId!==window.windowId)throw new Error('Only the new native test window is authorized');
    if(steps.length>=45)throw new Error('Native action limit reached');
    const started=Date.now(),result=await native.tool.execute(id,input,signal,onUpdate,{...ctx,...native.ctx,model:modelRuntime.model});
    const text=result.content?.filter(block=>block.type==='text').map(block=>block.text).join('\n')||'';
    steps.push({input,elapsedMs:Date.now()-started,text,error:result.details?.error});
    console.log(JSON.stringify({action:input.action,step:steps.length,error:result.details?.error||null}));
    const image=result.content?.find(block=>block.type==='image');if(image)fs.writeFileSync(path.join(native.root,`native-${steps.length}.png`),Buffer.from(image.data,'base64'));
    return result;
  }};
  const created=await createAgentSession({cwd:native.root,agentDir:modelRuntime.directory,model:modelRuntime.model,modelRegistry:modelRuntime.manager.modelRegistry,authStorage:modelRuntime.manager.authStorage,
    sessionManager:SessionManager.inMemory(native.root),settingsManager:settings,resourceLoader:resources,tools:[],customTools:[tool],thinkingLevel:'low'});
  session=created.session;unsubscribe=session.subscribe(event=>{if(event.type==='message_end'&&event.message?.role==='assistant')responses.push(event.message.content?.filter(block=>block.type==='text').map(block=>block.text).join('\n'));});
  timer=setTimeout(()=>session.abort().catch(()=>{}),600000);
  await session.prompt(`只操作新建测试应用 ${native.fixtureInfo.bundleId}，windowId ${window.windowId}。开始租约并观察窗口。姓名输入“林雨”；备注写两行“第一行原生模型测试”和“第二行原生模型测试”；颜色选绿色，勾选确认；双击列表里的一个条目；把“原生测试卡片”拖到“把测试卡片拖到这里”区域。然后点击“保存新建回执”，确认窗口报告已保存。请实际操作，不要只描述步骤。不要读取或操作其他应用。`);
  const file=path.join(native.root,'native-receipt.json');const receipt=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):null;
  const passed=receipt?.name==='林雨'&&receipt?.note==='第一行原生模型测试\n第二行原生模型测试'&&receipt.color==='绿色'&&receipt.confirmed===true&&receipt.doubleClicks>=1&&receipt.dragDone===true;
  fs.writeFileSync(path.join(native.root,'native-model-result.json'),JSON.stringify({passed,model:modelRuntime.model.id,requests,steps,receipt,responses},null,2));
  console.log(JSON.stringify({passed,root:native.root,requests,actions:steps.length,receipt}));if(!passed)process.exitCode=1;
}catch(error){const message=redactLogText(error.message);if(native)fs.writeFileSync(path.join(native.root,'native-model-result.json'),JSON.stringify({passed:false,error:message,requests,steps,responses},null,2));console.error(JSON.stringify({passed:false,error:message,root:native?.root}));process.exitCode=1;}
finally{clearTimeout(timer);unsubscribe?.();try{await session?.abort();session?.dispose();}catch{}await native?.close();modelRuntime?.close();}
