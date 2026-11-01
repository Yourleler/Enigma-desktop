// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {RelationshipGraph} from '../RelationshipGraph';
import {layoutRelations,GRAPH_NODE_WIDTH,GRAPH_NODE_HEIGHT} from '../graph-layout';

const nodes=Array.from({length:151},(_,i)=>({id:`node-${i}`,role:i%2?'consumer':'implementation',source:{repo:i<75?'api':'client',file:`module-${i}.ts`,line:i+1,symbol:`symbol${i}`}}));
const edges=[{from:'node-0',to:'node-1',confidence:'confirmed',reason:'Actual import binding'},{from:'node-1',to:'node-2',confidence:'candidate',reason:'Dynamic target is uncertain'}];
beforeEach(()=>{vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(800);vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockReturnValue(500);HTMLElement.prototype.scrollTo=vi.fn(function(this:HTMLElement,x?:number|ScrollToOptions,y?:number){this.scrollLeft=typeof x==='number'?x:x?.left||0;this.scrollTop=typeof x==='number'?y||0:x?.top||0;});HTMLElement.prototype.scrollBy=vi.fn();});
afterEach(()=>{cleanup();vi.restoreAllMocks();});

it('retains every node beyond 120, supports cycles and disconnected nodes, and keeps cards separate',()=>{
 const graph=layoutRelations(nodes,[...edges,{from:'node-2',to:'node-1'},{from:'node-2',to:'missing'}]);
 expect(graph.nodes).toHaveLength(151);expect(graph.position.size).toBe(151);expect(graph.missingEdges).toBe(1);expect(graph.cycles).toBe(1);
 expect(graph.position.get('node-1')!.x).toBeGreaterThan(graph.position.get('node-0')!.x);
 expect(graph.position.get('node-1')!.x).toBe(graph.position.get('node-2')!.x);
 const points=[...graph.position.values()];for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++)expect(Math.abs(points[i].x-points[j].x)>=GRAPH_NODE_WIDTH||Math.abs(points[i].y-points[j].y)>=GRAPH_NODE_HEIGHT).toBe(true);
});

it('handles a long directed chain without recursive traversal or silently dropping nodes',()=>{
 const list=Array.from({length:5000},(_,i)=>({id:String(i)}));const links=list.slice(1).map((n,i)=>({from:String(i),to:n.id}));
 const graph=layoutRelations(list,links);expect(graph.position.size).toBe(5000);expect(graph.edges).toHaveLength(4999);
 expect(graph.position.get('4999')!.x).toBeGreaterThan(graph.position.get('4998')!.x);
});

it('finds the last node, shows its real source and clears an empty filter',()=>{
 const onSource=vi.fn();render(<RelationshipGraph nodes={nodes} edges={edges} onSource={onSource}/>);
 expect(screen.getByText('151 / 151 个节点 · 2 条连线')).toBeVisible();
 fireEvent.change(screen.getByRole('textbox',{name:'搜索关系图节点'}),{target:{value:'symbol150'}});
 fireEvent.click(screen.getByRole('button',{name:/symbol150/}));
 expect(screen.getByRole('complementary',{name:'节点关系详情'})).toHaveTextContent('client / module-150.ts:151');
 fireEvent.click(screen.getByRole('button',{name:'查看同版本源码'}));expect(onSource).toHaveBeenCalledWith(nodes[150].source);
 fireEvent.change(screen.getByRole('textbox',{name:'搜索关系图节点'}),{target:{value:'no result'}});
 expect(screen.getByRole('status')).toHaveTextContent('没有匹配节点');fireEvent.click(screen.getByRole('button',{name:'清除筛选'}));
 expect(screen.getByText('151 / 151 个节点 · 2 条连线')).toBeVisible();
});

it('distinguishes candidate and confirmed relationships and restores the workspace after expanded view',async()=>{
 render(<RelationshipGraph nodes={nodes.slice(0,3)} edges={edges} onSource={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:/symbol1/}));const detail=screen.getByRole('complementary',{name:'节点关系详情'});
 expect(detail).toHaveTextContent('Actual import binding');expect(detail).toHaveTextContent('候选关系');expect(detail).toHaveTextContent('Dynamic target is uncertain');
 fireEvent.click(screen.getByRole('button',{name:'放大关系图工作区'}));const dialog=screen.getByRole('dialog',{name:'放大的源码关系图'});
 expect(within(dialog).getByRole('complementary',{name:'节点关系详情'})).toHaveTextContent('symbol1');
 fireEvent.click(within(dialog).getByRole('button',{name:'退出关系图大屏'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(screen.getByRole('button',{name:'放大关系图工作区'})).toBeVisible();
});

it('restores filters and selection after source inspection without carrying them into another reading',()=>{
 const props={nodes: nodes.slice(0,3),edges,onSource:vi.fn()};
 const view=render(<RelationshipGraph {...props} scope="reading-one"/>);
 fireEvent.change(screen.getByRole('textbox',{name:'搜索关系图节点'}),{target:{value:'symbol1'}});
 fireEvent.click(screen.getByRole('button',{name:/symbol1/}));view.unmount();
 const reopened=render(<RelationshipGraph {...props} scope="reading-one"/>);
 expect(screen.getByRole('textbox',{name:'搜索关系图节点'})).toHaveValue('symbol1');
 expect(screen.getByRole('complementary',{name:'节点关系详情'})).toHaveTextContent('symbol1');reopened.unmount();
 render(<RelationshipGraph {...props} scope="reading-two"/>);
 expect(screen.getByRole('textbox',{name:'搜索关系图节点'})).toHaveValue('');expect(screen.queryByRole('complementary',{name:'节点关系详情'})).toBeNull();
});
