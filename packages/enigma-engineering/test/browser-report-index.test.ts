import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fixture} from './fixtures.js';
import {BrowserValidation} from '../src/browser-validation.js';
import {hash,writeJson} from '../src/storage.js';
test('browser report history retains original labels and isolates a corrupt report without launching a browser',async()=>{
 const {root,workspace}=await fixture(),browser=new BrowserValidation(workspace);
 try{
  const scenario={id:'form',label:'原场景',service:'web',steps:[{action:'click' as const,selector:'#go'}]};await browser.add(scenario);
  const dir=join(workspace.data,'browser-runs','browser-one');await mkdir(dir,{recursive:true});await writeJson(join(dir,'report.json'),{schema:1,id:'browser-one',scenario:'form',scenarioLabel:'原场景',configuration:hash(JSON.stringify(scenario)),serviceRun:'old-run',status:'passed',steps:[],errors:[],screenshots:[],createdAt:new Date().toISOString(),sourceCurrent:true,observation:await workspace.observe()});
  await browser.add({...scenario,label:'后来改名'});await mkdir(join(workspace.data,'browser-runs','broken'));await writeFile(join(workspace.data,'browser-runs','broken','report.json'),'invalid');
  const list=await browser.reports([]);assert.equal(list.items.length,1);assert.equal(list.unavailable,1);assert.equal(list.items[0]?.scenarioLabel,'原场景');assert.equal(list.items[0]?.configurationCurrent,false);assert.equal(list.items[0]?.serviceCurrent,false);assert.equal(list.items[0]?.serviceReady,false);
 }finally{await rm(root,{recursive:true,force:true});}
});
