/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore, type StoreState } from '../../stores';
import type { DeskFile, RemoteWorkbenchContentRef } from '../../types';
import type { FileRef } from '../../types/file-ref';

const mockHanaFetch = vi.hoisted(() => vi.fn());
const mockOpenFilePreview = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('../../hooks/use-hana-fetch', () => ({
  hanaFetch: mockHanaFetch,
}));

vi.mock('../../utils/file-preview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/file-preview')>();
  return {
    ...actual,
    openFilePreview: mockOpenFilePreview,
  };
});

describe('remote file preview workbench refs', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-platform');
    useStore.setState({
      previewItems: [],
      openTabs: [],
      activeServerConnection: null,
      activeServerConnectionId: null,
      serverConnections: {},
      serverPort: '62950',
      serverToken: 'local-token',
    } as Partial<StoreState>);
    mockHanaFetch.mockReset();
    mockOpenFilePreview.mockClear();
    mockHanaFetch.mockResolvedValue({
      json: async () => ({ ok: true, version: { mtimeMs: 1, size: 4 } }),
    });
  });

  it('saves remote workbench content by mountId instead of producing a legacy rootId-only request', async () => {
    const { saveRemoteWorkbenchContent } = await import('../../utils/remote-file-preview');
    const ref: RemoteWorkbenchContentRef = {
      kind: 'workbench-file',
      mountId: 'mount_docs',
      subdir: 'notes',
      name: 'remote.md',
      contentPath: '/api/workbench/content?mountId=mount_docs&subdir=notes&name=remote.md',
    };

    await saveRemoteWorkbenchContent(ref, 'body');

    expect(mockHanaFetch).toHaveBeenCalledWith(
      '/api/workbench/actions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          action: 'writeText',
          mountId: 'mount_docs',
          subdir: 'notes',
          name: 'remote.md',
          content: 'body',
          expectedVersion: null,
        }),
      }),
    );
    expect(String(mockHanaFetch.mock.calls[0][1].body)).not.toContain('"rootId"');
  });

  it('retries remote workbench refresh when the first cache-busted read is unchanged', async () => {
    const { refreshPreviewItemsFromRemoteWorkbenchTarget } = await import('../../utils/remote-file-preview');
    const target: RemoteWorkbenchContentRef = {
      kind: 'workbench-file',
      mountId: 'mount_docs',
      subdir: 'notes',
      name: 'remote.md',
      contentPath: '/api/workbench/content?mountId=mount_docs&subdir=notes&name=remote.md',
      version: { mtimeMs: 2, size: 8 },
    };
    useStore.setState({
      previewItems: [{
        id: 'remote-note',
        type: 'markdown',
        title: 'remote.md',
        content: 'old',
        storageKind: 'remote-content',
        remoteContentRef: {
          ...target,
          version: { mtimeMs: 1, size: 3 },
        },
      }],
    } as Partial<StoreState>);
    mockHanaFetch
      .mockResolvedValueOnce(new Response('old', { status: 200 }))
      .mockResolvedValueOnce(new Response('new', { status: 200,headers:{'X-Hana-File-MtimeMs':'2','X-Hana-File-Size':'3'} }));

    await refreshPreviewItemsFromRemoteWorkbenchTarget(target, {
      retryUnchanged: true,
      retryDelaysMs: [0],
    });

    const item = useStore.getState().previewItems[0];
    expect(mockHanaFetch).toHaveBeenCalledTimes(2);
    expect(item.content).toBe('new');
    expect(item.fileVersion).toEqual({ mtimeMs: 2, size: 3 });
    expect(item.remoteContentRef?.version).toEqual({ mtimeMs: 2, size: 3 });
  });

  it('does not give unversioned response bytes the newer timestamp from a watcher',async()=>{
    const {refreshPreviewItemsFromRemoteWorkbenchTarget}=await import('../../utils/remote-file-preview');
    const target:RemoteWorkbenchContentRef={kind:'workbench-file',mountId:'docs',subdir:'',name:'note.md',contentPath:'/content',version:{mtimeMs:9,size:12}};
    const item={id:'note',type:'markdown',title:'note',content:'verified old',fileVersion:{mtimeMs:1,size:12},remoteContentRef:target};useStore.setState({previewItems:[item]});
    mockHanaFetch.mockResolvedValueOnce(new Response('unversioned data',{status:200}));await refreshPreviewItemsFromRemoteWorkbenchTarget(target);
    expect(useStore.getState().previewItems[0]).toMatchObject({content:'verified old',fileVersion:{mtimeMs:1,size:12},loadError:expect.stringContaining('没有取得对应文件版本')});
  });

  it('keeps cleared previews and another connection untouched by a late remote read',async()=>{
    const {refreshPreviewItemsFromRemoteWorkbenchTarget}=await import('../../utils/remote-file-preview');
    const target:RemoteWorkbenchContentRef={kind:'workbench-file',mountId:'docs',subdir:'',name:'note.md',contentPath:'/content'};
    const item={id:'note',type:'markdown',title:'note',content:'old',remoteContentRef:target};useStore.setState({previewItems:[item]});let done!:(value:Response)=>void;
    mockHanaFetch.mockImplementationOnce(()=>new Promise(resolve=>{done=resolve;}));const pending=refreshPreviewItemsFromRemoteWorkbenchTarget(target);
    useStore.setState({previewItems:[],serverPort:'11111'});done(new Response('late',{headers:{'X-Hana-File-MtimeMs':'2','X-Hana-File-Size':'4'}}));await pending;
    expect(useStore.getState().previewItems).toEqual([]);
  });

  it('uses the content response version when opening a remote workbench document', async () => {
    const { openMobileWorkbenchPreview } = await import('../../utils/remote-file-preview');
    const staleListVersion = new Date('2026-06-20T00:00:00.000Z').toISOString();
    const file: DeskFile = {
      name: 'remote.md',
      isDir: false,
      mtime: staleListVersion,
      size: 0,
    };
    mockHanaFetch.mockResolvedValueOnce(new Response('# fresh\n', {
      status: 200,
      headers: {
        'X-Hana-File-MtimeMs': '1781989413542',
        'X-Hana-File-Size': '8',
      },
    }));

    await openMobileWorkbenchPreview({
      mountId: 'mount_docs',
      subdir: 'notes',
      file,
    });

    const item = useStore.getState().previewItems[0];
    expect(item.content).toBe('# fresh\n');
    expect(item.fileVersion).toEqual({ mtimeMs: 1781989413542, size: 8 });
    expect(item.remoteContentRef?.version).toEqual({ mtimeMs: 1781989413542, size: 8 });
  });

  it('refreshes DOCX version metadata without running the semantic converter',async()=>{
    const {refreshPreviewItemsFromRemoteWorkbenchTarget}=await import('../../utils/remote-file-preview');
    const target:RemoteWorkbenchContentRef={kind:'workbench-file',mountId:'docs',subdir:'',name:'new.docx',contentPath:'/api/workbench/content?mountId=docs&name=new.docx'};
    useStore.setState({previewItems:[{id:'word',type:'docx',title:'new.docx',content:'<p>old</p>',remoteContentRef:target}]});
    mockHanaFetch.mockResolvedValue(new Response(null,{headers:{'Content-Length':'1234','Last-Modified':'Thu, 29 Oct 2026 00:00:00 GMT'}}));
    await refreshPreviewItemsFromRemoteWorkbenchTarget(target);
    expect(mockHanaFetch).toHaveBeenCalledWith(target.contentPath,{method:'HEAD'});
    expect(useStore.getState().previewItems[0]).toMatchObject({id:'word',content:''});
  });

  it('refreshes media metadata without loading binary content into the preview state',async()=>{
    const {refreshPreviewItemsFromRemoteWorkbenchTarget}=await import('../../utils/remote-file-preview');
    const target:RemoteWorkbenchContentRef={kind:'workbench-file',mountId:'media',subdir:'',name:'new.wav',contentPath:'/api/workbench/content?mountId=media&name=new.wav'};
    useStore.setState({previewItems:[{id:'audio',type:'media',title:'new.wav',content:'',remoteContentRef:target}]});
    mockHanaFetch.mockResolvedValueOnce(new Response(null,{status:200,headers:{'X-Hana-File-MtimeMs':'2000','X-Hana-File-Size':'32000'}}));
    await refreshPreviewItemsFromRemoteWorkbenchTarget(target);
    expect(mockHanaFetch).toHaveBeenCalledWith(target.contentPath,{method:'HEAD'});
    expect(useStore.getState().previewItems[0]).toMatchObject({content:'',fileVersion:{mtimeMs:2000,size:32000}});
  });

  it('does not downgrade a remote workbench refresh to a stale target version', async () => {
    const { refreshPreviewItemsFromRemoteWorkbenchTarget } = await import('../../utils/remote-file-preview');
    const staleVersion = { mtimeMs: 1000, size: 0 };
    const savedVersion = { mtimeMs: 2000, size: 12 };
    const diskVersion = { mtimeMs: 3000, size: 18 };
    const target: RemoteWorkbenchContentRef = {
      kind: 'workbench-file',
      mountId: 'mount_docs',
      subdir: 'notes',
      name: 'remote.md',
      contentPath: '/api/workbench/content?mountId=mount_docs&subdir=notes&name=remote.md',
      version: staleVersion,
    };
    useStore.setState({
      previewItems: [{
        id: 'remote-note',
        type: 'markdown',
        title: 'remote.md',
        content: 'saved body',
        storageKind: 'remote-content',
        fileVersion: savedVersion,
        remoteContentRef: target,
      }],
    } as Partial<StoreState>);
    mockHanaFetch.mockResolvedValueOnce(new Response('fresh external body', {
      status: 200,
      headers: {
        'X-Hana-File-MtimeMs': String(diskVersion.mtimeMs),
        'X-Hana-File-Size': String(diskVersion.size),
      },
    }));

    await refreshPreviewItemsFromRemoteWorkbenchTarget(target);

    const item = useStore.getState().previewItems[0];
    expect(item.content).toBe('fresh external body');
    expect(item.fileVersion).toEqual(diskVersion);
    expect(item.remoteContentRef?.version).toEqual(diskVersion);
  });

  it('opens local default workbench documents through native preview when this client owns the server', async () => {
    const { openWorkbenchFilePreview } = await import('../../utils/remote-file-preview');
    const file: DeskFile = {
      name: 'local.md',
      isDir: false,
      mtime: '2026-06-25T01:02:03.000Z',
      size: 8,
    };

    await openWorkbenchFilePreview({
      subdir: 'notes',
      localRootPath: '/Users/me/project',
      file,
    });

    expect(mockOpenFilePreview).toHaveBeenCalledWith('/Users/me/project/notes/local.md', 'local.md', 'md', {
      origin: 'desk',
      sourceRootPath: '/Users/me/project',
    });
    expect(mockHanaFetch).not.toHaveBeenCalled();
  });

  it('uses content routes in a browser even when the browser has local-owner credentials', async () => {
    const { openWorkbenchFilePreview } = await import('../../utils/remote-file-preview');
    document.documentElement.setAttribute('data-platform', 'web');
    mockHanaFetch.mockResolvedValueOnce(new Response('# Web document', {status: 200}));
    await openWorkbenchFilePreview({subdir: '', localRootPath: '/local/project', file: {name: 'readme.md', isDir: false}});
    expect(mockOpenFilePreview).not.toHaveBeenCalled();
    expect(useStore.getState().previewItems[0]).toMatchObject({type: 'markdown', content: '# Web document'});
  });

  it('opens remote default workbench documents through ResourceIO content even in desktop runtime', async () => {
    const { openWorkbenchFilePreview } = await import('../../utils/remote-file-preview');
    useStore.setState({
      activeServerConnection: {
        connectionId: 'browser:server_lan',
        kind: 'lan',
        serverId: 'server_lan',
        userId: 'user_lan',
        studioId: 'studio_lan',
        label: 'LAN Hana',
        baseUrl: 'http://hana.local:14500',
        wsUrl: 'ws://hana.local:14500',
        token: null,
        authState: 'paired',
        trustState: 'lan',
        credentialKind: 'device_credential',
        platformAccountId: null,
        officialServiceKind: null,
        capabilities: ['resources', 'files'],
      },
    } as Partial<StoreState>);
    const file: DeskFile = {
      name: 'remote.md',
      isDir: false,
      mtime: '2026-06-25T01:02:03.000Z',
      size: 9,
    };
    mockHanaFetch.mockResolvedValueOnce(new Response('# remote\n', { status: 200 }));

    await openWorkbenchFilePreview({
      subdir: 'notes',
      localRootPath: '/Users/server/project',
      file,
    });

    expect(mockOpenFilePreview).not.toHaveBeenCalled();
    expect(mockHanaFetch).toHaveBeenCalledWith(expect.stringMatching(
      /^\/api\/workbench\/content\?mountId=default&subdir=notes&name=remote\.md&v=/,
    ));
    expect(useStore.getState().previewItems[0]).toMatchObject({
      title: 'remote.md',
      content: '# remote\n',
      storageKind: 'remote-content',
      remoteContentRef: {
        kind: 'workbench-file',
        mountId: 'default',
        rootId: 'default',
        subdir: 'notes',
        name: 'remote.md',
      },
    });
  });

  it('opens remote session FileRefs through ResourceIO content instead of native paths', async () => {
    const { openFileRefPreview } = await import('../../utils/remote-file-preview');
    useStore.setState({
      activeServerConnection: {
        connectionId: 'browser:server_lan',
        kind: 'lan',
        serverId: 'server_lan',
        userId: 'user_lan',
        studioId: 'studio_lan',
        label: 'LAN Hana',
        baseUrl: 'http://hana.local:14500',
        wsUrl: 'ws://hana.local:14500',
        token: null,
        authState: 'paired',
        trustState: 'lan',
        credentialKind: 'device_credential',
        platformAccountId: null,
        officialServiceKind: null,
        capabilities: ['resources', 'files'],
      },
    } as Partial<StoreState>);
    const fileRef: FileRef = {
      id: 'session-registry:/server/cache/report.md',
      fileId: 'sf_report',
      kind: 'markdown',
      source: 'session-registry',
      name: 'report.md',
      path: '/server/cache/report.md',
      ext: 'md',
      status: 'available',
      resource: {
        resourceId: 'res_sf_report',
        studioId: 'studio_lan',
        links: {
          self: '/api/resources/res_sf_report',
          content: '/api/resources/res_sf_report/content',
        },
      },
    };
    mockHanaFetch.mockResolvedValueOnce(new Response('# file ref\n', { status: 200 }));

    await openFileRefPreview(fileRef, {
      origin: 'session',
      sessionPath: '/sessions/main.jsonl',
      messageId: 'm1',
      blockIdx: 0,
    });

    expect(mockOpenFilePreview).not.toHaveBeenCalled();
    expect(mockHanaFetch).toHaveBeenCalledWith('/api/resources/res_sf_report/content');
    expect(useStore.getState().previewItems[0]).toMatchObject({
      title: 'report.md',
      content: '# file ref\n',
      storageKind: 'remote-content',
    });
  });
});
