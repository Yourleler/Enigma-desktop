// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {focusSettingsSearchResult} from '../focus-search-result';
afterEach(()=>{document.body.innerHTML='';vi.restoreAllMocks();});
it('reveals and focuses the matching setting after delayed content mounts',async()=>{
 const scroll=vi.fn();HTMLElement.prototype.scrollIntoView=scroll;
 const root=document.createElement('div');document.body.append(root);root.innerHTML='<h2>插件市场</h2>';
 const dispose=focusSettingsSearchResult(root,'电脑控制');
 const heading=document.createElement('h2');heading.textContent='电脑控制';root.append(heading);await Promise.resolve();
 expect(document.activeElement).toBe(heading);expect(heading.hasAttribute('data-settings-search-hit')).toBe(true);expect(scroll).toHaveBeenCalledOnce();
 root.append(document.createElement('div'));await Promise.resolve();expect(scroll).toHaveBeenCalledOnce();dispose();expect(heading.hasAttribute('data-settings-search-hit')).toBe(false);
});
it('does not scroll a different label or keep reacting after navigation away',async()=>{
 const scroll=vi.fn();HTMLElement.prototype.scrollIntoView=scroll;
 const root=document.createElement('div');document.body.append(root);root.innerHTML='<h2>电脑控制说明</h2>';
 const dispose=focusSettingsSearchResult(root,'电脑控制');dispose();root.innerHTML='<h2>电脑控制</h2>';await Promise.resolve();expect(scroll).not.toHaveBeenCalled();
});
