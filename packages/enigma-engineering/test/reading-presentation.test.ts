import assert from 'node:assert/strict';
import test from 'node:test';
import {rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fixture} from './fixtures.js';
import {SourceIndex} from '../src/source-index.js';
import {domainAction} from '../src/workbench-domain.js';
import {readSchemas} from '../src/schema-reading.js';
test('workbench index returns only budgeted path candidates, not internal token corpora',async()=>{
 const {root,workspace}=await fixture();try{
  for(let i=0;i<16;i++)await writeFile(join(root,'library',`token-${i}.js`),`export const marker${i} = 'needle';\n`+'// '+Array.from({length:1000},(_,i)=>'corpusWord'+i).join(' '));
  const ctx={options:{workspace},chat:{session:'task'},runtime:{session:{sessionManager:{getLeafId:()=>undefined,getBranch:()=>[]}}}} as any;
  const result=await domainAction(ctx,'source-index',{query:'needle',maxFiles:3},new AbortController().signal) as any;
  assert.equal(result.sourceIndex,true);assert.equal(result.files.length,3);assert(result.total>=16);assert.equal(result.candidates,undefined);assert(result.files.every((file:any)=>!file.terms&&file.score>0));assert(JSON.stringify(result).length<3000);
  await assert.rejects(new SourceIndex(workspace).select('needle',{maxFiles:-1}),/budget/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('long one-line schema snippets are explicitly marked truncated',async()=>{
 const {root,workspace}=await fixture();try{
  await writeFile(join(root,'library','schema.json'),JSON.stringify({$schema:'https://json-schema.org/draft/2020-12/schema',title:'Payload',type:'object',description:'x'.repeat(20000),properties:{message:{type:'string'}}}));
  const schemas=await readSchemas(workspace);const definition=schemas.definitions.find(definition=>definition.source.file==='schema.json');assert(definition);assert.equal(definition.source.snippet.length,16000);assert.equal(definition.source.truncated,true);
 }finally{await rm(root,{recursive:true,force:true});}
});
