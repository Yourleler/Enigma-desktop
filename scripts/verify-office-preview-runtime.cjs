const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.env.ENIGMA_PREVIEW_TEST_ROOT,profile=process.env.ENIGMA_PREVIEW_TEST_HOME;
if(!root||!profile)throw new Error('Isolated preview test directories are required');
app.setPath('userData',path.join(root,'profile'));
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:1200,height:800,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  const logs=[];win.webContents.on('console-message',(...args)=>logs.push(String(args.find(value=>value?.message)?.message||'')));
  let expected;
  const wait=async(expression)=>{
    expected=expression;
    for(let i=0;i<100;i++) {if(await win.webContents.executeJavaScript(expression).catch(()=>false))return;await new Promise(resolve=>setTimeout(resolve,100));}
    throw new Error('Office preview did not reach expected visible state');
  };
  const waitDocx=async()=>{
    for(let i=0;i<100;i++){
      const child=win.webContents.mainFrame.framesInSubtree.find(frame=>frame.url.includes('/assets/docx-viewer-'));
      if(child&&await child.executeJavaScript("document.getElementById('document')?.textContent.includes('新建 Word 预览正文')").catch(()=>false))return;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    throw new Error('Isolated Word layout did not render the actual document');
  };
  const clickFile=async name=>{
    await wait(`!![...document.querySelectorAll('[role="treeitem"]')].find(el=>el.textContent.trim()===${JSON.stringify(name)})`);
    await win.webContents.executeJavaScript(`[...document.querySelectorAll('[role="treeitem"]')].find(el=>el.textContent.trim()===${JSON.stringify(name)}).click()`);
  };
  try {
    const info=JSON.parse(fs.readFileSync(path.join(profile,'server-info.json')));
    await win.loadURL(`http://127.0.0.1:${info.port}/desktop/#enigma-local-key=${encodeURIComponent(info.token)}`);
    await clickFile('new.xlsx');
    await wait("[...document.querySelectorAll('.preview-csv summary')].some(el=>el.textContent.includes('第二工作表'))");
    await win.webContents.executeJavaScript("[...document.querySelectorAll('.preview-csv summary')].find(el=>el.textContent.includes('第二工作表')).click()");
    await new Promise(resolve=>setTimeout(resolve,800));
    assert(await win.webContents.executeJavaScript("[...document.querySelectorAll('.preview-csv details')].find(el=>el.querySelector('summary').textContent.includes('第二工作表')).open"),'Unchanged refresh must not close the selected worksheet');
    const workbook=await win.webContents.executeJavaScript("document.querySelector('.preview-csv').innerText");
    assert(workbook.includes('新建测试项目'));assert(workbook.includes('复核结果'));assert(workbook.includes('通过'));
    fs.writeFileSync(path.join(root,'xlsx.png'),(await win.webContents.capturePage()).toPNG());
    await clickFile('new.docx');await waitDocx();
    await new Promise(resolve=>setTimeout(resolve,600));
    await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.reload();});
    await waitDocx();
    fs.writeFileSync(path.join(root,'docx-restored.png'),(await win.webContents.capturePage()).toPNG());
    await clickFile('new.pdf');await wait("document.querySelector('.enigma-pdf-full-viewer')?.contentDocument?.querySelector('.textLayer')?.textContent.includes('Enigma')");
    await win.webContents.executeJavaScript("[...document.querySelectorAll('.enigma-pdf-heading button')].find(el=>el.textContent==='系统阅读器').click()");
    await wait("!!document.querySelector('iframe.preview-pdf') && document.body.innerText.includes('2 页')");
    await new Promise(resolve=>setTimeout(resolve,800));
    fs.writeFileSync(path.join(root,'pdf.png'),(await win.webContents.capturePage()).toPNG());
    await clickFile('broken.pdf');await wait("[...document.querySelectorAll('[role=alert]')].some(el=>el.textContent.includes('损坏'))");
    const media=[];
    for(const name of ['new.wav','new.webm']){
      await clickFile(name);const tag=name.endsWith('wav')?'audio':'video';
      await wait(`document.querySelector('${tag}')?.readyState>=1`);
      await new Promise(resolve=>setTimeout(resolve,600));
      const before=await win.webContents.executeJavaScript(`({controls:document.querySelector('${tag}').controls,paused:document.querySelector('${tag}').paused,duration:document.querySelector('${tag}').duration})`);
      assert(!before.controls&&before.paused,'Custom media controls must not autoplay');
      assert(await win.webContents.executeJavaScript("!!document.querySelector('.enigma-player-controls button[aria-label=\"播放\"]')"),'Custom playback control should be visible');
      await win.webContents.executeJavaScript("[...document.querySelectorAll('.enigma-player-footer button')].find(el=>el.textContent==='系统控件').click()");
      await wait(`document.querySelector('${tag}')?.controls===true`);
      await win.webContents.executeJavaScript(`document.querySelector('${tag}').play()`,true);
      await new Promise(resolve=>setTimeout(resolve,350));
      const progress=await win.webContents.executeJavaScript(`({time:document.querySelector('${tag}').currentTime,paused:document.querySelector('${tag}').paused,ready:document.querySelector('${tag}').readyState,src:document.querySelector('${tag}').currentSrc})`);
      assert(progress.time>0,'Real media playback should advance: '+JSON.stringify(progress));
      await win.webContents.executeJavaScript(`document.querySelector('${tag}').pause();document.querySelector('${tag}').currentTime=0.15;`);
      media.push({name,duration:before.duration,played:true});
    }
    fs.writeFileSync(path.join(root,'video.png'),(await win.webContents.capturePage()).toPNG());
    await clickFile('broken.webm');await wait("[...document.querySelectorAll('[role=alert]')].some(el=>el.textContent.includes('无法读取或解码'))");
    fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({passed:true,workbook,docxReload:true,pdfPages:2,brokenPdf:true,media,brokenVideo:true}));console.log('OFFICE_AND_MEDIA_PREVIEW_PASSED');
  }catch(error){fs.writeFileSync(path.join(root,'failure.json'),JSON.stringify({error:error.message,expected,logs,body:await win.webContents.executeJavaScript('document.body.innerText')},null,2));fs.writeFileSync(path.join(root,'failure.png'),(await win.webContents.capturePage()).toPNG());console.error(error.message);process.exitCode=1;}
  finally{win.destroy();app.exit(process.exitCode||0);}
});
