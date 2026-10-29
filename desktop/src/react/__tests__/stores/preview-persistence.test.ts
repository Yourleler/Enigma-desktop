// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { useStore } from '../../stores';
import { buildPersistedWorkspaceUiState, hydratePersistedPreviewItems, schedulePersistCurrentWorkspaceUiState, flushPendingWorkspaceUiState } from '../../stores/workspace-ui-state-actions';
import { normalizeWorkspaceUiEntry } from '../../../../../shared/workspace-ui-state.ts';

const fetchContent = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/use-hana-fetch', () => ({hanaFetch: fetchContent}));

beforeEach(() => {
  document.documentElement.setAttribute('data-platform', 'web');
  useStore.setState({previewItems: [], openTabs: [], activeTabId: null, previewReadingPositions: {}});
  window.platform = {readFile: vi.fn(), sidebarBrowserCommand: vi.fn()} as unknown as Window['platform'];
  fetchContent.mockReset();
});

it('round-trips remote documents, media and browser owners with the selected tab', async () => {
  const ref = {kind: 'workbench-file' as const, mountId: 'demo', subdir: 'docs', name: 'readme.md', contentPath: '/api/workbench/content?mountId=demo&subdir=docs&name=readme.md'};
  useStore.setState({previewItems: [
    {id: 'doc', type: 'markdown', title: 'readme.md', content: 'old', remoteContentRef: ref},
    {id: 'image', type: 'media', title: 'image.svg', content: '', ext: 'svg', mediaRef: {id: 'm1', source: 'desk', path: '', name: 'image.svg', kind: 'svg', resource: {resourceId: 'r1', studioId: 'test', links: {self: '/api/resources/r1', content: '/api/resources/r1/content?ticket=expired'}}}},
    {id: 'web', type: 'browser', title: '网页', content: '', browserSessionPath: '/new/session.jsonl'},
  ], openTabs: ['doc', 'image', 'web'], activeTabId: 'image', previewOpen: true});
  const saved = normalizeWorkspaceUiEntry(buildPersistedWorkspaceUiState('studio:demo'));
  expect(saved.activeTabId).toBe('image'); expect(saved.openTabs).toHaveLength(3);
  fetchContent.mockResolvedValueOnce(new Response('# New content', {status: 200}));
  const restored = await hydratePersistedPreviewItems('studio:demo', {previewTabs: saved.previewTabs});
  expect(restored[0]).toMatchObject({content: '# New content', remoteContentRef: {mountId: 'demo'}});
  expect(restored[1].mediaRef?.resource?.links.content).toBe('/api/resources/r1/content');
  expect(restored[2]).toMatchObject({type: 'browser', browserSessionPath: '/new/session.jsonl'});
  expect(window.platform.readFile).not.toHaveBeenCalled();
  expect(window.platform.sidebarBrowserCommand).not.toHaveBeenCalled();
});

it('preserves an unavailable document for retry and does not discard the remaining tabs', async () => {
  fetchContent.mockResolvedValueOnce(new Response('permission revoked', {status: 403}));
  const items = await hydratePersistedPreviewItems('studio:demo', {previewTabs: [
    {id: 'doc', type: 'markdown', title: 'readme.md', remoteContentRef: {kind: 'workbench-file', mountId: 'demo', subdir: '', name: 'readme.md', contentPath: ''}},
    {id: 'web', type: 'browser', browserSessionPath: null},
  ]});
  expect(items.map(item => item.id)).toEqual(['doc', 'web']);
  expect(items[0].status).toBe('unavailable');
  expect(items[0].remoteContentRef?.name).toBe('readme.md');
});

it('restores legacy relative files through authorized web content and rejects traversal', async () => {
  fetchContent.mockResolvedValueOnce(new Response('restored', {status: 200}));
  const items = await hydratePersistedPreviewItems('/new/workspace', {previewTabs: [
    {id: 'old', relativePath: 'docs/old.md', type: 'markdown'},
    {id: 'escape', relativePath: '../private.md', type: 'markdown'},
  ]});
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({content: 'restored', remoteContentRef: {mountId: 'default', subdir: 'docs', name: 'old.md'}});
  expect(fetchContent).toHaveBeenCalledWith('/api/workbench/content?mountId=default&subdir=docs&name=old.md');
});

it('flushes the latest open tab before the debounce when the page leaves', async () => {
  useStore.setState({serverPort:'14500',serverToken:'fixture-token',deskBasePath:'/new/workspace',previewOpen:true,previewItems:[
    {id:'next',type:'markdown',title:'next.md',content:'',remoteContentRef:{kind:'workbench-file',mountId:'default',subdir:'docs',name:'next.md',contentPath:''}},
  ],openTabs:['next'],activeTabId:'next'});
  fetchContent.mockResolvedValue(new Response('{}',{status:200}));
  schedulePersistCurrentWorkspaceUiState();
  await flushPendingWorkspaceUiState();
  const call=fetchContent.mock.calls.find(([url])=>url==='/api/preferences/workspace-ui-state');
  expect(call?.[1].keepalive).toBe(true);
  expect(JSON.parse(call?.[1].body).state.activeTabId).toBe('next');
  expect(JSON.parse(call?.[1].body).state.previewTabs[0].remoteContentRef.name).toBe('next.md');
});
