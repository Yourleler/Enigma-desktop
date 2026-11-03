/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installWindowTestT } from '../helpers/i18n-test-strings';
import { PreviewPanel } from '../../components/PreviewPanel';
import { useStore, type StoreState } from '../../stores';
import type { PlatformApi, PreviewItem } from '../../types';

const mocks = vi.hoisted(() => ({
  hanaFetch: vi.fn(),
  retainLocalFileResourceWatch: vi.fn(() => vi.fn()),
  retainResourceWatch: vi.fn(() => vi.fn()),
}));

vi.mock('../../hooks/use-hana-fetch', () => ({ hanaFetch: mocks.hanaFetch }));
vi.mock('../../services/resource-events', () => ({
  retainLocalFileResourceWatch: mocks.retainLocalFileResourceWatch,
  retainResourceWatch: mocks.retainResourceWatch,
  resourceWatchKey: (ref: { kind: string; path?: string }) => `${ref.kind}:${ref.path || ''}`,
}));
vi.mock('../../utils/checkpoints', () => ({
  requestUserEditCheckpoint: vi.fn(async () => undefined),
}));

const LABELS = {
  'preview.viewSource': '查看源码',
  'preview.exitSourceView': '返回预览',
  'preview.exitMarkdownPreview': '回到编辑',
  'preview.markdownPreview': '预览',
  'preview.sourceReadOnly': '源码只读：此内容没有关联可写入的文件（如对话生成的产物），修改无法保存。',
};

function rect(width = 960, height = 640): DOMRect {
  return { x: 0, y: 0, width, height, top: 0, right: width, bottom: height, left: 0, toJSON: () => ({}) } as DOMRect;
}

function setPreview(items: PreviewItem[], activeTabId: string, markdownPreviewIds: string[] = []) {
  useStore.setState({
    previewOpen: true,
    previewItems: items,
    openTabs: items.map(item => item.id),
    activeTabId,
    markdownPreviewIds,
    previewReadingPositions: {},
    quoteCandidate: null,
    quotedSelections: [],
    quotedSelection: null,
  } as Partial<StoreState>);
}

function editorView(): EditorView {
  const dom = document.querySelector<HTMLElement>('.preview-editor .cm-editor');
  if (!dom) throw new Error('editor not mounted');
  const view = EditorView.findFromDOM(dom);
  if (!view) throw new Error('editor view missing');
  return view;
}

function typeIntoEditor(text: string) {
  const view = editorView();
  act(() => {
    view.dispatch({ changes: { from: view.state.doc.length, insert: text } });
  });
}

