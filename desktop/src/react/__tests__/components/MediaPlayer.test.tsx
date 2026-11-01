// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MediaPlayer,formatMediaTime} from '../../components/preview/MediaPlayer';
import {StrictMode} from 'react';
const originalPipDescriptor=Object.getOwnPropertyDescriptor(document,'pictureInPictureElement');
const originalExitPipDescriptor=Object.getOwnPropertyDescriptor(document,'exitPictureInPicture');
beforeEach(()=>{
  Object.defineProperty(document,'pictureInPictureElement',{configurable:true,get:()=>null});
  Object.defineProperty(document,'exitPictureInPicture',{configurable:true,writable:true,value:vi.fn(async()=>{})});
  vi.spyOn(HTMLMediaElement.prototype,'audioTracks','get').mockReturnValue(Object.assign(new EventTarget(),{length:0,*[Symbol.iterator](){}}) as never);
  vi.spyOn(HTMLMediaElement.prototype,'videoTracks','get').mockReturnValue(Object.assign(new EventTarget(),{length:0,*[Symbol.iterator](){}}) as never);
  vi.spyOn(document,'hidden','get').mockReturnValue(false);
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(function(this:HTMLMediaElement){Object.defineProperty(this,'paused',{configurable:true,value:true});this.dispatchEvent(new Event('pause'))});
  vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});
  vi.spyOn(HTMLMediaElement.prototype,'play').mockImplementation(async function(this:HTMLMediaElement){Object.defineProperty(this,'paused',{configurable:true,value:false});this.dispatchEvent(new Event('play'))});
  vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
  vi.stubGlobal('IntersectionObserver',class{observe(){}disconnect(){}});
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();
  if(originalPipDescriptor)Object.defineProperty(document,'pictureInPictureElement',originalPipDescriptor);else Reflect.deleteProperty(document,'pictureInPictureElement');
  if(originalExitPipDescriptor)Object.defineProperty(document,'exitPictureInPicture',originalExitPipDescriptor);else Reflect.deleteProperty(document,'exitPictureInPicture');
});
const props={src:'file:///new/video.webm',name:'new.webm',kind:'video' as const,onReady:vi.fn(),onError:vi.fn()};
function metadata(video:HTMLMediaElement){Object.defineProperty(video,'duration',{configurable:true,value:125});Object.defineProperty(video,'readyState',{configurable:true,value:4});fireEvent.loadedMetadata(video);fireEvent.canPlay(video);}
function setup(){const view=render(<MediaPlayer {...props}/>);const video=view.container.querySelector('video')!;metadata(video);return {video,...view};}
it('uses upstream translated playback and mute controls driven by the media element',async()=>{
  const {video}=setup();fireEvent.click(screen.getAllByRole('button',{name:'播放'})[0]);
  await waitFor(()=>expect(video.paused).toBe(false));await screen.findAllByRole('button',{name:'暂停'});
  fireEvent.click(screen.getByRole('button',{name:'静音'}));expect(video.muted).toBe(true);
  fireEvent.click(screen.getAllByRole('button',{name:'暂停'})[0]);expect(video.paused).toBe(true);
});
it('reports a rejected play request and retries on the same file',async()=>{
  vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new DOMException('blocked','NotAllowedError'));
  const {video}=setup();fireEvent.click(screen.getAllByRole('button',{name:'播放'})[0]);
  expect((await screen.findByRole('alert')).textContent).toContain('再次点击播放');
  fireEvent.click(screen.getAllByRole('button',{name:'播放'})[0]);await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());expect(video.paused).toBe(false);
});
it('keeps upstream keyboard controls scoped to the player and pauses hidden media',async()=>{
  const {video,container}=setup();const skin=container.querySelector('.enigma-video-skin')!;
  fireEvent.keyDown(document.body,{key:'ArrowRight'});expect(video.currentTime).toBe(0);
  fireEvent.keyDown(skin,{key:'ArrowRight'});await waitFor(()=>expect(video.currentTime).toBe(10));
  await act(()=>video.play());vi.spyOn(document,'hidden','get').mockReturnValue(true);fireEvent(document,new Event('visibilitychange'));expect(video.paused).toBe(true);
});
it('releases the media source on unmount and does not autoplay',()=>{
  const {video,unmount}=setup();expect(video.autoplay).toBe(false);unmount();expect(video.getAttribute('src')).toBeNull();expect(video.pause).toHaveBeenCalled();
});
it('restores its source after StrictMode effect replay',()=>{
  const {container}=render(<StrictMode><MediaPlayer {...props}/></StrictMode>);expect(container.querySelector('video')?.getAttribute('src')).toBe(props.src);
});
it('retains the position, rate and volume through fallback and back without autoplay',()=>{
  const {video,container}=setup();video.currentTime=42;video.playbackRate=1.5;video.volume=.4;
  fireEvent.click(screen.getByRole('button',{name:'系统控件'}));const native=container.querySelector('video')!;metadata(native);expect(native.controls).toBe(true);expect(native.currentTime).toBe(42);expect(native.playbackRate).toBe(1.5);expect(native.volume).toBe(.4);expect(native.paused).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'返回增强控件'}));const enhanced=container.querySelector('video')!;metadata(enhanced);expect(enhanced.currentTime).toBe(42);expect(enhanced.paused).toBe(true);
});
it('stops an inactive gallery video including late play completion',async()=>{
  let resolve!:()=>void;vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(()=>new Promise<void>(r=>resolve=r));
  const view=setup();let playing!:Promise<void>;act(()=>{playing=view.video.play()});view.rerender(<MediaPlayer {...props} active={false}/>);
  await act(async()=>{resolve();await playing;});expect(view.video.paused).toBe(true);
});
it('keeps the visible picture-in-picture playing while the main window is hidden, then pauses when it closes',async()=>{
  const {video}=setup();
  let pip:Element|null=video;
  vi.spyOn(document,'pictureInPictureElement','get').mockImplementation(()=>pip);
  await act(()=>video.play());
  vi.spyOn(document,'hidden','get').mockReturnValue(true);
  fireEvent(document,new Event('visibilitychange'));
  expect(video.paused).toBe(false);
  await act(()=>video.play());
  expect(video.paused).toBe(false);
  pip=null;fireEvent(video,new Event('leavepictureinpicture'));
  expect(video.paused).toBe(true);
});
it('still stops picture-in-picture when its preview becomes inactive',async()=>{
  const view=setup();
  vi.spyOn(document,'pictureInPictureElement','get').mockReturnValue(view.video);
  await act(()=>view.video.play());
  view.rerender(<MediaPlayer {...props} active={false}/>);
  expect(view.video.paused).toBe(true);
});
it('does not keep hidden media playing just because another video owns picture-in-picture',async()=>{
  const {video}=setup();
  vi.spyOn(document,'pictureInPictureElement','get').mockReturnValue(document.createElement('video'));
  await act(()=>video.play());
  vi.spyOn(document,'hidden','get').mockReturnValue(true);fireEvent(document,new Event('visibilitychange'));
  expect(video.paused).toBe(true);
});
it('closes its picture-in-picture and releases the media when its preview is removed',async()=>{
  const {video,unmount}=setup();
  vi.spyOn(document,'pictureInPictureElement','get').mockReturnValue(video);
  await act(()=>video.play());unmount();
  expect(document.exitPictureInPicture).toHaveBeenCalledOnce();
  expect(video.paused).toBe(true);expect(video.getAttribute('src')).toBeNull();
});
it('validates local subtitles and releases their object URL',async()=>{
  vi.stubGlobal('URL',class extends URL{static createObjectURL=vi.fn(()=> 'blob:subtitle');static revokeObjectURL=vi.fn()});
  const {container,unmount}=setup();const input=screen.getByLabelText('选择 WebVTT 字幕');
  fireEvent.change(input,{target:{files:[{name:'bad.vtt',size:8,text:async()=>'<html>'}]}});expect((await screen.findByRole('alert')).textContent).toContain('WEBVTT');
  fireEvent.change(input,{target:{files:[{name:'new.vtt',size:60,text:async()=> 'WEBVTT\n\n00:00.000 --> 00:02.000\n新建字幕\n'}]}});
  await waitFor(()=>expect(container.querySelector('track')?.src).toBe('blob:subtitle'));expect(screen.queryByRole('alert')).toBeNull();unmount();expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:subtitle');
});
it('uses the audio skin and relays source failure',()=>{
  const onError=vi.fn(),view=render(<MediaPlayer {...props} kind="audio" onError={onError}/>);const audio=view.container.querySelector('audio')!;expect(audio.autoplay).toBe(false);expect(screen.queryByText('加载字幕')).toBeNull();fireEvent.error(audio);expect(onError).toHaveBeenCalled();
});
it('formats finite and unknown times',()=>{expect(formatMediaTime(3661)).toBe('1:01:01');expect(formatMediaTime(NaN)).toBe('0:00');});
it('shows a recovery message when the host rejects fullscreen or picture in picture',async()=>{
  const requestFullscreen=vi.fn(async()=>{throw new DOMException('host rejected','NotAllowedError')});
  const requestPictureInPicture=vi.fn(async()=>{throw new DOMException('host rejected','NotAllowedError')});
  const fullscreenBefore=HTMLElement.prototype.requestFullscreen,pipBefore=HTMLVideoElement.prototype.requestPictureInPicture;
  HTMLElement.prototype.requestFullscreen=requestFullscreen;HTMLVideoElement.prototype.requestPictureInPicture=requestPictureInPicture;
  try{
    const view=setup();const skin=view.container.querySelector<HTMLElement>('.enigma-video-skin')!;
    await act(async()=>{await skin.requestFullscreen().catch(()=>{});});expect(screen.getByRole('alert').textContent).toContain('无法进入全屏');
    await act(async()=>{await view.video.requestPictureInPicture().catch(()=>{});});expect(screen.getByRole('alert').textContent).toContain('无法开启画中画');
    view.unmount();expect(skin.requestFullscreen).toBe(requestFullscreen);expect(view.video.requestPictureInPicture).toBe(requestPictureInPicture);
  }finally{HTMLElement.prototype.requestFullscreen=fullscreenBefore;HTMLVideoElement.prototype.requestPictureInPicture=pipBefore;}
});
