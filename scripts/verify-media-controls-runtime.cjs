const {app,BrowserWindow}=require('electron');const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.env.ENIGMA_PREVIEW_TEST_ROOT,profile=process.env.ENIGMA_PREVIEW_TEST_HOME;
if(!root||!profile)throw Error('Isolated test root required');app.setPath('userData',path.join(root,'browser-profile'));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1100,height:760,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});
 const e=expression=>win.webContents.executeJavaScript(expression,true),pause=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async code=>{for(let i=0;i<120;i++){const value=await e(code);if(value)return value;await pause(75)}throw Error('Condition timed out: '+code)};
 const clickButton=async label=>e(`[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent.trim()===${JSON.stringify(label)}).click()`);
 const open=async name=>{await until(`!![...document.querySelectorAll('[role=treeitem]')].find(r=>r.textContent.trim()===${JSON.stringify(name)})`);await e(`(()=>{const r=[...document.querySelectorAll('[role=treeitem]')].find(r=>r.textContent.trim()===${JSON.stringify(name)});r.click();r.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))})()`)};
 const range=async(label,value)=>e(`(()=>{const r=document.querySelector('input[aria-label="${label}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(r,${JSON.stringify(String(value))});r.dispatchEvent(new Event('input',{bubbles:true}));r.dispatchEvent(new Event('change',{bubbles:true}))})()`);
 const results=[];
 try{
  const info=JSON.parse(fs.readFileSync(path.join(profile,'server-info.json')));await win.loadURL(`http://127.0.0.1:${info.port}/desktop/#enigma-local-key=${encodeURIComponent(info.token)}`);
  await open('new.webm');await until("document.querySelector('video')?.readyState>=1 && !document.querySelector('button[aria-label=播放]')?.disabled");
  assert.equal(await e("document.querySelector('video').paused"),true);
  await clickButton('播放');await pause(200);assert.equal(await e("document.querySelector('video').paused"),false);assert(await e("document.querySelector('video').currentTime>0"));
  await clickButton('暂停');assert.equal(await e("document.querySelector('video').paused"),true);results.push('real play/pause');
  await range('播放进度',.7);await e("document.querySelector('input[aria-label=播放进度]').dispatchEvent(new PointerEvent('pointerup',{bubbles:true}))");await pause(60);assert(Math.abs(await e("document.querySelector('video').currentTime")-.7)<.12);results.push('seek slider');
  await clickButton('静音');assert.equal(await e("document.querySelector('video').muted"),true);await range('音量',.35);assert.equal(await e("document.querySelector('video').muted"),false);results.push('mute/volume');
  await e("(()=>{const s=document.querySelector('select[aria-label=播放速度]');s.value='1.5';s.dispatchEvent(new Event('change',{bubbles:true}))})()");assert.equal(await e("document.querySelector('video').playbackRate"),1.5);results.push('speed');
  await clickButton('系统控件');assert.equal(await e("document.querySelector('video').controls"),true);await clickButton('系统控件');assert.equal(await e("document.querySelector('video').controls"),false);results.push('standard controls toggle');
  win.setSize(740,660);await pause(100);await e("if(!document.querySelector('.enigma-player-controls'))document.querySelector('#tbTogglePreview').click()");await until("document.querySelector('video')?.readyState>=1 && !!document.querySelector('.enigma-player-controls')");const overflow=await e("(()=>{const root=document.querySelector('.enigma-player-controls');return {width:root.clientWidth,scroll:root.scrollWidth}})()");assert(overflow.scroll<=overflow.width+1,JSON.stringify(overflow));assert(Math.abs(await e("document.querySelector('video').currentTime")-.7)<.12);fs.writeFileSync(path.join(root,'video-narrow.png'),(await win.webContents.capturePage()).toPNG());results.push('narrow controls fit and playback position retained');
  win.setSize(1100,760);await pause(150);await e("window.oldTestMedia=document.querySelector('video')");await open('new.wav');await until("document.querySelector('audio')?.readyState>=1");assert.equal(await e("oldTestMedia.paused && !oldTestMedia.getAttribute('src')"),true);results.push('previous file stopped/unloaded');
  await clickButton('播放');await until("document.querySelector('audio').currentTime>.1");await clickButton('暂停');results.push('audio play/pause');
  fs.writeFileSync(path.join(root,'audio.png'),(await win.webContents.capturePage()).toPNG());
  await open('broken.webm');await until("[...document.querySelectorAll('[role=alert]')].some(r=>r.textContent.includes('无法读取或解码'))");await clickButton('重新加载');await until("[...document.querySelectorAll('[role=alert]')].some(r=>r.textContent.includes('无法读取或解码'))");results.push('decode error/retry');
  fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({passed:true,results},null,2));console.log(JSON.stringify({passed:true,root,results}));
 }catch(error){fs.writeFileSync(path.join(root,'failure.json'),JSON.stringify({error:error.message,results,media:await e("(()=>{const m=document.querySelector('video,audio');return m?{html:m.outerHTML,current:m.currentSrc,ready:m.readyState,network:m.networkState,error:m.error?.message}:null})()").catch(()=>null),body:await e('document.body.innerText').catch(()=>null)},null,2));console.error(error);process.exitCode=1}
 finally{win.destroy();app.exit(process.exitCode||0)}
});
