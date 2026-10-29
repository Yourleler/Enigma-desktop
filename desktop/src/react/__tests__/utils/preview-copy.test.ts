// @vitest-environment jsdom
import {expect,it} from 'vitest';
import {previewCopyText} from '../../utils/preview-copy';
it('copies office text with rows and columns instead of HTML tags',()=>{
  expect(previewCopyText('<p>标题</p><table><tr><td>甲</td><td>3</td></tr><tr><td>乙</td><td>4</td></tr></table><script>secret</script>','xlsx')).toBe('标题\n甲\t3\n乙\t4');
  expect(previewCopyText('const a = 1;','code')).toBe('const a = 1;');
});
