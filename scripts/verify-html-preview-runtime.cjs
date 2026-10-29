// Hidden, isolated browser probe. The URL must be a new local test server.
const {app, BrowserWindow} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const url = process.env.ENIGMA_PREVIEW_TEST_URL;
const root = process.env.ENIGMA_PREVIEW_TEST_ROOT;
if (!root || !url || new URL(url).hostname !== '127.0.0.1') throw new Error('New local test environment required');
app.setPath('userData',path.join(root,'profile'));
app.whenReady().then(async () => {
  const win = new BrowserWindow({show:false,width:1000,height:700,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  const logs=[];
  win.webContents.on('console-message',(...args)=>logs.push(String(args.find(value=>value?.message)?.message || args.find(value=>typeof value==='string') || 'console message')));
  try {
    let target = url;
    if (process.env.ENIGMA_PREVIEW_TEST_HOME) {
      const info=JSON.parse(fs.readFileSync(path.join(process.env.ENIGMA_PREVIEW_TEST_HOME,'server-info.json')));
      if (new URL(url).port !== String(info.port)) throw new Error('Test server identity mismatch');
      target += '#enigma-local-key='+encodeURIComponent(info.token);
    }
    await win.loadURL(target);
    if (process.env.ENIGMA_PREVIEW_TEST_HOME) {
      for(let i=0;i<50;i++) {
        const clicked=await win.webContents.executeJavaScript(`(() => { const row=[...document.querySelectorAll('[role="treeitem"]')].find(el=>el.textContent.trim()==='preview.html'); if(!row)return false; row.click();return true; })()`);
        if(clicked)break;
        await new Promise(resolve=>setTimeout(resolve,100));
      }
    }
    await new Promise(resolve => setTimeout(resolve,1200));
    if(process.env.ENIGMA_PREVIEW_RELOAD==='1') {
      await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.reload();});
      let restored=false;
      for(let i=0;i<80;i++) {
        await new Promise(resolve=>setTimeout(resolve,100));
        const preview=win.webContents.mainFrame.framesInSubtree.find(frame=>/\/preview\/html\//.test(frame.url));
        if(preview) {
          const ready=await preview.executeJavaScript("document.readyState === 'complete' && [...document.querySelectorAll('button')].some(button=>button.textContent==='测试按钮')").catch(()=>false);
          if(ready){restored=true;break;}
        }
      }
      assert(restored,'Open HTML preview must return after application reload');
    }
    const frames=[];
    const previewFrame = win.webContents.mainFrame.framesInSubtree.find(frame => /\/preview\/html\//.test(frame.url));
    assert(previewFrame, 'HTML preview frame must load');
    const interaction = await previewFrame.executeJavaScript(`(() => {
      const button = [...document.querySelectorAll('button')].find(el => el.textContent === '测试按钮');
      if (!button) return {buttonFound:false};
      const input=document.querySelector('input');input.value='新建文件交互测试';input.dispatchEvent(new Event('input',{bubbles:true}));
      button.click();
      let parentAccess;try { parentAccess = !!parent.document.body; } catch { parentAccess=false; }
      return {buttonFound:true,value:input.value,receipt:document.querySelector('output').textContent,parentAccess,preload:typeof window.hana,base:document.baseURI,scripts:[...document.scripts].map(script=>script.src),images:[...document.images].map(image=>({loaded:image.complete&&image.naturalWidth>0,src:image.src}))};
    })()`);
    for (const frame of win.webContents.mainFrame.framesInSubtree) {
      frames.push({url:frame.url.replace(/([?&]previewToken=)[^&]+/,'$1[redacted]'),text:await frame.executeJavaScript('document.body.innerText')});
    }
    fs.writeFileSync(path.join(root,'frames.json'),JSON.stringify({frames,logs,interaction},null,2));
    const image=await win.webContents.capturePage();fs.writeFileSync(path.join(root,'frame.png'),image.toPNG());
    assert.equal(interaction.receipt,'已点击');
    assert.equal(interaction.preload,'undefined');
    assert(interaction.images.every(image=>image.loaded),'Relative HTML images must load');
    if(process.env.ENIGMA_PREVIEW_TEST_HOME)assert.equal(interaction.parentAccess,false);
    console.log(JSON.stringify({passed:true,frames:frames.length,receipt:interaction.receipt,imageCount:interaction.images.length,parentAccess:interaction.parentAccess,preload:interaction.preload,logs}));
  } catch(error) {fs.writeFileSync(path.join(root,'failure.json'),JSON.stringify({error:error.message,logs},null,2));console.error(error.message);process.exitCode=1;}
  finally {win.destroy();app.exit(process.exitCode||0);}
});
