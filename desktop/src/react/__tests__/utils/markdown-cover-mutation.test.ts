// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mutateMarkdownCover} from '../../utils/markdown-cover-mutation';
import {parseMarkdownCover} from '../../utils/markdown-cover';
import {useStore} from '../../stores';
import type {PreviewItem} from '../../types';
const content='---\ncover:\n  image: cover.svg\n  displayHeight: 280\n---\n# Original body';
const item:PreviewItem={id:'cover',type:'markdown',title:'note.md',filePath:'/tmp/cover-note.md',content,fileVersion:{mtimeMs:1,size:content.length}};
let disk:string,version:number;const write=vi.fn(),read=vi.fn();
beforeEach(()=>{
 disk=content;version=1;read.mockReset().mockImplementation(async()=>({content:disk,version:{mtimeMs:version,size:disk.length}}));
 write.mockReset().mockImplementation(async(_path,next,expected)=>{if(expected.mtimeMs!==version)return{ok:false,conflict:true};disk=next;version++;return{ok:true,version:{mtimeMs:version,size:disk.length}};});
 window.platform={readFileSnapshot:read,writeFileIfUnchanged:write} as never;useStore.setState({previewItems:[item],activeServerConnection:null,activeServerConnectionId:null,serverConnections:{},serverPort:'3199'});
});
afterEach(()=>vi.restoreAllMocks());
it('serializes rapid changes so the later layout remains the final one',async()=>{
 let finish!:()=>void;write.mockImplementationOnce((_path,next)=>new Promise(resolve=>{finish=()=>{disk=next;version++;resolve({ok:true,version:{mtimeMs:version,size:disk.length}});};}));
 const first=mutateMarkdownCover(item,{kind:'layout',layout:{displayHeight:320}}),second=mutateMarkdownCover(item,{kind:'layout',layout:{displayHeight:420}});
 await vi.waitFor(()=>expect(write).toHaveBeenCalledTimes(1));finish();await Promise.all([first,second]);
 expect(write).toHaveBeenCalledTimes(2);expect(parseMarkdownCover(disk)?.displayHeight).toBe(420);expect(disk).toContain('# Original body');
});
it('preserves concurrent body edits when retrying a version conflict',async()=>{
 write.mockImplementationOnce(async()=>{disk=content+'\nUser addition';version++;return{ok:false,conflict:true};});
 await mutateMarkdownCover(item,{kind:'layout',layout:{displayHeight:350}});
 expect(disk).toContain('User addition');expect(parseMarkdownCover(disk)?.displayHeight).toBe(350);
});
it('does not modify a newly replaced cover, or write after connection changes',async()=>{
 disk=content.replace('cover.svg','new-image.svg');await expect(mutateMarkdownCover(item,{kind:'remove'})).rejects.toThrow('已被更换');expect(write).not.toHaveBeenCalled();
 let finish!:(value:any)=>void;read.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));const pending=mutateMarkdownCover(item,{kind:'remove'});
 await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));useStore.setState({serverPort:'3200'});finish({content,version:item.fileVersion});await expect(pending).resolves.toBeNull();expect(write).not.toHaveBeenCalled();
});
it('does not replace an unsaved cached body or recreate a cleared preview after saving',async()=>{
 useStore.setState({previewItems:[{...item,content:content+'\nUnsaved draft'}]});await mutateMarkdownCover(item,{kind:'layout',layout:{displayHeight:320}});expect(useStore.getState().previewItems[0].content).toContain('Unsaved draft');
 let finish!:()=>void;write.mockImplementationOnce((_path,next)=>new Promise(resolve=>{finish=()=>resolve({ok:true,version:{mtimeMs:++version,size:next.length}});}));
 const pending=mutateMarkdownCover(item,{kind:'remove'});await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));useStore.setState({previewItems:[]});finish();await pending;expect(useStore.getState().previewItems).toEqual([]);
});
