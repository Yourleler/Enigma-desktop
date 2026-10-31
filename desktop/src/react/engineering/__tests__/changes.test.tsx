// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import{cleanup,fireEvent,render,screen,waitFor}from'@testing-library/react';
import{afterEach,beforeEach,expect,it}from'vitest';
import{Changes}from'../Changes';
import {EditorView} from '@codemirror/view';
import{useEngineering}from'../state';
import{useStore}from'../../stores';
beforeEach(()=>{useEngineering.setState({sections:{},sessionPath:'',snapshot:{state:{idle:true},actions:[]}});useStore.setState({sessionPermissionMode:'ask'});});afterEach(cleanup);
const record=(changes:any[])=>({changeReading:{matchesWorkspace:true,record:{input:{kind:'staged',goal:'Review changes'},status:'ready',version:'0123456789',changes,gaps:[],reading:{nodes:[],chapters:[{id:'entry',title:'entry',summary:'English navigation hint',authority:'navigation-hint',nodes:[]}],architecture:[]}}}});
it('uses keyboard-accessible tabs and makes static chapter roles readable',()=>{
 render(<Changes value={record([])} files={<p>Current files</p>}/>);
 expect(screen.getByText('入口与调用')).toBeVisible();expect(screen.queryByText('English navigation hint')).not.toBeInTheDocument();
 fireEvent.keyDown(screen.getByRole('tab',{name:'智能阅读'}),{key:'ArrowRight'});expect(screen.getByRole('tab',{name:'项目文件'})).toHaveFocus();expect(screen.getByText('Current files')).toBeVisible();
 expect(screen.queryByRole('button',{name:'生成阅读'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('tab',{name:'智能阅读'}));expect(screen.getByRole('button',{name:'生成阅读'})).toBeVisible();
});
it('shows truncation explicitly and expands the complete retained version without changing source',async()=>{
 const text='line\n'.repeat(25000)+'TAIL_SENTINEL\n';render(<Changes value={record([{repo:'api',file:'large.txt',change:'added',patch:text.slice(0,120000),patchTruncated:true,after:{content:text}}])} files={null}/>);
 fireEvent.click(screen.getByRole('tab',{name:'全量 diff'}));
 await waitFor(()=>{const editors=[...document.querySelectorAll('.cm-editor')].map(e=>EditorView.findFromDOM(e as HTMLElement));expect(editors.some(e=>e?.state.doc.toString().includes('TAIL_SENTINEL'))).toBe(true);});
 expect(screen.getByRole('button',{name:'双栏'})).toBeVisible();
 expect(screen.queryByRole('button',{name:'显示完整差异'})).not.toBeInTheDocument();
});
it('filters a large changed-file list by its full repository path',()=>{
 render(<Changes value={record(Array.from({length:12},(_,i)=>({repo:'api',file:`src/file-${i}.ts`,change:'modified',patch:'test'})))} files={null}/>);
 fireEvent.click(screen.getByRole('tab',{name:'全量 diff'}));fireEvent.change(screen.getByLabelText('筛选变更文件'),{target:{value:'api/src/file-11'}});
 expect(screen.getByRole('navigation',{name:'变更文件'}).querySelectorAll('button')).toHaveLength(1);expect(screen.getByRole('button',{name:/file-11.ts/})).toBeVisible();
});
