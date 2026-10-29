// @vitest-environment jsdom
import {expect,it} from 'vitest';
import {findTextRanges} from '../../utils/text-search-ranges';
it('finds across inline nodes without changing the source DOM or spanning paragraphs',()=>{
 const root=document.createElement('div');root.innerHTML='<p>需要<strong>跨格式</strong><em>匹配</em>的内容</p><p>需要</p><p>跨格式匹配</p>';const original=root.innerHTML;
 const ranges=findTextRanges(root,'需要跨格式匹配');expect(ranges).toHaveLength(1);expect(ranges[0].toString()).toBe('需要跨格式匹配');expect(root.innerHTML).toBe(original);
});
it('keeps original offsets for Unicode case-insensitive search and treats regex input literally',()=>{
 const root=document.createElement('div');root.innerHTML='<p>İ before Match and MATCH plus a.b and axb</p>';
 expect(findTextRanges(root,'match').map(r=>r.toString())).toEqual(['Match','MATCH']);expect(findTextRanges(root,'a.b').map(r=>r.toString())).toEqual(['a.b']);
});
it('ignores non-reading controls and bounds repeated matches',()=>{
 const root=document.createElement('div');root.innerHTML='<p>word word word word</p><button>word</button><p hidden>word</p>';expect(findTextRanges(root,'word')).toHaveLength(4);expect(findTextRanges(root,'word',2)).toHaveLength(2);
});
