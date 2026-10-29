const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.env.ENIGMA_PREVIEW_TEST_ROOT,profile=process.env.ENIGMA_PREVIEW_TEST_HOME;
if(!root||!profile)throw new Error('Isolated test root required');
app.setPath('userData',path.join(root,'browser-profile'));
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:1200,height:800,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});
  const evaluate=source=>win.webContents.executeJavaScript(source);
  const until=async(source)=>{for(let i=0;i<150;i++){const value=await evaluate(source);if(value)return value;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('UI condition timed out: '+source)};
  try {
    const info=JSON.parse(fs.readFileSync(path.join(profile,'server-info.json')));
    await win.loadURL(`http://127.0.0.1:${info.port}/desktop/#enigma-local-key=${encodeURIComponent(info.token)}`);
    await until("[...document.querySelectorAll('[role=treeitem]')].some(row=>row.textContent.trim()==='start.md')");
    await evaluate("(()=>{const row=[...document.querySelectorAll('[role=treeitem]')].find(row=>row.textContent.trim()==='start.md');row.click();row.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));})()");
    await until("!!document.querySelector('[aria-label=预览]') || !!document.querySelector('.preview-markdown')");
    await evaluate("if(!document.querySelector('.preview-markdown'))document.querySelector('[aria-label=预览]').click()");
    await until("document.querySelector('.preview-markdown img')?.naturalWidth===120");
    const image=await evaluate("(()=>{const image=document.querySelector('.preview-markdown img');return {loaded:image.complete,width:image.naturalWidth,scheme:new URL(image.src).protocol}})()");
    assert.equal(image.loaded,true);assert.equal(image.scheme,'http:');
    const href=await until("document.querySelector('.preview-markdown a')?.getAttribute('href')");
    assert.equal(new URL(href).searchParams.has('token'),false);
    await evaluate("document.querySelector('.preview-markdown a').click()");
    await until("document.body.innerText.includes('远端链接打开成功')");
    assert(win.webContents.getURL().includes('/desktop/'));
    await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.reload()});
    await until("document.body.innerText.includes('远端链接打开成功')");
    await evaluate("[...document.querySelectorAll('[role=tab]')].find(tab=>tab.textContent.includes('start.md')).click()");
    await until("!!document.querySelector('[aria-label=预览]') || !!document.querySelector('.preview-markdown')");
    await evaluate("if(!document.querySelector('.preview-markdown'))document.querySelector('[aria-label=预览]').click()");
    await until("document.querySelector('.preview-markdown img')?.naturalWidth===120");
    await evaluate("document.querySelector('.preview-markdown a').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:700,clientY:300}))");
    await until("document.body.innerText.includes('在工作区打开')");
    await evaluate("[...document.querySelectorAll('.context-menu-item')].find(item=>item.textContent.trim()==='在工作区打开').click()");
    await until("document.body.innerText.includes('远端链接打开成功')");
    const capture=await win.webContents.capturePage();fs.writeFileSync(path.join(root,'after.png'),capture.toPNG());
    fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({passed:true,relativeImageLoaded:image.loaded,imageWidth:image.width,linkHasCredential:false,linkedDocumentOpened:true,reloadRestored:true,contextMenuOpenedInWorkbench:true,scope:'Actual web renderer and authenticated workbench file endpoint, isolated server/profile; not native Mac mouse acceptance'},null,2));
  }catch(error){fs.writeFileSync(path.join(root,'failure.json'),JSON.stringify({error:error.message,body:await evaluate('document.body.innerText').catch(()=>null)},null,2));console.error(error.message);process.exitCode=1;}
  finally{win.destroy();app.exit(process.exitCode||0)}
});
