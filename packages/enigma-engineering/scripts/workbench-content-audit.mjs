import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { fauxProvider } from '@earendil-works/pi-ai';
import { fixture } from '../dist/test/fixtures.js';
import { Workbench } from '../dist/src/workbench.js';
import { ProjectContext } from '../dist/src/project-context.js';
import { validationBuild } from './validation-evidence.mjs';

const output=resolve(process.argv[2]);await mkdir(output,{recursive:true});
const {root,workspace}=await fixture(),agentDir=join(root,'agent'),runtime=await ModelRuntime.create({authPath:join(agentDir,'auth.json'),modelsPath:null,refreshOnCreate:false}),faux=fauxProvider();runtime.registerNativeProvider(faux.provider);
const host=await Workbench.open(root,{agentDir,modelRuntime:runtime,provider:faux.getModel().provider,model:faux.getModel().id}),chat=await host.create('多仓库改造 · 界面验证');
const controller=await host.conversation(chat.id),task=controller.chat.session;
await new ProjectContext(workspace).add({title:'接口改造说明',task,source:{kind:'note',author:'user'},content:'# 跨仓库接口改造\n先读懂入口与消费者，再讨论变更方案。\n\n## 当前调用链\n`library.greet → sdk.call → app.main`\n\n| 仓库 | 职责 |\n|---|---|\n| library | 提供 greet 实现，返回 v1 |\n| sdk | 调用基础实现并返回结果 |\n| app | 消费 SDK，提供程序入口 |\n\n## 改造前的准备\n- 核对各仓库分支与用户已有修改。\n- 保留原检查，确认消费者影响。\n- 先记录检查点，再比较独立方案。\n\n## 验证与交付\n计划、源码位置和验收结果分别保留来源。阅读事实不替代实际测试。\n\n这份资料是本次界面验证的设计示例，尚未派发改造任务。'});
const endpoint=await host.listen(),browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[],screenshots=[];page.on('pageerror',e=>errors.push(e.message));
const settled=()=>page.waitForFunction(()=>document.getAnimations().filter(a=>Number.isFinite(a.effect.getComputedTiming().endTime)).every(a=>a.playState==='finished'));
const shot=async name=>{await settled();const path=join(output,name+'.png');await page.screenshot({path});screenshots.push(path);};let report;
try {
 await page.goto(endpoint.url);await page.getByRole('heading',{name:chat.title,exact:true}).waitFor();
 for(const group of ['plan','review']){await page.locator('.work-toolbar [data-panel='+group+']').click();await page.locator('#panel-actions .action-grid').waitFor({state:'attached'});}
 await page.locator('.workspace-nav [data-panel=reading]').click();await page.getByRole('button',{name:'浏览仓库文件',exact:true}).click();await page.locator('.file-tree').getByRole('button',{name:'index.js',exact:true}).click();await page.locator('.source-preview').waitFor();
 await page.locator('.workspace-nav [data-panel=materials]').click();await page.getByRole('button',{name:'阅读',exact:true}).click();await page.locator('.document-body').waitFor();
 await page.locator('#panel-expand').click();await settled();assert((await page.locator('#inspector').boundingBox()).width>600);
 await shot('document-light');
 await page.locator('#settings-open').click();await page.getByLabel('界面主题').selectOption('dark');await page.getByRole('button',{name:'保存设置'}).click();await shot('document-dark');
 await page.locator('#content-tabs').getByRole('tab',{name:'index.js',exact:true}).click();await page.locator('.source-preview').waitFor();await shot('source-dark');
 await page.locator('#content-tabs').getByRole('tab',{name:'接口改造说明',exact:true}).click();await page.locator('.document-body').waitFor();await page.locator('#panel-close').click();
 await page.reload();await page.getByRole('heading',{name:chat.title,exact:true}).waitFor();await page.locator('#panel-toggle').click();await page.locator('.document-body').waitFor();
 assert.equal(await page.locator('#content-tabs [role=tab]').count(),7);assert.equal(await page.locator('#panel-actions').getAttribute('open'),null);
 for(const width of [1440,1060,615,390]){await page.setViewportSize({width,height:760});await settled();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(width===390)await shot('document-narrow');}
 assert.deepEqual(errors,[]);report={status:'verified',build:await validationBuild(['workbench-content-audit.mjs']),workspace:root,screenshots,errors,note:'Independent fixture: actual three-repository file/source and project document reading, retained content tabs, expandable area, reconnect, themes and narrow widths. This is UI/source verification, not a model coding benchmark.'};
}catch(error){report={status:'failed',error:String(error),screenshots,errors};process.exitCode=1;}
finally{await browser.close();await host.close();await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,report:join(output,'report.json')}));}
