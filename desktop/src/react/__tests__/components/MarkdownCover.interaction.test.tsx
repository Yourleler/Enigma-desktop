// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {PreviewRenderer} from '../../components/preview/PreviewRenderer';
import {useStore} from '../../stores';
import type {PreviewItem} from '../../types';
const source='---\ncover:\n  image: cover.svg\n  displayHeight: 280\n---\n# Body\nPreserve the text.\n';
const item:PreviewItem={id:'cover-test',type:'markdown',title:'note.md',filePath:'/tmp/cover-test/note.md',content:source,fileVersion:{mtimeMs:1,size:source.length,sha256:'old'}};
const write=vi.fn();
beforeEach(()=>{
 vi.stubGlobal('PointerEvent',MouseEvent);window.t=((key:string)=>key) as typeof window.t;
 write.mockReset().mockResolvedValue({ok:true,version:{mtimeMs:2,size:source.length,sha256:'new'}});
 window.platform={getFileUrl:(p:string)=>`file://${p}`,writeFileIfUnchanged:write,readFileSnapshot:async()=>({content:source,version:item.fileVersion})} as never;
 useStore.setState({previewItems:[item],activeServerConnection:null,activeServerConnectionId:null,serverConnections:{},serverPort:'3199'});
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('cancels a resized preview cover without writing the file',async()=>{
 const view=render(<PreviewRenderer previewItem={item}/>),handle=view.container.querySelector('.markdown-cover-resize')!;
 fireEvent.pointerDown(handle,{button:0,clientY:100});fireEvent.pointerMove(window,{clientY:180});
 fireEvent.pointerCancel(window,{clientY:180});await act(async()=>{});
 expect(write).not.toHaveBeenCalled();expect(view.container.querySelector('.markdown-cover')).toHaveStyle({height:'280px'});
});
it('does not write a cover on a click with no movement',async()=>{
 const view=render(<PreviewRenderer previewItem={item}/>),handle=view.container.querySelector('.markdown-cover-resize')!;
 fireEvent.pointerDown(handle,{button:0,clientY:100});fireEvent.pointerUp(window,{clientY:100});await act(async()=>{});
 expect(write).not.toHaveBeenCalled();
});
it.each(['escape','blur'])('cancels a cover drag on %s and retains the original height',async kind=>{
 const view=render(<PreviewRenderer previewItem={item}/>),handle=view.container.querySelector('.markdown-cover-resize')!;
 fireEvent.pointerDown(handle,{button:0,clientY:100});fireEvent.pointerMove(window,{clientY:190});
 if(kind==='escape')fireEvent.keyDown(window,{key:'Escape'});else fireEvent.blur(window);
 fireEvent.pointerUp(window,{clientY:190});await act(async()=>{});
 expect(write).not.toHaveBeenCalled();expect(view.container.querySelector('.markdown-cover')).toHaveStyle({height:'280px'});
});
it('supports keyboard resizing and keeps a failed save visible for retry',async()=>{
 write.mockRejectedValueOnce(new Error('Write unavailable'));
 const view=render(<PreviewRenderer previewItem={item}/>),handle=screen.getByRole('separator',{name:'调整封面高度'});
 fireEvent.keyDown(handle,{key:'ArrowDown'});expect(await screen.findByRole('alert')).toHaveTextContent('Write unavailable');
 expect(view.container.querySelector('.markdown-cover')).toHaveStyle({height:'280px'});
 fireEvent.click(screen.getByRole('button',{name:'重试保存封面'}));await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());
 expect(write).toHaveBeenCalledTimes(2);expect(write.mock.calls[1][1]).toContain('displayHeight: 296');
});
