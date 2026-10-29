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
