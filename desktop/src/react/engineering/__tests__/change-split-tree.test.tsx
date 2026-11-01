// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ChangeFileTree,changeTree} from '../ChangeFileTree';
import {ChangeSplitPane} from '../ChangeSplitPane';
afterEach(()=>{cleanup();localStorage.clear();});
it('groups shared directories under one tree and preserves identical filenames across repositories',()=>{
 const files=[{repo:'a',file:'src/one.ts',change:'modified'},{repo:'a',file:'src/nested/two.ts',change:'added'},{repo:'b',file:'src/one.ts',change:'deleted'}];
 expect(changeTree(files.filter(f=>f.repo==='a')).children.get('src')?.children.size).toBe(2);
 const select=vi.fn();render(<ChangeFileTree files={files} roots={[{id:'a',name:'api'},{id:'b',name:'client'}]} repositories={[]} input={{source:'conversation'}} selected="a:src/one.ts" reviewed={[]} onSelect={select} onSource={vi.fn()} query="" onQuery={vi.fn()} flat={false} onFlat={vi.fn()}/>);
 fireEvent.click(screen.getAllByRole('button',{name:/one.ts/})[1]);expect(select).toHaveBeenCalledWith(files[2]);
 expect(screen.getAllByRole('button',{name:/one.ts/})[0]).toHaveAttribute('aria-current','true');
});
it('keeps Git status and commit selection inside each repository tree',()=>{
 const select=vi.fn();render(<ChangeFileTree files={[]} roots={[{id:'api'}]} repositories={[{id:'api',name:'api',branch:'main',commits:[{id:'abc',title:'First'}],state:{staged:['x'],unstaged:['x'],untracked:[],conflicts:[]}}]} input={{source:'git',kind:'commit',repo:'api',target:{api:'abc'}}} selected="" reviewed={[]} onSelect={vi.fn()} onSource={select} query="" onQuery={vi.fn()} flat={false} onFlat={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'api 未暂存'}));expect(select).toHaveBeenCalledWith('api','unstaged');
 fireEvent.click(screen.getByRole('button',{name:'查看提交 First (abc)'}));expect(select).toHaveBeenCalledWith('api','commit','abc');
});
it('resizes with keyboard, resets and restores the tree without removing its content',()=>{
 render(<ChangeSplitPane tree={<p>Tree</p>}><p>Diff</p></ChangeSplitPane>);
 const splitter=screen.getByRole('separator',{name:'调整变更文件列表宽度'});
 fireEvent.keyDown(splitter,{key:'ArrowRight'});expect(localStorage.getItem('enigma-change-tree-width')).toBe('216');
 fireEvent.doubleClick(splitter);expect(localStorage.getItem('enigma-change-tree-width')).toBe('200');
 fireEvent.click(screen.getByRole('button',{name:'收起变更文件列表'}));expect(screen.getByText('Tree')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'显示变更文件列表'}));expect(screen.getByText('Diff')).toBeVisible();
});
