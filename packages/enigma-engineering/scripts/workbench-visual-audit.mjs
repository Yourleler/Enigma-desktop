import { homedir as userHomeDirectory } from 'node:os';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { Workbench } from '../dist/src/workbench.js';
import { validationBuild } from './validation-evidence.mjs';
const source=JSON.parse(await readFile(process.argv[2]??userHomeDirectory() + '/Documents/Codex/2026-10-25/enigma-next-validation/workbench-0.4-release-live/report.json','utf8'));assert.equal(source.status,'verified');
const output=resolve(process.argv[3]??userHomeDirectory() + '/Documents/Codex/2026-10-25/enigma-next-validation/workbench-0.4-visual');await mkdir(output,{recursive:true});
const host=await Workbench.open(source.workspace,{agentDir:join(source.workspace,'.enigma-next/pi-agent'),approval:'ask',memory:true}),endpoint=await host.listen(),browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
const groups={project:'项目总览',plan:'目标与计划',reading:'代码阅读',materials:'项目资料',skills:'技能与配方',collaboration:'多仓库协作',timeline:'时光机',memory:'项目记忆',observer:'运行观察',environment:'环境与验证',review:'代码审查',handoff:'交接与复现',artifacts:'产物'};
const actions=[],screenshots=[],layouts=[];let report;
const api=async(path)=>fetch(endpoint.origin+'/api'+path,{headers:{Authorization:'Bearer '+host.token}}).then(r=>r.json());
const settled=()=>page.waitForFunction(()=>document.getAnimations().filter(a=>Number.isFinite(a.effect.getComputedTiming().endTime)).every(a=>a.playState==='finished'));
const shot=async name=>{await settled();const path=join(output,name+'.png');await page.screenshot({path,fullPage:true});screenshots.push(path);};
const open=async group=>{await page.locator('#tools-launcher').click();await page.locator('#tools-search').fill(groups[group]);await page.locator('.capability').filter({has:page.locator('strong').filter({hasText:groups[group]})}).click();await page.locator('#panel-actions .action-grid').waitFor({state:'attached'});assert.equal(await page.locator('#panel').getByText('读取失败',{exact:true}).count(),0);};
try{
 await page.goto(endpoint.url);await page.getByRole('heading',{name:source.chat.title,exact:true}).waitFor();await page.waitForFunction(()=>!document.getElementById('send').disabled);
 const bootstrap=await api('/bootstrap');
 for(const group of Object.keys(groups)){
  await open(group);
  for(const action of bootstrap.actions.filter(a=>a.group===group)){
   if(await page.locator('#panel-actions').getAttribute('open')===null)await page.locator('#panel-actions > summary').click();
   await page.locator('#panel-actions .action-grid').getByRole('button',{name:new RegExp('^'+action.title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))}).click();await page.locator('#action-title').getByText(action.title,{exact:true}).waitFor();
   assert.equal(await page.locator('#action-error').innerText(),'');assert.equal(await page.locator('#action-fields').count(),1);assert.equal(await page.locator('#action-submit').isVisible(),true);actions.push(action.id);
   if(action.id==='recipe-save'){
    const row=page.locator('#action-fields [data-field-wrap="steps"] .nested-fields').first();
    assert.equal(await row.getByLabel('步骤类型',{exact:true}).inputValue(),'verify');
    assert.equal(await row.getByLabel('命令与参数',{exact:true}).isVisible(),false);
    await row.getByLabel('步骤类型',{exact:true}).selectOption('command');
    assert.equal(await row.getByLabel('命令与参数',{exact:true}).isVisible(),true);
    assert.equal(await row.getByLabel('服务',{exact:true}).isVisible(),false);
    await shot('form-recipe-command');await row.getByLabel('步骤类型',{exact:true}).selectOption('verify');
   }
   if(['recipe-save','delegate-start','plan-create','browser-add','wait-start'].includes(action.id))await shot('form-'+action.id);
   await page.locator('#action-close').click();
  }
  if(['project','plan','skills','reading'].includes(group))await shot('panel-'+group);await page.locator('#panel-close').click();
 }
 assert.equal(actions.length,bootstrap.actions.length);assert.equal(new Set(actions).size,actions.length);
 await shot('conversation-light');await page.locator('#model-picker').click();await shot('model-library');await page.locator('#model-close').click();
 await page.locator('#tools-launcher').click();await page.locator('#tools-search').fill('');await shot('toolbox');await page.locator('#tools-close').click();
 await page.locator('#settings-open').click();await page.getByLabel('界面主题').selectOption('dark');await page.getByRole('button',{name:'保存设置'}).click();await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark'&&document.getAnimations().filter(a=>Number.isFinite(a.effect.getComputedTiming().endTime)).every(a=>a.playState==='finished'));await shot('conversation-dark');
 await page.locator('#settings-open').click();await page.getByLabel('界面主题').selectOption('light');await page.getByLabel('液态玻璃').uncheck().catch(()=>page.locator('#appearance-glass').uncheck());await page.getByRole('button',{name:'保存设置'}).click();await page.waitForFunction(()=>document.documentElement.dataset.glass==='off');await shot('glass-disabled');
 for(const width of [1440,1060,800,615,390]){await page.setViewportSize({width,height:width<700?724:1000});await page.locator('#panel-toggle').click();await page.locator('#panel-actions .action-grid').waitFor({state:'attached'});await settled();const measured=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,composer:document.getElementById('composer').getBoundingClientRect().toJSON(),panel:document.getElementById('inspector').getBoundingClientRect().toJSON(),button:document.getElementById('send').getBoundingClientRect().toJSON()}));assert(measured.scrollWidth<=measured.width,JSON.stringify(measured));assert(measured.composer.left>=0&&measured.composer.right<=width);assert(measured.button.right<=width);layouts.push(measured);if(width===615||width===390)await shot('narrow-'+width);await page.locator('#panel-close').click();await settled();}
 assert.deepEqual(errors,[]);report={status:'verified',build:await validationBuild(['workbench-visual-audit.mjs']),workspace:source.workspace,actionsChecked:actions,panels:Object.keys(groups),models:bootstrap.models.length,screenshots,layouts,errors,note:'Actual current UI form construction, loaded panel boundaries, themes and responsive geometry. This does not claim every submitted operation outcome; those are verified separately by functional tests and real model workflows.'};
}catch(error){report={status:'failed',error:String(error),actions,screenshots,layouts,errors};process.exitCode=1;}
finally{await browser.close();await host.close();await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,report:join(output,'report.json')}));}
