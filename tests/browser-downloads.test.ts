import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {BrowserDownloads} from '../shared/browser-downloads.cjs';
let root:string;
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'browser-download-test-'));});
afterEach(()=>fs.rmSync(root,{recursive:true,force:true}));
function fixture(filename='sample.txt'){
  const wc:any=new EventEmitter();wc.id=1;wc.session=new EventEmitter();
  const item:any=new EventEmitter();Object.assign(item,{getFilename:()=>filename,getURL:()=> 'https://fixture.test/file',getURLChain:()=>['https://fixture.test/file'],getMimeType:()=> 'text/plain',getTotalBytes:()=>4,getReceivedBytes:()=>4,setSavePath:vi.fn(),cancel:vi.fn(()=>item.emit('done',{},'cancelled'))});
  const downloads=new BrowserDownloads({directory:root});downloads.attach(wc,'tab-owned');
  wc.session.emit('will-download',{},item,wc);
  return{wc,item,downloads,file:item.setSavePath.mock.calls[0][0],id:downloads.list()[0].id};
}
it('uses a unique managed path and recovers completed records from disk',()=>{
  const {item,downloads,file}=fixture('../../sample.txt');fs.writeFileSync(file,'data');item.emit('done',{},'completed');
  expect(path.dirname(file)).toBe(root);expect(path.basename(file)).not.toBe('sample.txt');
  expect(downloads.list()[0]).toMatchObject({state:'completed',filePath:file,filename:'sample.txt'});
  const reloaded=new BrowserDownloads({directory:root});expect(reloaded.list()[0]).toMatchObject({state:'completed',filePath:file});
});
it('cancels the requested transfer and removes its partial file',async()=>{
  const {downloads,file,id}=fixture();fs.writeFileSync(file,'part');
  const controller=new AbortController();const waiting=downloads.wait(id,{signal:controller.signal});controller.abort(new Error('test cancel'));
  await expect(waiting).rejects.toThrow('test cancel');expect(downloads.list()[0].state).toBe('cancelled');expect(fs.existsSync(file)).toBe(false);
});
it('marks interrupted restarts and refuses malformed ledger paths',()=>{
  const {downloads,file}=fixture();fs.writeFileSync(file,'part');downloads.persist();
  const reloaded=new BrowserDownloads({directory:root});expect(reloaded.list()[0].state).toBe('interrupted');expect(fs.existsSync(file)).toBe(false);
  fs.writeFileSync(path.join(root,'downloads.json'),JSON.stringify([{id:'../../outside',filename:'bad.txt',path:'/tmp/not-owned',state:'completed'}]));
  expect(new BrowserDownloads({directory:root}).list()).toEqual([]);
});
it('cleans up after destruction without accessing destroyed WebContents properties', () => {
  const {downloads, wc, item} = fixture();
  const session = wc.session;
  Object.defineProperty(wc, 'session', {get: () => {throw new Error('Object has been destroyed');}});
  Object.defineProperty(wc, 'id', {get: () => {throw new Error('Object has been destroyed');}});
  expect(() => wc.emit('destroyed')).not.toThrow();
  expect(session.listenerCount('will-download')).toBe(0);
  expect(downloads.attachments.size).toBe(0);
  expect(item.cancel).toHaveBeenCalledOnce();
});
