// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MediaPreview } from '../../components/preview/MediaPreview';
import { readFileForPreviewType } from '../../utils/preview-file-content';
import { useStore } from '../../stores';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {observe() {} disconnect() {}});
  window.platform = {getFileUrl: (path: string) => `file://${path}`, openFile: vi.fn(), statFile: vi.fn(async () => ({size: 500, mtimeMs: 100}))} as unknown as Window['platform'];
  useStore.setState({serverPort: '', serverBaseUrl: ''} as never);
});
afterEach(() => {cleanup(); vi.unstubAllGlobals();});

it('shows a decode failure and retries the same image without losing its preview', async () => {
  const item = {id: 'picture', type: 'media', title: 'picture.svg', content: '', filePath: '/new/picture.svg', ext: 'svg'};
  render(<MediaPreview previewItem={item}/>);
  await waitFor(() => expect(screen.getByRole('img', {name: 'picture.svg'})).toBeTruthy());
  fireEvent.error(screen.getByRole('img', {name: 'picture.svg'}));
  expect(screen.getByRole('alert').textContent).toContain('无法读取或解码');
  fireEvent.click(screen.getByRole('button', {name: '重新加载'}));
  await waitFor(() => expect(screen.getByRole('img', {name: 'picture.svg'})).toBeTruthy());
  fireEvent.load(screen.getByRole('img', {name: 'picture.svg'}));
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.click(screen.getByRole('button', {name: '放大图片'}));
  expect(screen.getByTestId('image-stage').getAttribute('data-zoom-in-seq')).toBe('1');
});

it('loads audio with explicit controls and reports an unsupported codec', async () => {
  const {container, unmount} = render(<MediaPreview previewItem={{id: 'audio', type: 'media', title: 'new.wav', content: '', filePath: '/new/new.wav', ext: 'wav'}}/>);
  await waitFor(() => expect(container.querySelector('audio')).toBeTruthy());
  const audio = container.querySelector('audio')!;
  expect(audio.controls).toBe(true); expect(audio.autoplay).toBe(false);
  fireEvent.error(audio);
  expect(screen.getByRole('alert').textContent).toContain('格式');
  unmount(); expect(container.querySelector('audio')).toBeNull();
});

it('refreshes media using file metadata without reading binary bytes into text', async () => {
  expect(await readFileForPreviewType('/new/picture.png', 'media')).toEqual({content: '', fileVersion: {size: 500, mtimeMs: 100}});
  vi.mocked(window.platform.statFile!).mockResolvedValue(null);
  expect(await readFileForPreviewType('/new/deleted.png', 'media')).toBeNull();
});
