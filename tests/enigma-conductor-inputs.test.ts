import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {captureManagedInputs,deliverManagedInputs,managedInputsCurrent} from '../plugins/enigma/conductor-inputs.ts';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'enigma-input-relay-'));roots.push(root);
 const source=path.join(root,'report.md'),workerSource=path.join(root,'worker-report.md'),child=path.join(root,'child');
 await fs.writeFile(source,'# Source report\nOriginal inputs remain unchanged.\n');await fs.writeFile(workerSource,'# Worker report\nVerified result.\n');await fs.mkdir(child);
 const sourceReal=await fs.realpath(source),workerReal=await fs.realpath(workerSource);
 const engine={resolveActiveSessionFile:vi.fn(({sessionPath,fileId})=>sessionPath==='manager'&&fileId==='sf_source'?{filePath:source,realPath:sourceReal,label:'source-report.md',mime:'text/markdown',status:'available'}:sessionPath==='owned-worker'&&fileId==='sf_worker'?{filePath:workerSource,realPath:workerReal,label:'worker-report.md',mime:'text/markdown',status:'available'}:null),registerSessionFile:vi.fn(entry=>({id:'sf_copy-'+path.basename(entry.filePath)}))};
 const task=(id:string)=>{if(id!=='own-task')throw Error('Only owned tasks may be used');return {sessionPath:'owned-worker'};};return {root,source,workerSource,child,engine,task};
}
it('relays selected manager and owned-worker reports as version-checked, read-only copies',async()=>{
 const {source,workerSource,child,engine,task}=await fixture(),original=await fs.readFile(source);
 const snapshots=await captureManagedInputs(engine,'manager',[{fileId:'sf_source'},{fileId:'sf_worker',fromTask:'own-task'},{fileId:'sf_source'}],task);
 expect(snapshots).toHaveLength(2);expect(snapshots[0]).not.toHaveProperty('sourcePath');
 const copies=await deliverManagedInputs(engine,'manager',snapshots,{sessionPath:'target',root:child},task);
 expect(copies.map(file=>file.name)).toEqual(['source-report.md','worker-report.md']);
 expect(await fs.readFile(copies[0].path)).toEqual(original);expect(await fs.readFile(copies[1].path)).toEqual(await fs.readFile(workerSource));
 expect((await fs.stat(copies[0].path)).mode&0o222).toBe(0);expect(await fs.readFile(source)).toEqual(original);
 expect(engine.registerSessionFile).toHaveBeenCalledWith(expect.objectContaining({sessionPath:'target',metadata:expect.objectContaining({sourceHash:snapshots[0].sha256,purpose:'managed_task_input'})}));
});
it('rejects a changed or missing input before starting a worker with different evidence',async()=>{
 const {source,child,engine,task}=await fixture();const snapshots=await captureManagedInputs(engine,'manager',[{fileId:'sf_source'}],task);
 expect(await managedInputsCurrent(engine,'manager',snapshots,task)).toBe(true);
 await fs.writeFile(source,'Changed after task approval');await expect(deliverManagedInputs(engine,'manager',snapshots,{sessionPath:'target',root:child},task)).rejects.toThrow('已变化');
 expect(await managedInputsCurrent(engine,'manager',snapshots,task)).toBe(false);
 expect(engine.registerSessionFile).not.toHaveBeenCalled();expect(await fs.readdir(child)).toEqual([]);
 await fs.rm(source);await expect(deliverManagedInputs(engine,'manager',snapshots,{sessionPath:'target',root:child},task)).rejects.toThrow();
});
it('does not accept an unrelated session, arbitrary filesystem path or unowned worker',async()=>{
 const {engine,task}=await fixture();
 await expect(captureManagedInputs(engine,'manager',[{fileId:'sf_foreign'}],task)).rejects.toThrow('有效文件范围');
 await expect(captureManagedInputs(engine,'manager',[{fileId:'sf_worker',fromTask:'foreign-task'}],task)).rejects.toThrow('Only owned');
 await expect(captureManagedInputs(engine,'manager',[{path:'/not-a-file-grant'}] as any,task)).rejects.toThrow('文件标识');
 expect(engine.registerSessionFile).not.toHaveBeenCalled();
});
it('bounds input count and file size without truncating the document',async()=>{
 const {source,engine,task}=await fixture();await fs.truncate(source,33*1024*1024);
 await expect(captureManagedInputs(engine,'manager',[{fileId:'sf_source'}],task)).rejects.toThrow('32MB');
 await expect(captureManagedInputs(engine,'manager',Array.from({length:17},()=>({fileId:'sf_source'})),task)).rejects.toThrow('16');
});
it('keeps the file extension when a long Unicode display name needs a bounded copy filename',async()=>{
 const {engine,source,child,task}=await fixture(),label='资料'.repeat(100)+'.md',realPath=await fs.realpath(source);
 engine.resolveActiveSessionFile.mockReturnValue({filePath:source,realPath,label,mime:'text/markdown',status:'available'});
 const selected=await captureManagedInputs(engine,'manager',[{fileId:'sf_source'}],task),copies=await deliverManagedInputs(engine,'manager',selected,{sessionPath:'target',root:child},task);
 expect(path.extname(copies[0].path)).toBe('.md');expect(Buffer.byteLength(path.basename(copies[0].path))).toBeLessThan(255);expect(copies[0].name).toBe(label);
});
