// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MediaPreview } from '../../components/preview/MediaPreview';
import { readFileForPreviewType } from '../../utils/preview-file-content';
import { useStore } from '../../stores';

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
  vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});
  vi.stubGlobal('ResizeObserver', class {observe() {} disconnect() {}});
  window.platform = {getFileUrl: (path: string) => `file://${path}`, openFile: vi.fn(), statFile: vi.fn(async () => ({size: 500, mtimeMs: 100}))} as unknown as Window['platform'];
  useStore.setState({serverPort: '', serverBaseUrl: ''} as never);
});
afterEach(() => {cleanup(); vi.unstubAllGlobals();vi.restoreAllMocks();});

it('loads audio with explicit controls and reports an unsupported codec', async () => {
  const {container, unmount} = render(<MediaPreview previewItem={{id: 'audio', type: 'media', title: 'new.wav', content: '', filePath: '/new/new.wav', ext: 'wav'}}/>);
  await waitFor(() => expect(container.querySelector('audio')).toBeTruthy());
  const audio = container.querySelector('audio')!;
  expect(screen.getByRole('button',{name:'播放'})).toBeTruthy();expect(audio.autoplay).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'系统控件'}));expect(audio.controls).toBe(true);
  fireEvent.error(audio);
  expect(screen.getByRole('alert').textContent).toContain('格式');
  unmount(); expect(container.querySelector('audio')).toBeNull();
});

it('refreshes media using file metadata without reading binary bytes into text', async () => {
  expect(await readFileForPreviewType('/new/picture.png', 'media')).toEqual({content: '', fileVersion: {size: 500, mtimeMs: 100}});
  vi.mocked(window.platform.statFile!).mockResolvedValue(null);
  expect(await readFileForPreviewType('/new/deleted.png', 'media')).toBeNull();
});
