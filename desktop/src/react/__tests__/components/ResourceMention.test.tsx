// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {afterEach,expect,it,vi} from 'vitest';import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {ResourceMentionPicker} from '../../components/input/ResourceMentionPicker';
import {serializeEditor} from '../../utils/editor-serializer';
vi.mock('../../components/chat/RepositoryContext',()=>({useRepositoryContext:()=>({repositories:[{path:'/workspace/api',name:'api',git:true,branch:'main'},{path:'/workspace/docs',name:'docs',git:false,branch:null}],request:{sessionPath:'/s'}})}));
vi.mock('../../hooks/use-hana-fetch',()=>({hanaFetch:vi.fn(async(url)=>new Response(JSON.stringify(String(url).includes('repo=')?{items:[{name:'feature/topic',sha:'fixed-sha',url:'https://github.com/example/repo/tree/feature%2Ftopic'}],nextPage:null}:{items:[{name:'example/repo',branch:'main',url:'https://github.com/example/repo',private:true}],nextPage:null})))}));
afterEach(cleanup);
it('quotes a GitHub branch and fixed commit into the sent message',async()=>{
 const choose=vi.fn();render(<ResourceMentionPicker kind="github" query="" onSelect={choose}/>);fireEvent.click(await screen.findByRole('button',{name:/example\/repo/}));fireEvent.click(await screen.findByRole('button',{name:/feature\/topic/}));
 const item=choose.mock.calls[0][0],payload=serializeEditor({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Read '},{type:'resourceBadge',attrs:{label:item.name,reference:item.reference}},{type:'text',text:' please'}]}]});
 expect(payload.text).toContain('feature/topic');expect(payload.text).toContain('fixed-sha');expect(payload.text).toContain('please');expect(payload.fileRefs).toEqual([]);
});
it('offers both local repositories and plain directories as references',()=>{
 const choose=vi.fn();render(<ResourceMentionPicker kind="repositories" query="docs" onSelect={choose}/>);fireEvent.click(screen.getByRole('button',{name:/docs/}));expect(choose.mock.calls[0][0].reference).toContain('/workspace/docs');expect(screen.queryByRole('button',{name:/api/})).toBeNull();
});
