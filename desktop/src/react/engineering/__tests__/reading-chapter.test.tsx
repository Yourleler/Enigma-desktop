// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ReadingChapter} from '../ReadingChapter';
afterEach(cleanup);
it('shows compact source rows, searches all nodes and opens the selected source',()=>{
  const nodes=Array.from({length:139},(_,i)=>({id:'n'+i,source:{repo:'r',file:`f${i}.ts`,line:1,snippet:`export const item${i} = ${i};`}})),onSource=vi.fn();
  const {container}=render(<ReadingChapter chapter={{id:'chapter',title:'Behavior',summary:'Read the behavior',authority:'model-inference',nodes:nodes.map(n=>n.id)}} nodes={nodes} index={0} onSource={onSource}/>);
  expect(container.querySelectorAll('pre')).toHaveLength(0);
  expect(container.querySelectorAll('.enigma-chapter-source')).toHaveLength(8);
  fireEvent.change(screen.getByRole('textbox',{name:'查找本章来源 Behavior'}),{target:{value:'item138'}});
  fireEvent.click(screen.getByRole('button',{name:'r / f138.ts:1'}));
  expect(screen.getByText('export const item138 = 138;')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'查看差异'}));expect(onSource).toHaveBeenCalledWith(nodes[138]!.source);
});
it('makes all sources reachable without silently truncating a long chapter',()=>{
  const nodes=Array.from({length:39},(_,i)=>({id:'n'+i,source:{repo:'r',file:`f${i}`,line:1,snippet:''}}));
  const {container}=render(<ReadingChapter chapter={{id:'chapter',title:'All sources',summary:'All',nodes:nodes.map(n=>n.id)}} nodes={nodes} index={0} onSource={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:/继续显示来源/}));fireEvent.click(screen.getByRole('button',{name:/继续显示来源/}));
  expect(container.querySelectorAll('.enigma-chapter-source')).toHaveLength(39);
});
