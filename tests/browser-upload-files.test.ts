import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,beforeEach,expect,it} from 'vitest';
import {resolveBrowserUploadFiles} from '../lib/browser/browser-upload-files.ts';
let root: string,workspace: string,outside: string;
beforeEach(async()=>{root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'browser-upload-test-')));workspace=path.join(root,'workspace');await fs.mkdir(workspace);outside=path.join(root,'outside.txt');await fs.writeFile(outside,'outside test data');await fs.writeFile(path.join(workspace,'sample.txt'),'owned test data');});
afterEach(async()=>{await fs.rm(root,{recursive:true,force:true});});

it('allows owned files and rejects directories and sibling paths',async()=>{
  const file=path.join(workspace,'sample.txt');
  expect(await resolveBrowserUploadFiles({paths:[file],roots:[workspace]})).toEqual([file]);
  await expect(resolveBrowserUploadFiles({paths:[outside],roots:[workspace]})).rejects.toThrow('outside');
  await expect(resolveBrowserUploadFiles({paths:[workspace],roots:[workspace]})).rejects.toThrow('regular files');
});
it.skipIf(process.platform==='win32')('rejects a symlink that escapes the authorized directory',async()=>{
  const link=path.join(workspace,'link.txt');await fs.symlink(outside,link);
  await expect(resolveBrowserUploadFiles({paths:[link],roots:[workspace]})).rejects.toThrow('outside');
});
it('allows an explicit current-session attachment without granting its whole parent directory',async()=>{
  const resolveFile=()=>({filePath:outside,sessionId:'current',sessionPath:'/new/current.jsonl'});
  expect(await resolveBrowserUploadFiles({fileIds:['attached'],roots:[workspace],sessionId:'current',sessionPath:'/new/current.jsonl',resolveFile})).toEqual([outside]);
  await expect(resolveBrowserUploadFiles({fileIds:['attached'],roots:[workspace],sessionId:'other',sessionPath:'/new/other.jsonl',resolveFile})).rejects.toThrow('current conversation');
});
