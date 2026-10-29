/** Exercise the actual Chromium reading APIs on a newly created local document. */
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {createBrowserReadingControls,browserViewerBounds}=require('../desktop/src/shared/browser-reading-controls.cjs');
const parent=process.argv[2];if(!parent||!path.isAbsolute(parent))throw new Error('An external test output directory is required');
const root=fs.mkdtempSync(path.join(parent,'browser-reading-'));app.setPath('userData',path.join(root,'profile'));
const server=http.createServer((req,res)=>{res.setHeader('content-type','text/html;charset=utf-8');res.end(req.url==='/frame'?'<p>needle in nested frame</p>':'<!doctype html><title>New reading fixture</title><h1>Native reading test</h1><p>Needle one</p><p>needle two</p><p>needle three</p><iframe src="/frame"></iframe>');});
let window,control;const results=[];
const condition=async(fn,label)=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,50));}throw new Error(label);};
app.whenReady().then(async()=>{
 try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  window=new BrowserWindow({show:false,width:900,height:650,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});
  control=createBrowserReadingControls(window.webContents);
  const url=`http://127.0.0.1:${server.address().port}`;await window.loadURL(url);
  control.command('find',{query:'needle'});await condition(()=>!control.snapshot().find.pending,'find never returned');
  assert.equal(control.snapshot().find.matches,4);results.push('Chromium case-insensitive search includes child frames');
  control.command('find',{query:'needle',next:true});await condition(()=>!control.snapshot().find.pending,'next match never returned');assert.equal(control.snapshot().find.active,2);results.push('next match advances');
  control.command('find',{query:'needle',next:true,forward:false});await condition(()=>!control.snapshot().find.pending,'previous match never returned');assert.equal(control.snapshot().find.active,1);results.push('previous match returns');
  control.command('find',{query:'Needle',matchCase:true});await condition(()=>!control.snapshot().find.pending,'case sensitive find never returned');assert.equal(control.snapshot().find.matches,1);results.push('case-sensitive search');
  control.command('find',{query:'missing-unique'});await condition(()=>!control.snapshot().find.pending,'no-match find never returned');assert.equal(control.snapshot().find.matches,0);results.push('no matches accurately reported');
  control.command('zoom',{zoomFactor:1.5});assert.equal(window.webContents.getZoomFactor(),1.5);control.command('zoom',{zoomFactor:1});results.push('native zoom and reset');
  control.command('find',{query:'needle'});await window.loadURL(url+'/new-page');assert.equal(control.snapshot().find.query,'');results.push('navigation clears prior find identity');
  const bounds=browserViewerBounds([900,650],198);assert.equal(bounds.y,202);assert.equal(bounds.y+bounds.height,642);results.push('page bounds below expanded chrome');
  fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({passed:true,results},null,2));console.log(JSON.stringify({passed:true,root,results}));
 }catch(error){fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({passed:false,error:error.message,results}));console.error(JSON.stringify({passed:false,root,error:error.message}));process.exitCode=1;}
 finally{control?.dispose();window?.destroy();server.close();app.exit(process.exitCode||0);}
});
