import {createRequire} from 'node:module';
import {expect,it} from 'vitest';
const require=createRequire(import.meta.url),{productIdentity}=require('../shared/enigma-product.cjs'),overlay=require('../build/enigma-electron-builder.cjs');
it('isolates Enigma app/data/update identity while preserving upstream defaults for upstream runtime',()=>{
  const product=productIdentity({ENIGMA_DESKTOP_PRODUCT:'1'}),upstream=productIdentity({});
  expect(product.name).toBe('Enigma');expect(product.appId).toBe(overlay.appId);expect(product.home).toMatch(/\.enigma-desktop$/);expect(product.owner).toBe('Yourleler');expect(product.repository).toBe('Enigma-desktop');expect(product.inviteApi).toBe('');
  expect(upstream.appId).toBe('com.hanako.app');expect(upstream.home).toMatch(/\.hanako$/);expect(productIdentity({}, {enigmaProduct:true}).appId).toBe(product.appId);
  expect(overlay.publish[0].repo).toBe(product.repository);expect(overlay.directories.output).toBe('dist-enigma');
});
