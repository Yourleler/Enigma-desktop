// @vitest-environment jsdom
import {expect,it} from 'vitest';
import {completeDocxPageGeometry} from '../../components/preview/docx-page-geometry';
it('supplies readable paper and margins for an otherwise valid minimal document',()=>{
 const root=document.createElement('div');root.innerHTML='<section class="docx"><p>新建文档</p></section>';
 expect(completeDocxPageGeometry(root)).toBe(1);const page=root.querySelector('section')!;expect(page.style.width).toBe('210mm');expect(page.style.minHeight).toBe('297mm');expect(page.style.paddingLeft).toBe('25.4mm');expect(page.textContent).toBe('新建文档');expect(completeDocxPageGeometry(root)).toBe(0);
});
it('preserves explicit landscape size and zero margins',()=>{
 const root=document.createElement('div');root.innerHTML='<section class="docx" style="width:297mm;min-height:210mm;padding:0px"><p>Landscape</p></section>';const before=root.innerHTML;expect(completeDocxPageGeometry(root)).toBe(0);expect(root.innerHTML).toBe(before);
});
it('fills only missing values in mixed sections',()=>{
 const root=document.createElement('div');root.innerHTML='<section class="docx" style="width:612pt;min-height:792pt;padding-left:0px;padding-right:48pt"></section><section class="docx" style="width:297mm;height:210mm;padding:20mm"></section>';
 expect(completeDocxPageGeometry(root)).toBe(1);const page=root.querySelector('section')!;expect(page.style.width).toBe('612pt');expect(page.style.minHeight).toBe('792pt');expect(page.style.paddingLeft).toBe('0px');expect(page.style.paddingRight).toBe('48pt');expect(page.style.paddingTop).toBe('25.4mm');expect(root.querySelectorAll('section')[1].style.minHeight).toBe('');
});
