// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArtifactDocument, ArtifactsPanel } from '../Artifacts';
import { hanaFetch } from '../../hooks/use-hana-fetch';
import { useEngineering } from '../state';
vi.mock('../../hooks/use-hana-fetch', () => ({ hanaFetch: vi.fn() }));
const value = { record: { id:'image-a',hash:'one',title:'界面验收',kind:'screenshot',bytes:200,extension:'.jpg',createdAt:'2026-10-27T00:00:00Z' }, preview:{kind:'image',mediaType:'image/jpeg',downloadName:'界面截图.jpg'}, sourceCurrent:false };
const blob = new Blob(['jpeg-bytes'], { type:'image/jpeg' });
let saved: string[];
beforeEach(() => {
  vi.clearAllMocks(); saved=[];
  useEngineering.setState({sessionPath:'/task',connectionId:'server-a'});
  vi.mocked(hanaFetch).mockResolvedValue({ok:true,blob:async()=>blob} as Response);
  Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=> 'blob:preview')});
  Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});
  vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(this:HTMLAnchorElement){ saved.push(this.download); });
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('keeps available artifacts discoverable while explaining missing files with readable types and byte sizes',()=>{
 render(<ArtifactsPanel value={{items:[{...value.record,kind:'package',bytes:8}],unavailable:[{id:'missing',title:'旧截图',reason:'保存的文件已不在原位置'}]}}/>);
 expect(screen.getByRole('status')).toHaveTextContent('其他记录仍可查看');
 expect(screen.getByRole('button',{name:/界面验收/})).toHaveTextContent('任务包 · 8 字节');
});
it('loads an authenticated raster preview, keeps historical source state, zooms and downloads with its extension',async()=>{
  const {unmount}=render(<ArtifactDocument value={value} evidence={()=>null}/>);
  const image=await screen.findByRole('img',{name:'界面验收'});fireEvent.load(image);
  expect(screen.queryByText('正在加载图片…')).toBeNull();expect(screen.getByText('来源已变化或不可用')).toBeVisible();
  expect(image).toHaveAttribute('src','blob:preview');expect(hanaFetch).toHaveBeenCalledWith(expect.stringContaining('/artifact/image-a?sessionPath='),expect.objectContaining({signal:expect.any(AbortSignal)}));
  fireEvent.click(screen.getByRole('button',{name:'原始尺寸'}));expect(image.parentElement).toHaveAttribute('data-original','true');
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'下载这个版本'}));});
  expect(saved).toEqual(['界面截图.jpg']);unmount();expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
});
it('makes preview and download failures retryable without silently displaying an empty page',async()=>{
  vi.mocked(hanaFetch).mockResolvedValue({ok:false,status:403} as Response);
  render(<ArtifactDocument value={value} evidence={()=>null}/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('没有读取');
  vi.mocked(hanaFetch).mockResolvedValue({ok:true,blob:async()=>blob} as Response);
  fireEvent.click(screen.getByRole('button',{name:'重试图片预览'}));fireEvent.load(await screen.findByRole('img'));
  vi.mocked(hanaFetch).mockResolvedValue({ok:false,status:500} as Response);
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'下载这个版本'}));});
  expect(screen.getByRole('alert')).toHaveTextContent('下载未完成');expect(saved).toEqual([]);
});
it('does not publish late bytes from another artifact and revokes replaced URLs',async()=>{
  let resolve!:(value:Response)=>void;vi.mocked(hanaFetch).mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
  const {rerender}=render(<ArtifactDocument value={value} evidence={()=>null}/>);
  rerender(<ArtifactDocument value={{...value,record:{...value.record,id:'image-b',hash:'two',title:'新图片'}}} evidence={()=>null}/>);
  await screen.findByRole('img',{name:'新图片'});
  await act(async()=>{resolve({ok:true,blob:async()=>blob} as Response);});
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);expect(screen.queryByRole('img',{name:'界面验收'})).toBeNull();
});
it('explains unsupported content and still offers a download, while empty text remains an empty text result',()=>{
  const {rerender}=render(<ArtifactDocument value={{...value,preview:{kind:'download',reason:'文件超过文本预览大小，可下载完整版本查看。'}}} evidence={()=>null}/>);
  expect(screen.getByText(/文件超过文本预览大小/)).toBeVisible();expect(hanaFetch).not.toHaveBeenCalled();
  rerender(<ArtifactDocument value={{...value,record:{...value.record,kind:'document',extension:'.txt'},content:'',preview:{kind:'text'}}} evidence={()=>null}/>);
  expect(screen.queryByText(/文件超过文本预览大小/)).toBeNull();expect(screen.getByRole('button',{name:'下载这个版本'})).toBeEnabled();
});
