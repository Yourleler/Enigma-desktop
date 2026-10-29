// @vitest-environment jsdom
import {expect,it} from 'vitest';
import {findPreviewAnchor,alignPreviewAnchor} from '../../utils/preview-anchor';

it('locates Chinese and punctuation ids only within this preview',()=>{
  const root=document.createElement('div');root.innerHTML='<h2 id="outside">Other region</h2><div class="preview-markdown"><h2 id="安装">安装</h2><h2 id="api:v2">API</h2><h2 id="second-heading">Second</h2></div>';
  expect(findPreviewAnchor(root,'安装')?.textContent).toBe('安装');
  expect(findPreviewAnchor(root,'api:v2')?.textContent).toBe('API');
  expect(findPreviewAnchor(root,'user-content-second-heading')?.textContent).toBe('Second');
  expect(findPreviewAnchor(root,'outside')).toBeNull();
  expect(findPreviewAnchor(root,'x"] script')).toBeNull();
});

it('scrolls its own viewport using actual element geometry',()=>{
  const body=document.createElement('div'),target=document.createElement('h2');body.append(target);body.scrollTop=120;
  body.getBoundingClientRect=()=>({top:80}) as DOMRect;target.getBoundingClientRect=()=>({top:500}) as DOMRect;
  alignPreviewAnchor(body,target);expect(body.scrollTop).toBe(516);
});
