// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {DeskSearchBox} from '../../components/desk/DeskToolbar';
import {useStore} from '../../stores';
import {searchDeskFiles} from '../../stores/desk-actions';
vi.mock('../../stores/desk-actions',()=>({searchDeskFiles:vi.fn(),deskNativeRootDir:()=>null,jumpToDeskSearchResult:vi.fn(),loadDeskFiles:vi.fn()}));
beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();window.t=((key:string)=>key) as any;useStore.setState({deskBasePath:'/a',deskWorkspaceMountId:null,currentSessionPath:'/session/a',activeServerConnectionId:'local'});});
afterEach(()=>{cleanup();vi.useRealTimers();});
it('ignores results from the previous directory and clears its search when switching',async()=>{
 let resolve!:(v:any)=>void;vi.mocked(searchDeskFiles).mockImplementation(()=>new Promise(r=>{resolve=r;}));render(<DeskSearchBox/>);
 fireEvent.change(screen.getByRole('textbox'),{target:{value:'old'}});await act(async()=>{await vi.advanceTimersByTimeAsync(181);});
 act(()=>useStore.setState({deskBasePath:'/b'}));await act(async()=>resolve([{name:'old.ts',relativePath:'old.ts',parentSubdir:'',isDir:false}]));
 expect(screen.getByRole('textbox')).toHaveValue('');expect(screen.queryByText('old.ts')).toBeNull();expect(screen.queryByRole('listbox')).toBeNull();
});
it('distinguishes a failed search from an empty result and retries the same query',async()=>{
 vi.mocked(searchDeskFiles).mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce([]);render(<DeskSearchBox/>);
 fireEvent.change(screen.getByRole('textbox'),{target:{value:'readme'}});await act(async()=>{await vi.advanceTimersByTimeAsync(181);});
 expect(screen.getByRole('alert')).toHaveTextContent('文件搜索暂时失败');expect(screen.queryByText('desk.search.empty')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'重试搜索'}));await act(async()=>{await vi.advanceTimersByTimeAsync(181);});
 expect(screen.queryByRole('alert')).toBeNull();expect(screen.getByText('desk.search.empty')).toBeVisible();expect(searchDeskFiles).toHaveBeenLastCalledWith('readme',{throwOnError:true});
});