describe('PreviewPanel source view toggle', () => {
  let platform: Partial<PlatformApi>;
  let rectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    installWindowTestT(LABELS);
    rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => rect());
    Range.prototype.getClientRects = vi.fn(() => [] as unknown as DOMRectList);
    Range.prototype.getBoundingClientRect = vi.fn(() => rect(0, 0));
    mocks.hanaFetch.mockReset().mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => (url === '/api/preview/html' ? { previewUrl: 'about:blank#html-preview' } : {}),
    }));
    platform = {
      watchFile: vi.fn(async () => true),
      unwatchFile: vi.fn(async () => true),
      onFileChanged: vi.fn(),
      writeFile: vi.fn(async () => true),
      writeFileIfUnchanged: vi.fn(async () => ({ ok: true, conflict: false, version: { mtimeMs: 2, size: 10, sha256: 'next' } })),
    };
    window.platform = platform as PlatformApi;
  });

  afterEach(() => {
    cleanup();
    rectSpy.mockRestore();
    setPreview([], '');
    vi.clearAllMocks();
  });

  it('switches a rendered markdown preview to an editable source editor and back to the saved result', async () => {
    setPreview([{ id: 'note', type: 'markdown', title: 'note.md', content: '# 标题\n\n原文', filePath: '/tmp/source-note.md', fileVersion: { mtimeMs: 1, size: 5, sha256: 'old' } }], 'note', ['note']);
    render(<PreviewPanel watchDocuments={false} />);

    expect(document.querySelector('.preview-markdown')).toHaveTextContent('原文');
    fireEvent.click(screen.getByRole('button', { name: '查看源码' }));

    await waitFor(() => expect(document.querySelector('.preview-editor.mode-code .cm-content')).toBeTruthy());
    expect(document.querySelector('.preview-editor .cm-content')).toHaveAttribute('contenteditable', 'true');
    expect(editorView().state.doc.toString()).toBe('# 标题\n\n原文');
    expect(screen.getByRole('button', { name: '返回预览' })).toHaveAttribute('aria-pressed', 'true');

    typeIntoEditor('\n\n新增段落');
    await waitFor(() => expect(platform.writeFileIfUnchanged).toHaveBeenCalledWith('/tmp/source-note.md', '# 标题\n\n原文\n\n新增段落', { mtimeMs: 1, size: 5, sha256: 'old' }), { timeout: 3000 });

    fireEvent.click(screen.getByRole('button', { name: '返回预览' }));
    await waitFor(() => expect(document.querySelector('.preview-markdown')).toHaveTextContent('新增段落'));
    expect(document.querySelector('.preview-editor')).toBeNull();
    expect(useStore.getState().previewItems[0].fileVersion).toEqual({ mtimeMs: 2, size: 10, sha256: 'next' });
  });

  it('flushes a pending source edit when returning to preview before the autosave delay', async () => {
    setPreview([{ id: 'note', type: 'markdown', title: 'note.md', content: '原文', filePath: '/tmp/flush-note.md' }], 'note', ['note']);
    render(<PreviewPanel watchDocuments={false} />);
    fireEvent.click(screen.getByRole('button', { name: '查看源码' }));
    await waitFor(() => expect(document.querySelector('.preview-editor .cm-content')).toBeTruthy());

    typeIntoEditor('，立即切回');
    fireEvent.click(screen.getByRole('button', { name: '返回预览' }));

    expect(document.querySelector('.preview-markdown')).toHaveTextContent('原文，立即切回');
    await waitFor(() => expect(platform.writeFileIfUnchanged).toHaveBeenCalledWith('/tmp/flush-note.md', '原文，立即切回', null));
  });

  it('enters markdown source from the WYSIWYG editor and returns to editing', async () => {
    setPreview([{ id: 'note', type: 'markdown', title: 'note.md', content: '正文', filePath: '/tmp/wysiwyg-note.md' }], 'note');
    render(<PreviewPanel watchDocuments={false} />);
    await waitFor(() => expect(document.querySelector('.preview-editor.mode-markdown .cm-content')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '查看源码' }));
    await waitFor(() => expect(document.querySelector('.preview-editor.mode-code .cm-content')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '回到编辑' }));
    await waitFor(() => expect(document.querySelector('.preview-editor.mode-markdown .cm-content')).toBeTruthy());
  });

  it('edits HTML source with the code editor and re-registers the preview with the new content', async () => {
    setPreview([{ id: 'page', type: 'html', title: 'demo.html', content: '<h1>Hello</h1>', filePath: '/tmp/demo.html', ext: 'html' }], 'page');
    render(<PreviewPanel watchDocuments={false} />);
    await waitFor(() => expect(document.querySelector('iframe[data-html-preview-frame]')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '查看源码' }));
    await waitFor(() => expect(document.querySelector('.preview-editor.mode-code .cm-content')).toBeTruthy());
    expect(document.querySelector('iframe[data-html-preview-frame]')).toBeNull();

    typeIntoEditor('<p>World</p>');
    await waitFor(() => expect(platform.writeFileIfUnchanged).toHaveBeenCalledWith('/tmp/demo.html', '<h1>Hello</h1><p>World</p>', null), { timeout: 3000 });

    fireEvent.click(screen.getByRole('button', { name: '返回预览' }));
    await waitFor(() => {
      const bodies = mocks.hanaFetch.mock.calls
        .filter(([url]) => url === '/api/preview/html')
        .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
      expect(bodies.at(-1)?.content).toBe('<h1>Hello</h1><p>World</p>');
    });
  });

  it('keeps the source view per tab while switching tabs', async () => {
    setPreview([
      { id: 'page', type: 'html', title: 'demo.html', content: '<h1>A</h1>', filePath: '/tmp/a.html', ext: 'html' },
      { id: 'code', type: 'code', title: 'a.ts', content: 'export {};\n', filePath: '/tmp/a.ts', ext: 'ts', language: 'ts' },
    ], 'page');
    render(<PreviewPanel watchDocuments={false} />);
    fireEvent.click(screen.getByRole('button', { name: '查看源码' }));
    await waitFor(() => expect(document.querySelector('.preview-editor.mode-code .cm-content')).toBeTruthy());

    act(() => { useStore.setState({ activeTabId: 'code' } as Partial<StoreState>); });
    expect(screen.queryByRole('button', { name: '查看源码' })).toBeNull();
    act(() => { useStore.setState({ activeTabId: 'page' } as Partial<StoreState>); });

    expect(screen.getByRole('button', { name: '返回预览' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(editorView().state.doc.toString()).toBe('<h1>A</h1>'));
  });

  it('opens content-only artifacts in a read-only source view with an explanation', async () => {
    setPreview([{ id: 'artifact', type: 'html', title: 'artifact.html', content: '<p>产物</p>' }], 'artifact');
    render(<PreviewPanel watchDocuments={false} />);

    fireEvent.click(screen.getByRole('button', { name: '查看源码' }));
    await waitFor(() => expect(document.querySelector('.preview-editor .cm-content')).toBeTruthy());

    expect(screen.getByText(LABELS['preview.sourceReadOnly'])).toBeInTheDocument();
    expect(document.querySelector('.preview-editor .cm-content')).toHaveAttribute('contenteditable', 'false');
    expect(editorView().state.readOnly).toBe(true);
    expect(platform.writeFileIfUnchanged).not.toHaveBeenCalled();
    expect(platform.writeFile).not.toHaveBeenCalled();
  });

  it('does not offer a source toggle for plain code files', () => {
    setPreview([{ id: 'code', type: 'code', title: 'a.ts', content: 'export {};\n', filePath: '/tmp/a.ts', ext: 'ts', language: 'ts' }], 'code');
    render(<PreviewPanel watchDocuments={false} />);
    expect(screen.queryByRole('button', { name: '查看源码' })).toBeNull();
  });
});
