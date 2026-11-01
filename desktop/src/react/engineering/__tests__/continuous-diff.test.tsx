// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ContinuousDiff} from '../ContinuousDiff';
import {StrictMode} from 'react';

vi.mock('../DiffReader',()=>({DiffReader:({change,line}:any)=><pre aria-label="Loaded diff">{change.repo}/{change.file}{line?`:${line}`:''}</pre>}));
afterEach(cleanup);
const files=Array.from({length:80},(_,i)=>({repo:i<40?'app':'sdk',file:`module-${i}.ts`,change:'modified',before:{content:'old'},after:{content:'new'}}));
const props={files,version:'fixed',scope:'virtual-files',reviewed:[],onRead:vi.fn(),onVisible:vi.fn()};
it('keeps every file in the reading document while mounting editors only near the viewport',async()=>{
 render(<StrictMode><ContinuousDiff {...props}/></StrictMode>);
 expect(screen.getAllByRole('article')).toHaveLength(80);
 expect(screen.getAllByLabelText('Loaded diff')).toHaveLength(2);
 const scroll=screen.getByLabelText('连续阅读全部差异');
 Object.defineProperty(scroll,'clientHeight',{value:400});
 screen.getAllByRole('article').forEach((node,i)=>{Object.defineProperty(node,'offsetTop',{value:i*500});Object.defineProperty(node,'offsetHeight',{value:300});});
 fireEvent.scroll(scroll,{target:{scrollTop:35000}});
 await waitFor(()=>expect(within(screen.getByRole('article',{name:'变更文件 sdk/module-70.ts'})).getByLabelText('Loaded diff')).toBeVisible());
 expect(screen.getAllByLabelText('Loaded diff').length).toBeLessThanOrEqual(5);
 expect(screen.getByLabelText('module-0.ts 差异按需载入')).toHaveStyle({height:'220px'});
});

it('opens a collapsed file for a source-line navigation, including one far outside the viewport',async()=>{
 const view=render(<ContinuousDiff {...props} scope="source-jump"/>);
 fireEvent.click(screen.getByRole('button',{name:'收起 sdk/module-70.ts'}));
 expect(screen.getByRole('button',{name:'展开 sdk/module-70.ts'})).toHaveAttribute('aria-expanded','false');
 view.rerender(<ContinuousDiff {...props} scope="source-jump" navigation={{key:'sdk:module-70.ts',revision:1,line:1100}}/>);
 expect(screen.getByRole('button',{name:'收起 sdk/module-70.ts'})).toHaveAttribute('aria-expanded','true');
 await waitFor(()=>expect(within(screen.getByRole('article',{name:'变更文件 sdk/module-70.ts'})).getByLabelText('Loaded diff')).toHaveTextContent(':1100'));
});

it('preserves disclosure state when returning to a version, and isolates another scope',()=>{
 const view=render(<ContinuousDiff {...props} scope="closed-state"/>);
 fireEvent.click(screen.getByRole('button',{name:'收起 app/module-0.ts'}));view.unmount();
 const reopened=render(<ContinuousDiff {...props} scope="closed-state"/>);
 expect(screen.getByRole('button',{name:'展开 app/module-0.ts'})).toBeVisible();reopened.unmount();
 render(<ContinuousDiff {...props} scope="different-version"/>);
 expect(screen.getByRole('button',{name:'收起 app/module-0.ts'})).toBeVisible();
});

it('marks the owning file and explains an empty filter instead of showing unrelated changes',()=>{
 const onRead=vi.fn();const view=render(<ContinuousDiff {...props} files={files.slice(40,42)} scope="read-marker" onRead={onRead}/>);
 fireEvent.click(within(screen.getByRole('article',{name:'变更文件 sdk/module-41.ts'})).getByRole('button',{name:'标为已读'}));
 expect(onRead).toHaveBeenCalledWith('sdk:module-41.ts');
 view.rerender(<ContinuousDiff {...props} files={[]} scope="read-marker"/>);
 expect(screen.getByRole('status')).toHaveTextContent('没有匹配');expect(screen.queryByLabelText('Loaded diff')).toBeNull();
});
