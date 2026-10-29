// @vitest-environment jsdom
import {beforeEach,expect,it,vi} from 'vitest';
import {openFilePreview} from '../../utils/file-preview';
import {useStore} from '../../stores';
import {closePreview} from '../../stores/preview-actions';
vi.mock('../../components/SidebarLayout',()=>({updateLayout:vi.fn()}));
vi.mock('../../stores/workspace-ui-state-actions',()=>({schedulePersistCurrentWorkspaceUiState:vi.fn()}));
vi.mock('../../utils/ui-helpers',()=>({showError:vi.fn()}));
beforeEach(()=>useStore.setState({previewItems:[],openTabs:[],activeTabId:null,markdownPreviewIds:[],previewAnchorRequests:{},previewOpen:false}));
const snapshot=(text:string)=>({content:text,version:{mtimeMs:1,size:text.length}});
it('keeps the latest selected file when an earlier read finishes last',async()=>{
  let resolveSlow!:(value:unknown)=>void;
  window.platform={readFileSnapshot:vi.fn((file:string)=>file==='/new/slow.md'?new Promise(resolve=>{resolveSlow=resolve}):Promise.resolve(snapshot('# Latest')))} as unknown as Window['platform'];
  const slow=openFilePreview('/new/slow.md','slow.md','md',{origin:'desk',anchor:'old'});
  await openFilePreview('/new/fast.md','fast.md','md',{origin:'desk',anchor:'latest'});
  resolveSlow(snapshot('# Old'));await slow;
  expect(useStore.getState().activeTabId).toBe('file-/new/fast.md');
  expect(useStore.getState().previewAnchorRequests['file-/new/fast.md'].anchor).toBe('latest');
  expect(useStore.getState().previewAnchorRequests['file-/new/slow.md']).toBeUndefined();
});
it('does not reopen the panel when it is closed while a file is loading',async()=>{
  let finish!:(value:unknown)=>void;
  window.platform={readFileSnapshot:vi.fn(()=>new Promise(resolve=>{finish=resolve}))} as unknown as Window['platform'];
  useStore.setState({previewOpen:true});const pending=openFilePreview('/new/slow.md','slow.md','md',{origin:'desk'});
  closePreview();finish(snapshot('# Old'));await pending;
  expect(useStore.getState().previewOpen).toBe(false);expect(useStore.getState().activeTabId).toBeNull();
});
it('does not bring the previous workspace file into a later workspace',async()=>{
  let finish!:(value:unknown)=>void;
  window.platform={readFileSnapshot:vi.fn(()=>new Promise(resolve=>{finish=resolve}))} as unknown as Window['platform'];
  useStore.setState({deskBasePath:'/workspace/a'});
  const pending=openFilePreview('/workspace/a/slow.md','slow.md','md',{origin:'desk'});
  useStore.setState({deskBasePath:'/workspace/b'});finish(snapshot('# Old'));await pending;
  expect(useStore.getState().activeTabId).toBeNull();
});
