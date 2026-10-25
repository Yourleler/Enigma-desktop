import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { Workbench } from '../dist/src/workbench.js';
import { validationBuild } from './validation-evidence.mjs';

const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
const output = resolve(process.argv[3]); await mkdir(output, { recursive:true });
const host = await Workbench.open(input.workspace, {agentDir:join(input.workspace,'.enigma-next/pi-agent'),memory:true});
const endpoint = await host.listen(), browser = await chromium.launch();
const context = await browser.newContext({viewport:{width:1440,height:1000},recordVideo:{dir:output,size:{width:1440,height:1000}}});
const page = await context.newPage(), errors = [], samples = [];
page.on('pageerror', error => errors.push(error.message));
let report;
const settled = () => page.waitForFunction(() => document.getAnimations().filter(a=>Number.isFinite(a.effect.getComputedTiming().endTime)).every(a=>a.playState==='finished'));
const shot = async name => {await settled(); await page.screenshot({path:join(output,name+'.png')});};
try {
  await page.goto(endpoint.url); await page.getByRole('heading',{name:input.chat.title,exact:true}).waitFor();
  assert.equal(await page.locator('#run-shelf').getAttribute('open'),null);
  assert.equal(await page.locator('.task-nav [data-panel=timeline]').isVisible(),true);
  assert.equal(await page.locator('.workspace-nav [data-panel=artifacts]').isVisible(),true);
  assert.equal(await page.locator('#approval-picker').inputValue(),'ask');
  await Promise.all([page.waitForResponse(r=>r.url().endsWith('/settings')),page.locator('#approval-picker').selectOption('auto')]);
  await page.waitForFunction(()=>document.getElementById('run-status').textContent.includes('自动操作'));
  await page.reload(); await page.getByRole('heading',{name:input.chat.title,exact:true}).waitFor();
  assert.equal(await page.locator('#approval-picker').inputValue(),'auto');
  await Promise.all([page.waitForResponse(r=>r.url().endsWith('/settings')),page.locator('#approval-picker').selectOption('ask')]);
  const saveAppearance = async (theme,glass,motion) => {
    await page.locator('#settings-open').click(); await page.getByLabel('界面主题').selectOption(theme);
    await page.locator('#appearance-glass').setChecked(glass); await page.locator('#appearance-motion').setChecked(motion);
    await page.getByRole('button',{name:'保存设置'}).click(); await settled();
  };
  await saveAppearance('light',true,true); await shot('light');
  const glass = await page.locator('#composer').evaluate(e=>({background:getComputedStyle(e).backgroundImage,blur:getComputedStyle(e).backdropFilter,shadow:getComputedStyle(e).boxShadow}));
  assert(glass.background.includes('radial-gradient') && glass.blur.includes('blur(34px)') && glass.shadow.includes('inset'));
  await page.mouse.move(820,900); await page.waitForFunction(()=>document.getElementById('composer').style.getPropertyValue('--shine-x')!=='');
  const before = await page.locator('#inspector').evaluate(e=>e.getBoundingClientRect().width);
  await page.locator('.workspace-nav [data-panel=reading]').click();
  const moving = await page.evaluate(()=>({width:document.getElementById('inspector').getBoundingClientRect().width,animations:document.getAnimations().map(a=>({name:a.animationName||a.transitionProperty,state:a.playState}))}));
  await page.locator('#panel-actions .action-grid').waitFor({state:'attached'}); await settled();
  const after = await page.locator('#inspector').evaluate(e=>e.getBoundingClientRect().width);
  assert(after>before+200); assert(moving.animations.some(a=>a.state==='running'));
  samples.push({before,moving,after,glass}); await shot('reading');
  await page.locator('#panel-close').click(); await settled();
  assert.equal(await page.locator('#inspector').evaluate(e=>e.inert),true);
  await page.locator('#composer-tools').click();
  assert.equal(await page.locator('.capability').count(),2);
  assert.equal(await page.locator('#tools-title').innerText(),'添加到当前任务'); await shot('context-menu');
  await page.locator('#tools-all').click(); assert.equal(await page.locator('.capability').count(),13); await shot('all-tools');
  await page.locator('#tools-close').click(); await saveAppearance('dark',true,true); await shot('dark');
  assert((await page.locator('#composer').evaluate(e=>getComputedStyle(e).backgroundImage)).includes('radial-gradient'));
  for(const width of [1180,1060,800,615,390]) {
    await page.setViewportSize({width,height:width<700?760:1000});
    await page.locator('.task-nav [data-panel=observer]').click(); await page.locator('#panel-actions .action-grid').waitFor({state:'attached'}); await settled();
    assert.equal(await page.locator('#drawer-scrim').isVisible(),true);
    const dimensions = await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,composer:document.getElementById('composer').getBoundingClientRect().toJSON(),inspector:document.getElementById('inspector').getBoundingClientRect().toJSON()}));
    assert(dimensions.scroll<=width,JSON.stringify(dimensions)); assert(dimensions.inspector.right<=width);
    samples.push(dimensions); if(width===390)await shot('narrow');
    await page.locator('#panel-close').click(); await settled();
    const controls = await page.evaluate(()=>Object.fromEntries(['composer','send','approval-picker','model-picker','thinking-picker'].map(id=>[id,document.getElementById(id).getBoundingClientRect().toJSON()])));
    assert(controls.send.right<=width && controls['approval-picker'].right<=controls['model-picker'].left && controls['model-picker'].right<=controls['thinking-picker'].left,JSON.stringify(controls));
  }
  await page.setViewportSize({width:1440,height:1000}); await saveAppearance('light',true,false);
  assert.equal(await page.locator('.ambient-one').evaluate(e=>getComputedStyle(e).animationName),'none');
  await page.reload(); await page.getByRole('heading',{name:input.chat.title,exact:true}).waitFor();
  assert.equal(await page.locator('html').getAttribute('data-motion'),'off');
  await saveAppearance('light',true,true); await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.ambient-one').evaluate(e=>getComputedStyle(e).animationName),'none');
  await page.locator('#tools-launcher').click(); assert.equal(await page.locator('#tools-dialog').evaluate(e=>getComputedStyle(e).animationName),'none'); await page.locator('#tools-close').click();
  await page.emulateMedia({reducedMotion:'no-preference'}); await saveAppearance('light',false,true); await shot('solid-fallback');
  assert.equal(await page.locator('#composer').evaluate(e=>getComputedStyle(e).backdropFilter),'none');
  assert.deepEqual(errors,[]);
  report={status:'verified',build:await validationBuild(['workbench-polish-audit.mjs']),samples,errors,note:'Actual layout routing, contextual input tools, recorded panel/modal transitions, glass CSS and pointer reflection, persistent animation toggle, reduced motion and solid fallback. No new agent request or external mutation.'};
} catch(error) { report={status:'failed',error:String(error),errors,samples};process.exitCode=1; }
finally { await context.close(); const video=await page.video().path(); await browser.close(); await host.close(); report.video=video; await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,report:join(output,'report.json')})); }
