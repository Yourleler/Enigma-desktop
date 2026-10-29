import {expect,it} from 'vitest';
import {versionedUiReferences} from '../scripts/versioned-ui-references.mjs';
it('busts old immutable bootstrap URLs without modifying hashed or external references',()=>{
 const input='<html><head><link href="themes/warm.css"><script src="lib/theme.js"></script><script src="./lib/i18n.js"></script><script src="assets/mobile-12345678.js"></script><script src="https://example.test/lib/other.js"></script></head></html>';
 const output=versionedUiReferences(input,'0.452.126');expect(output).toContain('href="themes/warm.css?v=0.452.126"');expect(output).toContain('src="lib/theme.js?v=0.452.126"');expect(output).toContain('name="enigma-ui-version"');expect(output).toContain('src="assets/mobile-12345678.js"');expect(output).toContain('src="https://example.test/lib/other.js"');expect(versionedUiReferences(output,'0.452.126')).toBe(output);expect(versionedUiReferences(output,'0.452.127')).not.toContain('0.452.126');
});
it('rejects non-version input before it can enter HTML',()=>{expect(()=>versionedUiReferences('<head>','bad"value')).toThrow();});
