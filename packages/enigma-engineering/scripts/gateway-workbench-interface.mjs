import { homedir as userHomeDirectory } from 'node:os';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { fixture } from '../dist/test/fixtures.js';
import { Workbench } from '../dist/src/workbench.js';
import { configureGateway } from '../dist/src/model-config.js';
import { hash, redact } from '../dist/src/storage.js';
import { validationBuild } from './validation-evidence.mjs';

const output=resolve(process.argv[2]??userHomeDirectory() + '/Documents/Codex/2026-10-25/enigma-next-validation/complete-interface-live');await mkdir(output,{recursive:true});
const {root,workspace}=await fixture(),agentDir=await configureGateway(workspace.data);
await workspace.exclusive(()=>workspace.addCheck({id:'original-joint',repo:'app',joint:true,argv:[process.execPath,'--input-type=module','-e','import {main}from"./index.js";if(main()!=="v1")process.exit(2);console.log("app:v1");']}));
const protectedSources=Object.fromEntries(await Promise.all(['library','sdk','app'].map(async repo=>[repo,hash(await readFile(join(root,repo,'index.js')))])));
const host=await Workbench.open(root,{agentDir,memory:true,approval:'ask'}),endpoint=await host.listen(),browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],dialogs=[],tools=[];
page.on('pageerror',e=>errors.push(e.message));let report;
const request=async(path,body)=>{const r=await fetch(endpoint.origin+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+host.token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();assert(r.ok,JSON.stringify(d));return d;};
try{
 await page.goto(endpoint.url);await page.getByRole('button',{name:'＋ 新对话'}).click();await page.locator('#new-title').fill('多模型与项目工具实测');await page.getByRole('button',{name:'创建对话'}).click();await page.getByRole('heading',{name:'多模型与项目工具实测',exact:true}).waitFor();
 const chat=(await request('/bootstrap')).chats[0],controller=await host.conversation(chat.id);controller.runtime.session.subscribe(e=>{if(e.type==='tool_execution_end'){tools.push({name:e.toolName,error:e.isError});process.stderr.write(e.toolName+': '+(e.isError?'failed':'completed')+'\n');}});
 const run=async(model,text)=>{
  await page.locator('#model-picker').click();await page.getByRole('textbox',{name:'搜索模型'}).fill(model);await page.locator('.model-row').filter({has:page.getByText(model+' · gateway-catalog',{exact:true})}).click();await page.waitForFunction(id=>document.getElementById('model-dialog')?.open===false,model);
  assert.equal(controller.runtime.session.model.id,model);await page.getByRole('textbox',{name:'任务消息'}).fill(text);await page.getByRole('button',{name:'发送',exact:true}).click();
  const deadline=Date.now()+150000;let busy=false;
  while(Date.now()<deadline){if(await page.locator('#approval-root [role=dialog]').count()){dialogs.push(await page.locator('#approval-root h2').innerText());await page.getByRole('button',{name:'批准',exact:true}).click();}
   const state=controller.snapshot();busy||=!state.idle;if(busy&&state.idle&&state.messages.some(m=>m.role==='assistant'&&m.text.includes('v1')))break;await page.waitForTimeout(100);}
  assert(controller.snapshot().idle);assert(controller.runtime.session.getLastAssistantText());assert.equal(controller.runtime.session.state.messages.findLast(m=>m.role==='assistant')?.stopReason,'stop');
 };
 await run('claude-gpt-6-1-sol','只读当前三个仓库。使用 code_trace / repo_read 理解 greet、call、main 的真实链路，说明每个仓库的职责和现在的 v1 行为，再 workspace_verify 原检查。不修改源码、配置或检查标准。');
 await run('claude-deepseek-v4-1-flash','同一任务已经有来源背景。请回读三个仓库的 index.js，使用 repo_read，简短说明 app 为什么得到 v1，并运行 workspace_verify 原联合检查。保持所有文件和标准。');
 assert(dialogs.length>0);assert(tools.some(t=>t.name==='repo_read'&&!t.error));assert(tools.some(t=>t.name==='workspace_verify'&&!t.error));
 // Actual UI material form and task plan; no fake result injection.
 await page.locator('#tools-launcher').click();await page.getByRole('textbox',{name:'搜索功能'}).fill('资料');await page.locator('.capability').filter({hasText:'项目资料'}).click();await page.locator('#panel-actions > summary').click();await page.locator('#panel-actions').getByText('添加项目笔记',{exact:true}).click();await page.getByLabel('名称',{exact:true}).fill('接口阅读说明');await page.getByLabel('正文',{exact:true}).fill('library.greet → sdk.call → app.main。当前结果为 v1；迁移前先验证消费者。');await page.locator('#action-submit').click();await page.locator('#panel').getByRole('heading',{name:'接口阅读说明',exact:true}).waitFor();
 const materials=await request('/chats/'+chat.id+'/materials');assert(materials.items.some(m=>m.title==='接口阅读说明'));
 await page.locator('#panel-close').click();await page.screenshot({path:join(output,'conversation-light.png'),fullPage:true});
 await page.locator('#model-picker').click();await page.getByRole('textbox',{name:'搜索模型'}).fill('');await page.screenshot({path:join(output,'models.png'),fullPage:true});await page.getByRole('button',{name:'关闭模型选择'}).click();
 await page.locator('#tools-launcher').click();await page.getByRole('textbox',{name:'搜索功能'}).fill('');await page.screenshot({path:join(output,'toolbox.png'),fullPage:true});await page.getByRole('button',{name:'关闭工具箱'}).click();
 await page.locator('#settings-open').click();await page.getByLabel('界面主题').selectOption('dark');await page.getByRole('button',{name:'保存设置'}).click();await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark'&&document.getAnimations().filter(a=>Number.isFinite(a.effect.getComputedTiming().endTime)).every(a=>a.playState==='finished'));await page.screenshot({path:join(output,'conversation-dark.png'),fullPage:true});
 await page.setViewportSize({width:615,height:724});await page.locator('#composer-tools').click();await page.getByRole('textbox',{name:'搜索功能'}).fill('计划');await page.locator('.capability').filter({hasText:'目标与计划'}).click();await page.locator('#panel-title').getByText('目标与计划').waitFor();await page.locator('#panel .card').first().waitFor();await page.screenshot({path:join(output,'narrow-panel.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.locator('#panel-close').click();await page.reload();await page.getByRole('heading',{name:'多模型与项目工具实测',exact:true}).waitFor();assert.equal(controller.chat.model,'claude-deepseek-v4-1-flash');
 const currentProtected=Object.fromEntries(await Promise.all(['library','sdk','app'].map(async repo=>[repo,hash(await readFile(join(root,repo,'index.js')))])));assert.deepEqual(currentProtected,protectedSources);
 const verification=await workspace.exclusive(()=>workspace.verify());assert.equal(verification.status,'verified');assert.deepEqual(errors,[]);
 report={status:'verified',build:await validationBuild(['gateway-workbench-interface.mjs']),workspace:root,models:['claude-gpt-6-1-sol','claude-deepseek-v4-1-flash'],modelCount:(await request('/bootstrap')).models.length,dialogs,tools,errors,verification,protectedSources,currentProtected,materials,chat:controller.chat,screenshots:['conversation-light.png','conversation-dark.png','models.png','toolbox.png','narrow-panel.png'].map(name=>join(output,name)),scope:'Actual two-model browser requests, original read-only multi-repository checks, live approvals and UI form, catalogue/appearance/narrow panel/reconnect; not universal model coverage'};
}catch(error){report={status:'failed',error:String(error),workspace:root,errors,dialogs,tools,states:[...host.sessions.values()].map(s=>s.snapshot())};process.exitCode=1;}
finally{await browser.close();await host.close();await writeFile(join(output,'report.json'),redact(JSON.stringify(report,null,2),workspace.secrets));console.log(JSON.stringify({status:report.status,report:join(output,'report.json')}));}
