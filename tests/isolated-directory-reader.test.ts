import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {it,expect} from 'vitest';
import {createIsolatedDirectoryReader,readDirectoryIsolated} from '../lib/isolated-directory-reader.ts';

it('returns real directory metadata without changing files',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'enigma-directory-'));
  try {
    fs.writeFileSync(path.join(root,'new.txt'),'hello');fs.mkdirSync(path.join(root,'folder'));
    const entries=await readDirectoryIsolated(root);
    expect(entries.find(entry=>entry.name==='new.txt')).toMatchObject({isFile:true,isDirectory:false,size:5});
    expect(entries.find(entry=>entry.name==='folder')?.isDirectory).toBe(true);
  }finally{fs.rmSync(root,{recursive:true,force:true})}
});

it('bounds stalled reads without occupying the parent fs pool or spawning repeated same-path work',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'enigma-directory-stall-'));
  try {
    fs.writeFileSync(path.join(root,'config.json'),'{}');
    const read=createIsolatedDirectoryReader({source:'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,30000)',timeoutMs:250});
    const first=read(root);expect(read(root)).toBe(first);
    const work=[first,...[1,2,3].map(i=>read(path.join(root,String(i))))];
    const results=Promise.allSettled(work);
    await expect(fs.promises.readFile(path.join(root,'config.json'),'utf8')).resolves.toBe('{}');
    await expect(read(path.join(root,'overflow'))).rejects.toMatchObject({code:'DIRECTORY_READ_TIMEOUT'});
    expect((await results).every(result=>result.status==='rejected')).toBe(true);
    await expect(read(root)).rejects.toMatchObject({code:'DIRECTORY_READ_TIMEOUT'});
  }finally{fs.rmSync(root,{recursive:true,force:true})}
});
