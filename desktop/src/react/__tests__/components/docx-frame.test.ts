import {expect,it} from 'vitest';
import {docxFrameHtml} from '../../components/preview/docx-frame';
it('does not let bundled script text terminate the trusted script element',()=>{
 const html=docxFrameHtml({nonce:'test-nonce',zipScript:'/* </script><script>unexpected */',docxScript:'/* library */'});
 expect(html).not.toContain('</script><script>unexpected');
 expect(html).toContain('<\\/script><script>unexpected');
 expect(html).toContain("connect-src 'none'");expect(html).toContain("form-action 'none'");
 expect(html).toContain("img-src data: blob:");expect(html).not.toContain('allow-same-origin');
});
