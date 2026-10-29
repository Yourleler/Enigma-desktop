const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const root=process.env.ENIGMA_PREVIEW_VIDEO_ROOT;if(!root)throw new Error('New test root required');
app.setPath('userData',path.join(root,'video-profile'));
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,nodeIntegration:false,backgroundThrottling:false}});
  try {
    await win.loadURL('about:blank');
    const base64=await win.webContents.executeJavaScript(`(async()=>{
      const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;document.body.append(canvas);
      const ctx=canvas.getContext('2d'),stream=canvas.captureStream(8),recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'}),parts=[];
      recorder.ondataavailable=e=>parts.push(e.data);const done=new Promise(resolve=>recorder.onstop=resolve);recorder.start();
      for(let i=0;i<12;i++){ctx.fillStyle=i%2?'#7b55ac':'#d3c2f0';ctx.fillRect(0,0,320,180);ctx.fillStyle='white';ctx.font='24px sans-serif';ctx.fillText('New preview '+i,50,90);await new Promise(r=>setTimeout(r,125));}
      recorder.stop();await done;stream.getTracks().forEach(track=>track.stop());
      const bytes=new Uint8Array(await new Blob(parts).arrayBuffer());return btoa(String.fromCharCode(...bytes));
    })()`);
    fs.writeFileSync(path.join(root,'new-files','new.webm'),Buffer.from(base64,'base64'));
  }catch(error){console.error(error.message);process.exitCode=1;}
  finally{win.destroy();app.exit(process.exitCode||0);}
});
