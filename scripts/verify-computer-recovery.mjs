import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {PluginManager} from '../core/plugin-manager.ts';
import {EventBus} from '../hub/event-bus.ts';
import {createComputerUseTool} from '../lib/tools/computer-use-tool.ts';
import {createComputerLabRuntime} from './interaction-computer-runtime.mjs';

const native=await createComputerLabRuntime({parent:process.argv[2],fixture:process.argv[3],helper:process.argv[4]});
const builtin=path.join(native.root,'plugins-builtin'),community=path.join(native.root,'plugins-community');
fs.mkdirSync(builtin);fs.mkdirSync(community);
for(const name of ['browser-control','computer-control'])fs.cpSync(path.join('plugins',name),path.join(builtin,name),{recursive:true});
let disabled=[];
const manager=new PluginManager({pluginsDirs:[builtin,community],dataDir:path.join(native.root,'plugin-data'),bus:new EventBus(),appVersion:'0.452.72',preferencesManager:{getDisabledPlugins:()=>disabled,setDisabledPlugins:next=>{disabled=next;},getAllowFullAccessPlugins:()=>true}});
const cases=[];
const pending=[];
try {
  manager.scan();await manager.loadAll();
  const contribution=manager.getNativeToolContribution('computer');assert(contribution);
  const tool=manager.createNativeTool(contribution,[{getComputerHost:()=>native.host,getSessionAccessMode:()=> 'operate'}],{createComputerUseTool});
  const execute=(action)=>{const work=tool.execute('recovery-'+cases.length,action,undefined,undefined,native.ctx);pending.push(work);return work;};
  const windows=await native.host.listWindows(native.ctx,native.fixtureInfo.bundleId);
  const target=windows.find(window=>window.isOnScreen&&window.bounds?.height>500);assert(target);
  let result=await execute({action:'start',appId:native.fixtureInfo.bundleId,windowId:target.windowId});assert(!result.details?.error);
  result=await execute({action:'get_app_state'});assert(!result.details?.error);
  const first=result.details.snapshotId,display=result.details.display;
  const scrollRegion=result.details.elements.find(element=>element.role==='AXScrollArea'&&element.label.includes('新建测试条目'));
  assert(scrollRegion);
  for(const block of result.content)if(block.type==='image')fs.writeFileSync(path.join(native.root,'recovery-before.png'),Buffer.from(block.data,'base64'));
  await execute({action:'get_app_state'});
  const stale=await execute({action:'click_point',snapshotId:first,x:100,y:100});assert.equal(stale.details.errorCode,'STALE_SNAPSHOT');
  cases.push({case:'stale-state-rejected',passed:true});
  result=await execute({action:'scroll',elementId:scrollRegion.elementId,direction:'down',amount:2});assert(!result.details?.error);
  result=await execute({action:'get_app_state'});assert(!result.details?.error);
  const scrolled=result.details.elements.find(element=>element.role==='AXScrollArea'&&element.label.includes('新建测试条目'));
  assert(scrolled&&scrolled.label!==scrollRegion.label,'Native table must reveal different rows');
  cases.push({case:'native-scrollbar-page-fallback',before:scrollRegion.label,after:scrolled.label});
  const field=result.details.elements.find(element=>element.role==='AXTextField'&&element.label.includes('原生姓名输入'));assert(field);
  result=await execute({action:'type_text',elementId:field.elementId,text:'快捷键验证'});assert(result.content.some(block=>block.type==='text'&&block.text.includes('快捷键验证')));
  result=await execute({action:'press_key',elementId:field.elementId,key:'Cmd+a'});assert(!result.details?.error);
  result=await execute({action:'press_key',elementId:field.elementId,key:'Backspace'});assert(!result.details?.error);
  result=await execute({action:'get_app_state'});
  const save=result.details.elements.find(element=>element.label==='保存新建回执');assert(save);
  result=await execute({action:'click_element',elementId:save.elementId});assert(!result.details?.error);
  assert.equal(JSON.parse(fs.readFileSync(path.join(native.root,'native-receipt.json'))).name,'');
  cases.push({case:'targeted-select-all-and-delete',passed:true});
  const started=Date.now();
  // Coordinates are taken from the dedicated fixture's screenshot, scaled to
  // its current image size. They address only its purple source/drop regions.
  let settled=false;
  const running=execute({action:'drag',foreground:true,fromX:display.width*600/1286,fromY:display.height*1004/1568,toX:display.width*620/1286,toY:display.height*1143/1568,durationMs:2000}).finally(()=>{settled=true;});
  await new Promise(resolve=>setTimeout(resolve,800));
  const events=fs.readFileSync(path.join(native.root,'native-events.jsonl'),'utf8');
  assert(events.includes('card-down'),'The real native mouse-down must happen before disabling');
  assert(!settled,'Native gesture ended before disabling; this is not a mid-action test');
  await manager.disablePlugin('computer-control',{source:'builtin'});
  result=await running;
  fs.writeFileSync(path.join(native.root,'cancel-result.json'),JSON.stringify(result,null,2));
  assert(['COMPUTER_OPERATION_CANCELLED','INTERACTION_PLUGIN_DISABLED'].includes(result.details?.errorCode));assert(Date.now()-started<5000);
  const down=execFileSync('swift',['-e','import CoreGraphics; print(CGEventSource.buttonState(.combinedSessionState, button: .left))'],{encoding:'utf8'}).trim();
  assert.equal(down,'false');
  cases.push({case:'disable-during-native-drag',elapsedMs:Date.now()-started,errorCode:result.details.errorCode,mouseReleased:true});
  const blocked=await execute({action:'get_app_state'});assert.equal(blocked.details.errorCode,'INTERACTION_PLUGIN_DISABLED');
  assert.equal(manager.getPlugin('browser-control',{source:'builtin'}).status,'loaded');
  cases.push({case:'old-tool-rejected-and-browser-unaffected',passed:true});
  await manager.enablePlugin('computer-control',{source:'builtin'});
  result=await execute({action:'get_app_state'});assert(!result.details?.error);
  cases.push({case:'reenable-observes-same-window',passed:true});
  const eventCount=fs.readFileSync(path.join(native.root,'native-events.jsonl'),'utf8').split('card-down').length;
  const crashed=execute({action:'drag',foreground:true,fromX:display.width*600/1286,fromY:display.height*1004/1568,toX:display.width*620/1286,toY:display.height*1143/1568,durationMs:2000});
  await new Promise(resolve=>setTimeout(resolve,800));
  assert(fs.readFileSync(path.join(native.root,'native-events.jsonl'),'utf8').split('card-down').length>eventCount);
  assert.equal(native.foregroundChildren.size,1);
  for(const process of native.foregroundChildren)process.kill('SIGKILL');
  result=await crashed;assert.equal(result.details?.errorCode,'PROVIDER_CRASHED');
  assert.equal(execFileSync('swift',['-e','import CoreGraphics; print(CGEventSource.buttonState(.combinedSessionState, button: .left))'],{encoding:'utf8'}).trim(),'false');
  cases.push({case:'killed-helper-owned-input-released',passed:true});
  result=await execute({action:'get_app_state'});assert(!result.details?.error);
  const gesture=()=>execute({action:'drag',foreground:true,fromX:display.width*600/1286,fromY:display.height*1004/1568,toX:display.width*620/1286,toY:display.height*1143/1568,durationMs:2000});
  const ownWindow=`import AppKit; import CoreGraphics; guard NSWorkspace.shared.frontmostApplication?.processIdentifier == ${native.child.pid} else { exit(2) }; `;
  for(const mode of ['escape','pointer']) {
    const before=fs.readFileSync(path.join(native.root,'native-events.jsonl'),'utf8').split('card-down').length;
    const action=gesture();await new Promise(resolve=>setTimeout(resolve,800));
    assert(fs.readFileSync(path.join(native.root,'native-events.jsonl'),'utf8').split('card-down').length>before);
    const input=mode==='escape'
      ? 'let s=CGEventSource(stateID:.hidSystemState);CGEvent(keyboardEventSource:s,virtualKey:53,keyDown:true)?.post(tap:.cghidEventTap);usleep(200000);CGEvent(keyboardEventSource:s,virtualKey:53,keyDown:false)?.post(tap:.cghidEventTap)'
      : `CGEvent(mouseEventSource:CGEventSource(stateID:.hidSystemState),mouseType:.mouseMoved,mouseCursorPosition:CGPoint(x:${target.bounds.x+target.bounds.width*.7},y:${target.bounds.y+target.bounds.height*.2}),mouseButton:.left)?.post(tap:.cghidEventTap)`;
    execFileSync('swift',['-e',ownWindow+input]);
    result=await action;assert.equal(result.details?.errorCode,'COMPUTER_OPERATION_CANCELLED');
    assert.equal(execFileSync('swift',['-e','import CoreGraphics;print(CGEventSource.buttonState(.combinedSessionState,button:.left))'],{encoding:'utf8'}).trim(),'false');
    cases.push({case:mode==='escape'?'independent-native-escape-stops-input':'independent-pointer-takeover-stops-input',passed:true});
    result=await execute({action:'get_app_state'});assert(!result.details?.error);
  }
  await new Promise(resolve=>{native.child.once('exit',resolve);native.child.kill('SIGTERM');});
  result=await execute({action:'get_app_state'});assert.equal(result.details?.errorCode,'TARGET_NOT_FOUND');
  cases.push({case:'closed-window-does-not-fall-back',errorCode:result.details.errorCode});
  fs.writeFileSync(path.join(native.root,'computer-recovery.json'),JSON.stringify({passed:true,cases},null,2));
  console.log(JSON.stringify({passed:true,root:native.root,cases}));
}catch(error){fs.writeFileSync(path.join(native.root,'computer-recovery.json'),JSON.stringify({passed:false,error:error.message,cases},null,2));console.error(JSON.stringify({passed:false,root:native.root,error:error.message}));process.exitCode=1;}
finally{for(const plugin of manager.listPlugins())await manager.unloadPlugin(plugin.id,{pluginKey:plugin.pluginKey});await Promise.allSettled(pending);await native.close();}
