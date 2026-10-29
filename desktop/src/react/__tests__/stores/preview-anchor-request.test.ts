// @vitest-environment jsdom
import {beforeEach,expect,it,vi} from 'vitest';
import {useStore} from '../../stores';
import {openPreview,consumePreviewAnchor,closeTab} from '../../stores/preview-actions';
vi.mock('../../components/SidebarLayout',()=>({updateLayout:vi.fn()}));
vi.mock('../../stores/workspace-ui-state-actions',()=>({schedulePersistCurrentWorkspaceUiState:vi.fn()}));
beforeEach(()=>useStore.setState({previewItems:[],openTabs:[],activeTabId:null,markdownPreviewIds:[],previewAnchorRequests:{}}));

it('opens anchored Markdown in reading mode and a repeated link gets a new request',()=>{
  const item={id:'doc',type:'markdown',title:'target.md',content:'# 安装'};
  openPreview(item,{anchor:'安装'});const first=useStore.getState().previewAnchorRequests.doc;
  expect(useStore.getState().markdownPreviewIds).toContain('doc');expect(first.anchor).toBe('安装');
  openPreview(item,{anchor:'安装'});const second=useStore.getState().previewAnchorRequests.doc;
  expect(second.token).not.toBe(first.token);
  consumePreviewAnchor('doc',first.token);expect(useStore.getState().previewAnchorRequests.doc).toBe(second);
  consumePreviewAnchor('doc',second.token);expect(useStore.getState().previewAnchorRequests.doc).toBeUndefined();
});
it('discards pending navigation when its target tab is closed',()=>{
  openPreview({id:'doc',type:'markdown',title:'target.md',content:'# A'},{anchor:'a'});
  closeTab('doc');expect(useStore.getState().previewAnchorRequests).toEqual({});
});
