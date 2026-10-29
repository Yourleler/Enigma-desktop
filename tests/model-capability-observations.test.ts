import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach,beforeEach,expect,it} from 'vitest';
import {ModelCapabilityObservations} from '../core/model-capability-observations.ts';
let root:string;
const model={provider:'local-test',id:'image-capable',api:'openai-responses',baseUrl:'https://model.example.test',input:['text']};
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'model-observation-'));});
afterEach(()=>fs.rmSync(root,{recursive:true,force:true}));
it('adds verified image capability without rewriting the source model or credentials',()=>{
  const store=new ModelCapabilityObservations(root);
  store.recordImageSupport(model,{matched:true,imageSha256:'a'.repeat(64)},1000);
  const resolved=store.apply(model,2000);
  expect(resolved.input).toEqual(['text','image']);expect(model.input).toEqual(['text']);
  expect(JSON.stringify(store.read())).not.toContain(model.baseUrl);
  expect(store.apply({...model,baseUrl:'https://other.example.test'},2000).input).toEqual(['text']);
});
it('invalidates changed declarations, expired observations and failed probes',()=>{
  const store=new ModelCapabilityObservations(root);store.recordImageSupport(model,{matched:true,imageSha256:'a'.repeat(64)},1000);
  expect(store.apply({...model,input:['text','audio']},2000).input).toEqual(['text','audio']);
  expect(store.apply(model,31*86400000).input).toEqual(['text']);
  expect(()=>store.recordImageSupport(model,{matched:false,imageSha256:'a'.repeat(64)})).toThrow('successful image');
});
