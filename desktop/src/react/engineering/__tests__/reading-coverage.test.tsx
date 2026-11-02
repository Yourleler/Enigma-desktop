// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ReadingCoverage} from '../ReadingCoverage';
import {readingText} from '../reading-copy';
afterEach(cleanup);
it('keeps coverage separate from acceptance and lets readers reach files after the first page',()=>{
 const files=Array.from({length:85},(_,i)=>({repo:'r',file:`doc-${i}.txt`,status:'excerpt',partial:i===84}));
 files.push({repo:'r',file:'removed.txt',status:'deleted',partial:false});const onSource=vi.fn();
 render(<ReadingCoverage reading={{sourceCoverage:{files,outlineFiles:{examined:24,total:86},symbolQueries:{completed:0,limit:20,pending:0}},gaps:[]}} onSource={onSource}/>);
 fireEvent.click(screen.getByText('源码展开范围 · 85 / 86 个变更文件有片段'));
 expect(screen.getByText(/拿到源码片段不代表完整审查/)).toBeVisible();expect(screen.queryByRole('button',{name:'r / doc-84.txt'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:/继续显示文件范围/}));fireEvent.click(screen.getByRole('button',{name:/继续显示文件范围/}));
 expect(screen.getByText('文本片段 · 片段有截断')).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'r / removed.txt'}));
 expect(onSource).toHaveBeenCalledWith({repo:'r',file:'removed.txt',line:1,side:'baseline'});
});
it('does not infer complete coverage from a legacy record or treat advisory grouping as execution',()=>{
 render(<ReadingCoverage reading={{truncated:true,nodes:[{id:'n'}],gaps:['Further source expansion remains outside the query budget.']}}/>);
 fireEvent.click(screen.getByText('源码展开范围 · 仍有未展开内容'));
 expect(screen.getByText(/旧记录没有保存逐文件展开范围/)).toBeVisible();
 fireEvent.click(screen.getByText('未展开范围与诊断 · 1'));expect(screen.getByText('还有源码关系未在本次查询额度内展开。')).toBeVisible();
 expect(readingText('Source-backed contract locations; expand each node for actual code.')).toContain('接口契约');
 expect(readingText('chapters: 7 published source nodes are not included in the chosen grouping; they remain available in the full map.')).toContain('7 个已记录节点');
});

it('distinguishes synthesis from source requests and retains original batch navigation',()=>{
 const onSource=vi.fn(),source={repo:'r',file:'source.ts',line:4};
 render(<ReadingCoverage reading={{nodes:[{id:'n',source}],modelCoverage:{status:'complete',requests:2,completedRequests:2,plannedRequests:2,nodes:1,totalNodes:1,changes:1,totalChanges:1,edges:0,totalEdges:0},modelSynthesis:{status:'complete',requests:1,sourceBatches:2,nodes:1,edges:0,chapters:[{id:'original',title:'Original explanation',summary:'Original evidence',nodes:['n']}],insights:[]}}} onSource={onSource}/>);
 fireEvent.click(screen.getByText(/源码展开范围/));expect(screen.getByText(/整理额外发起 1 次/)).toBeVisible();
 const original=screen.getByText(/查看各批原始解读/).closest('details')!;original.open=true;fireEvent(original,new Event('toggle'));
 fireEvent.click(screen.getByRole('button',{name:'r / source.ts:4'}));expect(onSource).toHaveBeenCalledWith(source);
});
