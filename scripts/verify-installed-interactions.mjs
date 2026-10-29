import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {prepareEnigmaProfile} from './enigma-profile.mjs';

const app = path.resolve(process.argv[2] || '');
const parent = path.resolve(process.argv[3] || '');
if (!app.endsWith('.app') || !fs.existsSync(path.join(app, 'Contents/MacOS/Enigma'))) throw new Error('A built Enigma Mac app is required');
const root = fs.mkdtempSync(path.join(parent, 'installed-plugin-check-'));
// The legacy desktop userData namespace uses HANA_HOME's basename. Keep this
// unique too, so two different test roots cannot share a renderer cache/lock.
const profile = path.join(root, path.basename(root) + '-profile');
await prepareEnigmaProfile({dataRoot:profile, workspace:path.join(root,'new-files')});
fs.mkdirSync(path.join(profile,'user'), {recursive:true});
fs.writeFileSync(path.join(profile,'user/preferences.json'), JSON.stringify({setupComplete:true}), {mode:0o600});
let child, info, log;
const stages = [];
async function stop() {
  if (child && child.exitCode === null && child.signalCode === null) {
    await new Promise(resolve => {
      const timer=setTimeout(()=>child.kill('SIGKILL'),5000);
      child.once('exit',()=>{clearTimeout(timer);resolve();});
      child.kill('SIGTERM');
    });
  }
  if (log !== undefined) {fs.closeSync(log);log=undefined;}
}
async function start(stage) {
  log=fs.openSync(path.join(root,stage+'.log'),'w');
  child=spawn(path.join(app,'Contents/MacOS/Enigma'),[],{env:{...process.env,HANA_HOME:profile,ENIGMA_DESKTOP_DATA:profile,ENIGMA_DESKTOP_PRODUCT:'1'},stdio:['ignore',log,log]});
  for(let i=0;i<400;i++) {
    if(child.exitCode!==null)throw new Error('Candidate app exited before startup');
    try {
      const value=JSON.parse(fs.readFileSync(path.join(profile,'server-info.json')));
      if(value.ownerPid===child.pid) {
        const response=await fetch(`http://127.0.0.1:${value.port}/api/server/identity`,{headers:{Authorization:`Bearer ${value.token}`},signal:AbortSignal.timeout(1000)});
        if(response.ok){info=value;stages.push({stage,pid:child.pid,serverPid:value.pid,identity:await response.json()});return;}
      }
    } catch {}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Candidate startup timed out');
}
async function api(route, body) {
  const response=await fetch(`http://127.0.0.1:${info.port}/api${route}`,{method:body?'PUT':'GET',headers:{Authorization:`Bearer ${info.token}`,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});
  const data=await response.json();assert(response.ok,JSON.stringify(data));return data;
}
const controls = async () => (await api('/plugins')).filter(plugin=>['computer-control','browser-control'].includes(plugin.id));
const toggle = (id, enabled) => api(`/plugins/${id}/enabled`,{source:'builtin',enabled});
try {
  await start('first');
  const initial=await controls();assert.equal(initial.length,2);assert(initial.every(plugin=>plugin.status==='loaded'));
  assert((await api('/agents/enigma/config')).availableTools.includes('browser'));
  await toggle('browser-control',false);
  let state=await controls();assert.equal(state.find(p=>p.id==='browser-control').status,'disabled');assert.equal(state.find(p=>p.id==='computer-control').status,'loaded');
  assert(!(await api('/agents/enigma/config')).availableTools.includes('browser'));
  await stop();await start('restart');
  state=await controls();assert.equal(state.find(p=>p.id==='browser-control').status,'disabled');
  await toggle('browser-control',true);await toggle('computer-control',false);
  state=await controls();assert.equal(state.find(p=>p.id==='browser-control').status,'loaded');assert.equal(state.find(p=>p.id==='computer-control').status,'disabled');
  assert((await api('/agents/enigma/config')).availableTools.includes('browser'));
  await toggle('computer-control',true);
  stages.push({stage:'final',controls:await controls()});
  fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({passed:true,stages,scope:'Actual signed Mac package startup, plugin enable/disable and restart persistence through authenticated local API; native clicks and model tools are separate acceptance'},null,2));
  console.log(JSON.stringify({passed:true,root}));
} catch(error) {
  fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({passed:false,error:error.message,stages},null,2));
  console.error(JSON.stringify({passed:false,root,error:error.message}));process.exitCode=1;
} finally {await stop();}
