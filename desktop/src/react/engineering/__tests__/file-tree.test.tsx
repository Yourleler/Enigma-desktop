// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {FileTree} from '../FileTree';
import {engineeringRequest,openEngineering,useEngineering} from '../state';
vi.mock('../state',async load=>({...await load<typeof import('../state')>(),engineeringRequest:vi.fn(),openEngineering:vi.fn()}));
const page={files:['src/first.ts'],totalFiles:6001,totalMatches:6001,offset:0,limit:500,nextOffset:500,version:'version-a'};
beforeEach(()=>{vi.clearAllMocks();useEngineering.setState({sessionPath:'/task',connectionId:'one',snapshot:{overview:{repositories:[{id:'api'},{id:'client'}]}}});});afterEach(cleanup);
it('shows loading rather than a false empty state and searches the server instead of only loaded paths',async()=>{
 let finish!:(value:any)=>void;vi.mocked(engineeringRequest).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue({...page,files:['z/last.ts'],totalMatches:1,nextOffset:null});
 render(<FileTree repo="api"/>);expect(screen.getByRole('status')).toHaveTextContent('正在读取');expect(screen.queryByText('没有匹配的文件')).toBeNull();
 await act(async()=>finish(page));expect(screen.getByText(/共 6001 个文件/)).toBeVisible();
 fireEvent.change(screen.getByRole('textbox',{name:'按路径查找文件'}),{target:{value:'last'}});fireEvent.click(screen.getByRole('button',{name:'查找'}));
 await waitFor(()=>expect(engineeringRequest).toHaveBeenLastCalledWith(expect.stringContaining('query=last'),'/task',undefined,expect.any(AbortSignal)));
 fireEvent.click(await screen.findByRole('button',{name:'打开 z/last.ts'}));expect(openEngineering).toHaveBeenCalledWith(expect.objectContaining({repo:'api',file:'z/last.ts'}));
});
it('keeps page selection tied to its path version and offers a fresh start after a changed file list',async()=>{
 vi.mocked(engineeringRequest).mockResolvedValueOnce(page).mockRejectedValueOnce(new Error('仓库文件列表已变化')).mockResolvedValue({...page,files:['new.ts']});
 await act(async()=>{render(<FileTree repo="api"/>);});fireEvent.click(screen.getByRole('button',{name:'下一页'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('已变化');expect(screen.getByRole('button',{name:'下一页'})).toBeDisabled();
 expect(engineeringRequest).toHaveBeenLastCalledWith(expect.stringContaining('offset=500&limit=500&version=version-a'),'/task',undefined,expect.any(AbortSignal));
 fireEvent.click(screen.getByRole('button',{name:'重新读取列表'}));expect(await screen.findByRole('button',{name:'打开 new.ts'})).toBeVisible();
});
it('ignores late paths from a previous repository',async()=>{
 let finish!:(value:any)=>void;vi.mocked(engineeringRequest).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue({...page,files:['client.ts']});
 render(<FileTree/>);fireEvent.click(screen.getByRole('button',{name:'client'}));await screen.findByRole('button',{name:'打开 client.ts'});
 await act(async()=>finish({...page,files:['wrong.ts']}));expect(screen.queryByRole('button',{name:'打开 wrong.ts'})).toBeNull();
});
