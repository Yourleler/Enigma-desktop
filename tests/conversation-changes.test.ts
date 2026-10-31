import {afterEach,describe,it,expect} from 'vitest';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {conversationChanges,finishChangeCapture} from '../core/conversation-change-capture.ts';
import {ConversationChanges} from '../lib/conversation-changes.ts';
const roots:string[]=[];afterEach(async()=>{for(const r of roots.splice(0))await fs.rm(r,{recursive:true,force:true});});
async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'conversation-changes-'));roots.push(root);const work=path.join(root,'files');await fs.mkdir(work);const store=new ConversationChanges(path.join(root,'history'),async()=>[{id:'main',root:work,name:'files'}]);return {root,work,store};}
describe('conversation file versions',()=>{
 it('captures two non-Git rounds and cumulative changes without coalescing saved versions',async()=>{
  const {work,store}=await fixture();await fs.writeFile(path.join(work,'note.md'),'one');
  const first=await store.begin('s','first',null);await store.observeTool('s','write',{path:'note.md',content:'two'},work,()=>fs.writeFile(path.join(work,'note.md'),'two'));await store.end('s',first,'u1');
  const second=await store.begin('s','second','u1');await fs.writeFile(path.join(work,'note.md'),'three');await store.end('s',second,'u2');
  const a=await store.compare('s',first!,first!);expect(a.changes[0]).toMatchObject({before:{content:'one'},after:{content:'two'},attribution:'verified-write'});
  const b=await store.compare('s',first!,second!);expect(b.changes[0]).toMatchObject({before:{content:'one'},after:{content:'three'},attribution:'observed-tool'});
  await expect(fs.stat(path.join(work,'.git'))).rejects.toMatchObject({code:'ENOENT'});
 });
 it('preserves absence, deletion and unknown external edits without claiming model authorship',async()=>{
  const {work,store}=await fixture();await fs.writeFile(path.join(work,'old.txt'),'old');
  const id=await store.begin('s','change',null);await fs.unlink(path.join(work,'old.txt'));await fs.writeFile(path.join(work,'new.txt'),'new');await store.end('s',id,'u1');
  const value=await store.compare('s');expect(value.changes.map(c=>[c.file,c.change,c.attribution])).toEqual([['old.txt','deleted','unattributed'],['new.txt','added','unattributed']]);
 });
 it('isolates sessions, excludes secrets and symlinks, and marks binary/large content',async()=>{
  const {root,work,store}=await fixture();const id=await store.begin('s','change',null);await fs.writeFile(path.join(work,'.env'),'SECRET');await fs.symlink(root,path.join(work,'escape'));await fs.writeFile(path.join(work,'image.bin'),Buffer.from([0,1,2]));await fs.writeFile(path.join(work,'large.txt'),'x'.repeat(520000));await store.end('s',id);
  const value=await store.compare('s');expect(value.changes.map(c=>c.file).sort()).toEqual(['image.bin','large.txt']);expect(value.changes.every(c=>c.after.omitted)).toBe(true);expect((await store.compare('other')).changes).toEqual([]);
 });
 it('does not invent a completed target after a crash and retains interrupted versions',async()=>{
  const {work,store}=await fixture();const id=await store.begin('s','change',null);await fs.writeFile(path.join(work,'new.txt'),'new');expect((await store.compare('s')).version).toBe('');await store.end('s',id,undefined,true);expect((await store.compare('s')).gaps.join()).toContain('中断');
 });
 it('checks roots again before exposing saved content',async()=>{
  const {root,work}=await fixture();let allow=true;const store=new ConversationChanges(path.join(root,'h2'),async()=>allow?[{id:'main',root:work,name:'files'}]:[]);const id=await store.begin('s','change',null);await fs.writeFile(path.join(work,'new.txt'),'new');await store.end('s',id);allow=false;expect((await store.compare('s')).changes).toEqual([]);
 });
 it('inherits only turns retained on the fork branch',async()=>{
  const {work,store}=await fixture();let id=await store.begin('source','first',null);await fs.writeFile(path.join(work,'a.txt'),'a');await store.end('source',id,'u1');id=await store.begin('source','second','u1');await fs.writeFile(path.join(work,'a.txt'),'b');await store.end('source',id,'u2');
  await store.inherit('source','fork',new Set(['u1']));expect((await store.list('fork')).map(t=>t.inputEntry)).toEqual(['u1']);expect((await store.compare('fork')).changes[0].after.content).toBe('a');
 });
 it('keeps separate directory identities, detects renames and preserves observed external changes',async()=>{
  const {root,work}=await fixture();const other=path.join(root,'other');await fs.mkdir(other);await fs.writeFile(path.join(work,'name.txt'),'same');await fs.writeFile(path.join(other,'name.txt'),'other');
  const store=new ConversationChanges(path.join(root,'multi'),async()=>[{id:'one',root:work,name:'one'},{id:'two',root:other,name:'two'}]);const id=await store.begin('s','move and edit',null);await fs.rename(path.join(work,'name.txt'),path.join(work,'new.txt'));await fs.writeFile(path.join(other,'name.txt'),'external');await store.end('s',id);
  const result=await store.compare('s');expect(result.changes).toEqual(expect.arrayContaining([expect.objectContaining({repo:'one',file:'new.txt',previousPath:'name.txt',change:'renamed'}),expect.objectContaining({repo:'two',file:'name.txt',change:'modified',attribution:'unattributed'})]));
 });
 it('serializes overlapping inputs before selecting their baselines',async()=>{
  const {work,store}=await fixture();const a=await store.begin('s','first',null);let began=false;const second=store.begin('s','second',null).then(id=>{began=true;return id;});await new Promise(r=>setTimeout(r,10));expect(began).toBe(false);await fs.writeFile(path.join(work,'note'),'first');await store.end('s',a);const b=await second;await fs.writeFile(path.join(work,'note'),'second');await store.end('s',b);expect((await store.compare('s')).changes[0].before.content).toBe('first');
 });
});

it('releases capture when session metadata fails before finalization',async()=>{
 const {root,work}=await fixture();const engine:any={hanakoHome:path.join(root,'profile'),getSessionManifest:()=>({workspaceScope:{primaryCwd:work}})};
 const store=conversationChanges(engine),id=await store.begin('session','first',null);
 await finishChangeCapture(engine,'session',id,{getBranch(){throw Error('unavailable');}});
 const next=await store.begin('session','next',null);expect(next).not.toBe(id);await store.end('session',next);
});
