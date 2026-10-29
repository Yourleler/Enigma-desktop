import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { git } from '../src/process.js';
import { readGitBlobs } from '../src/git-blobs.js';

test('batch reading preserves binary boundaries, empty blobs, repeated identities and a final unterminated text line',async()=>{
  const root=await mkdtemp(join(tmpdir(),'enigma-git-blobs-'));
  try{
    await git(root,['init','-q']);
    const contents=[Buffer.alloc(0),Buffer.from([0,10,13,255,128,10,0]),Buffer.from('第一行\nwithout final newline'),Buffer.alloc(512000,65),Buffer.alloc(512001,66)];
    const oids=[];for(const [index,bytes] of contents.entries()){await writeFile(join(root,`file-${index}`),bytes);oids.push((await git(root,['hash-object','-w',`file-${index}`])).trim());}
    const actual=[];for await(const item of readGitBlobs(root,[...oids,oids[1]!,oids[0]!]))actual.push(item);
    assert.equal(actual.length,7);for(let i=0;i<4;i++)assert.deepEqual(actual[i]?.bytes,contents[i]);
    assert.equal(actual[4]?.bytes,undefined);assert.equal(actual[4]?.size,512001);assert.deepEqual(actual[5]?.bytes,contents[1]);assert.equal(actual[6]?.bytes?.length,0);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('cancelling or abandoning a batch does not leave a blocked reader and invalid objects fail explicitly',async()=>{
  const root=await mkdtemp(join(tmpdir(),'enigma-git-blobs-stop-'));
  try{
    await git(root,['init','-q']);await writeFile(join(root,'source'),Buffer.alloc(300000,65));const oid=(await git(root,['hash-object','-w','source'])).trim();
    const abort=new AbortController(),iterator=readGitBlobs(root,Array(50).fill(oid),{signal:abort.signal});
    assert.equal((await iterator.next()).done,false);abort.abort();await assert.rejects(iterator.next(),/abort/i);
    const early=readGitBlobs(root,Array(50).fill(oid));await early.next();assert.equal((await early.return(undefined)).done,true);
    await assert.rejects(readGitBlobs(root,['0'.repeat(40)]).next(),/metadata/);
    await assert.rejects(readGitBlobs(root,['--option']).next(),/identities/);
  }finally{await rm(root,{recursive:true,force:true});}
});
