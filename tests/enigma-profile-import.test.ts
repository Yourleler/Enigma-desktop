import {describe,expect,it} from 'vitest';
import {normalizeImportedProviderIds} from '../scripts/enigma-profile.mjs';
describe('Enigma model import identities',()=>{
 it('maps the Pi runtime OAuth alias to the host owner without duplicating built-in providers',()=>{
  const config={api:'openai-codex-responses',models:[{id:'example'}]};
  expect(normalizeImportedProviderIds({'openai-codex':config,gateway:{api:'openai-responses'}})).toEqual({'openai-codex-oauth':config,gateway:{api:'openai-responses'}});
 });
 it('rejects ambiguous duplicate configurations rather than silently replacing either',()=>{
  expect(()=>normalizeImportedProviderIds({'openai-codex':{models:['one']},'openai-codex-oauth':{models:['two']}})).toThrow('内容不同');
 });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'js-yaml';
import {prepareEnigmaProfile} from '../scripts/enigma-profile.mjs';
import {ProviderCatalogStore} from '../core/provider-catalog';
import {syncModels} from '../core/model-sync';
import {afterEach,beforeEach} from 'vitest';
let root:string;
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'enigma-model-import-'));});
afterEach(()=>fs.rmSync(root,{recursive:true,force:true}));
const source=(providers:unknown)=>{const file=path.join(root,'source.json');fs.writeFileSync(file,JSON.stringify({providers}));return file;};
it('imports into the live catalog after migration, preserves existing models and missing credentials, and projects usable Pi models',async()=>{
 const profile=path.join(root,'profile');await prepareEnigmaProfile({dataRoot:profile});
 const catalog=new ProviderCatalogStore(profile);catalog.saveProviders({gateway:{base_url:'http://127.0.0.1:9090/v1',api_key:'fixture-key',api:'openai-completions',media:{keep:true},models:[{id:'old',name:'Keep'},{id:'updated',name:'Before',reasoning:true}]},other:{base_url:'http://127.0.0.1:9091/v1',models:[{id:'other'}]}},{deletedProviders:['gateway']});
 const legacy=path.join(profile,'added-models.yaml');fs.writeFileSync(legacy,'_migrated: true\nproviders: {}\n');
 const modelsFile=source({gateway:{baseUrl:'http://127.0.0.1:9090/v1',api:'openai-completions',models:[{id:'updated',name:'After',contextWindow:32000,maxTokens:2048,input:['text','image']}]}});
 await prepareEnigmaProfile({dataRoot:profile,modelsFile});const saved=catalog.load();
 expect(saved.providers.gateway.api_key).toBe('fixture-key');expect(saved.providers.gateway.media).toEqual({keep:true});expect(saved.providers.gateway.models.map(m=>m.id)).toEqual(['old','updated']);expect(saved.providers.other).toBeTruthy();expect(saved.meta.deletedProviders).toEqual([]);expect(fs.readFileSync(legacy,'utf8')).toBe('_migrated: true\nproviders: {}\n');
 const projected=path.join(root,'projected.json');syncModels(saved.providers,{modelsJsonPath:projected});
 expect(JSON.parse(fs.readFileSync(projected,'utf8')).providers.gateway.models.find(m=>m.id==='updated')).toMatchObject({input:['text','image'],contextWindow:32000,maxTokens:2048,reasoning:true});
 expect(fs.readdirSync(path.join(profile,'migration-backups')).some(name=>name.startsWith('model-import-'))).toBe(true);
});
it('does not reset existing role choices and picks defaults only from validated imports',async()=>{
 const profile=path.join(root,'profile');await prepareEnigmaProfile({dataRoot:profile});const configPath=path.join(profile,'agents/enigma/config.yaml');const config=YAML.load(fs.readFileSync(configPath,'utf8')) as any;config.models={chat:'existing-chat',utility:{provider:'existing',id:'helper'},utility_large:null};fs.writeFileSync(configPath,YAML.dump(config));
 await prepareEnigmaProfile({dataRoot:profile,modelsFile:source({fresh:{baseUrl:'http://127.0.0.1:9090/v1',models:[{id:'new',reasoning:false}]}})});
 const saved=YAML.load(fs.readFileSync(configPath,'utf8')) as any;expect(saved.models).toEqual({chat:'existing-chat',utility:{provider:'existing',id:'helper'},utility_large:{provider:'fresh',id:'new'}});
});
it('rejects malformed or empty model lists before changing the existing catalog and config',async()=>{
 const profile=path.join(root,'profile');await prepareEnigmaProfile({dataRoot:profile});const catalog=new ProviderCatalogStore(profile);catalog.saveProviders({keep:{models:[{id:'old'}]}});const before=fs.readFileSync(catalog.catalogPath,'utf8'),config=fs.readFileSync(path.join(profile,'agents/enigma/config.yaml'),'utf8');
 for(const providers of [{bad:{baseUrl:'http://localhost',models:[]}},{bad:{baseUrl:'file:///no',models:[{id:'new'}]}},{bad:{baseUrl:'http://localhost',models:[{}]}}]){
  await expect(prepareEnigmaProfile({dataRoot:profile,modelsFile:source(providers)})).rejects.toThrow();expect(fs.readFileSync(catalog.catalogPath,'utf8')).toBe(before);expect(fs.readFileSync(path.join(profile,'agents/enigma/config.yaml'),'utf8')).toBe(config);
 }
});
