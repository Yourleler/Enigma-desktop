import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { afterEach, expect, it } from 'vitest';
import { stageRendererUpdate } from '../scripts/stage-enigma-renderer.mjs';
import { buildSeedManifest } from '../scripts/build-server-artifact.mjs';
const require = createRequire(import.meta.url);
const { ustar, activation, pointerStore } = require('../shared/artifact-core/index.cjs');
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
async function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'renderer-update-'));roots.push(root);
 const homeDir=path.join(root,'home'),seedDir=path.join(root,'seed'),server=path.join(root,'server'),renderer=path.join(root,'renderer');
 for(const dir of [homeDir,seedDir,server,renderer])fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(server,'node'),'unchanged server');fs.writeFileSync(path.join(renderer,'index.html'),'new renderer');
 const serverArchive=path.join(seedDir,'server.tar.gz'),archivePath=path.join(root,'renderer.tar.gz');await ustar.packTree(server,serverArchive);await ustar.packTree(renderer,archivePath);
 const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');const keyset=[{keyId:'test',publicKey:publicKey.export({type:'spki',format:'pem'}).toString()}];
 const seed=buildSeedManifest({version:'1.0.0',platform:'darwin',arch:'arm64',keyId:'test',releasedAt:new Date().toISOString(),server:{archiveName:'server.tar.gz',sha256:await activation.sha256File(serverArchive),size:fs.statSync(serverArchive).size},renderer:{archiveName:'old-renderer.tar.gz',sha256:'0'.repeat(64),size:0}});
 const bytes=Buffer.from(JSON.stringify(seed));fs.writeFileSync(path.join(seedDir,'seed-train-darwin-arm64.json'),bytes);fs.writeFileSync(path.join(seedDir,'seed-train-darwin-arm64.json.sig'),crypto.sign(null,bytes,privateKey));
 await activation.activateFromArchive(serverArchive,seed,{homeDir,channel:'stable',kind:'server',platformArch:'darwin-arm64'});await pointerStore.promote(homeDir,'stable');
 return {homeDir,seedDir,archivePath,version:'1.0.1',keyset,privateKey,outputDir:path.join(root,'receipt'),platformArch:'darwin-arm64'};
}
it('stages a verified renderer while leaving current server contents and pointers unchanged until boot',async()=>{
 const f=await fixture(),current=await pointerStore.readPointer(f.homeDir,'stable','current');
 const before=fs.readFileSync(path.join(current.versionDir,'node'),'utf8');const result=await stageRendererUpdate(f);
 expect(result).toMatchObject({rendererVersion:'1.0.1',serverVersion:'1.0.0',staged:true});
 expect(await pointerStore.readPointer(f.homeDir,'stable','current')).toEqual(current);
 expect(fs.readFileSync(path.join(current.versionDir,'node'),'utf8')).toBe(before);
 const next=await pointerStore.readPointer(f.homeDir,'stable.renderer','next');expect(fs.readFileSync(path.join(next.versionDir,'index.html'),'utf8')).toBe('new renderer');
 expect(next.train).toBe((await pointerStore.readPointer(f.homeDir,'stable','next')).train);
});
it('rejects an untrusted signing key before writing update pointers',async()=>{
 const f=await fixture();const {privateKey}=crypto.generateKeyPairSync('ed25519');
 await expect(stageRendererUpdate({...f,privateKey})).rejects.toThrow('signature verification failed');
 expect(await pointerStore.readPointer(f.homeDir,'stable','next')).toBeNull();expect(await pointerStore.readPointer(f.homeDir,'stable.renderer','next')).toBeNull();
});
it('refuses to overwrite pending updates or reuse an old version',async()=>{
 const f=await fixture();await expect(stageRendererUpdate({...f,version:'1.0.0'})).rejects.toThrow('newer renderer');
 await stageRendererUpdate(f);const next=await pointerStore.readPointer(f.homeDir,'stable.renderer','next');
 await expect(stageRendererUpdate({...f,version:'1.0.2'})).rejects.toThrow('already staged');expect(await pointerStore.readPointer(f.homeDir,'stable.renderer','next')).toEqual(next);
});
