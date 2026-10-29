/** Prepare an isolated real-media UI check. Interact through the browser/native UI;
 * this harness deliberately does not drive a production window or user profile. */
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {prepareEnigmaProfile} from './enigma-profile.mjs';
import {createPreviewDocuments} from './create-preview-documents.mjs';
import {createImagePreviewFixtures} from './create-image-preview-fixtures.mjs';
const require=createRequire(import.meta.url);
if(!process.argv[2])throw Error('Pass an existing external evidence directory');
const root=fs.mkdtempSync(path.join(path.resolve(process.argv[2]),'media-preview-'));
const profile=path.join(root,'server-profile'),files=path.join(root,'new-files');
await prepareEnigmaProfile({dataRoot:profile,workspace:files});await createPreviewDocuments(files);await createImagePreviewFixtures(files);
const wav=fs.readFileSync(path.join(files,'new.wav')),audio=Buffer.concat([wav.subarray(0,44),...Array.from({length:32},()=>wav.subarray(44))]);audio.writeUInt32LE(audio.length-8,4);audio.writeUInt32LE(audio.length-44,40);fs.writeFileSync(path.join(files,'new.wav'),audio);
fs.writeFileSync(path.join(files,'new.vtt'),'WEBVTT\n\n00:00.000 --> 00:10.000\n本机字幕验收\n\n00:10.000 --> 00:30.000\n第二段字幕\n');
const videoEnv={...process.env,ENIGMA_PREVIEW_VIDEO_ROOT:root,ENIGMA_PREVIEW_VIDEO_FRAMES:'160'};delete videoEnv.ELECTRON_RUN_AS_NODE;
const videoCode=await new Promise(resolve=>spawn(require('electron'),['scripts/create-preview-video.cjs'],{env:videoEnv,stdio:'inherit'}).on('exit',resolve));
if(videoCode!==0)throw Error('Original test video creation failed');
const fd=fs.openSync(path.join(root,'server.log'),'w');
const server=spawn(process.execPath,['server/main-full.ts'],{env:{...process.env,HANA_HOME:profile,ENIGMA_DESKTOP_DATA:profile,ENIGMA_DESKTOP_PRODUCT:'1',HANA_PORT:'0'},stdio:['ignore',fd,fd]});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.kill('SIGTERM'));
try{
 let info;
 for(let i=0;i<200;i++){
  if(server.exitCode!==null)throw Error('Test server exited');
  try{info=JSON.parse(fs.readFileSync(path.join(profile,'server-info.json')));if(info.port)break;}catch{}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 if(!info?.port)throw Error('Test server did not start');
 console.log(JSON.stringify({root,profile,url:`http://127.0.0.1:${info.port}/desktop/`,checklist:'docs/videojs-preview-adoption-2026-10-29.md',status:'ready for manual UI acceptance; not a passed test'}));
 await new Promise(resolve=>server.once('exit',resolve));
}finally{if(server.exitCode===null)server.kill('SIGTERM');fs.closeSync(fd);}
