// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MediaPlayer,formatMediaTime} from '../../components/preview/MediaPlayer';
import {StrictMode} from 'react';
beforeEach(()=>{
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(function(this:HTMLMediaElement){Object.defineProperty(this,'paused',{configurable:true,value:true});this.dispatchEvent(new Event('pause'))});
  vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});
  vi.spyOn(HTMLMediaElement.prototype,'play').mockImplementation(async function(this:HTMLMediaElement){Object.defineProperty(this,'paused',{configurable:true,value:false});this.dispatchEvent(new Event('play'))});
});
afterEach(()=>{cleanup();vi.restoreAllMocks()});
function setup(){const view=render(<MediaPlayer src="file:///new/video.webm" name="new.webm" kind="video" onReady={vi.fn()} onError={vi.fn()}/>);const video=view.container.querySelector('video')!;Object.defineProperty(video,'duration',{configurable:true,value:125});fireEvent.loadedMetadata(video);return {video,...view};}
it('tracks actual playback, seeks only on commit, and preserves mute/rate controls',async()=>{
  const {video}=setup();fireEvent.click(screen.getByRole('button',{name:'播放'}));await screen.findByRole('button',{name:'暂停'});
  const seek=screen.getByRole('slider',{name:'播放进度'});fireEvent.change(seek,{target:{value:'30'}});expect(video.currentTime).toBe(0);
  fireEvent.pointerUp(seek);expect(video.currentTime).toBe(30);
  fireEvent.click(screen.getByRole('button',{name:'静音'}));expect(video.muted).toBe(true);
  fireEvent.change(screen.getByRole('slider',{name:'音量'}),{target:{value:'.5'}});expect(video.volume).toBe(.5);expect(video.muted).toBe(false);
  fireEvent.change(screen.getByRole('combobox',{name:'播放速度'}),{target:{value:'1.5'}});expect(video.playbackRate).toBe(1.5);
  fireEvent.click(screen.getByRole('button',{name:'暂停'}));expect(video.paused).toBe(true);
});
it('reports a rejected play request and retries on the same file',async()=>{
  const {video}=setup();vi.mocked(video.play).mockRejectedValueOnce(new DOMException('blocked','NotAllowedError'));
  fireEvent.click(screen.getByRole('button',{name:'播放'}));expect((await screen.findByRole('alert')).textContent).toContain('再次点击播放');
  fireEvent.click(screen.getByRole('button',{name:'播放'}));await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());expect(video.paused).toBe(false);
});
it('keeps keyboard range navigation separate from the player shortcuts and pauses hidden media',async()=>{
  const {video,container}=setup();const group=screen.getByRole('group',{name:'new.webm播放控制'});
  fireEvent.keyDown(group,{key:'ArrowRight'});expect(video.currentTime).toBe(5);
  fireEvent.keyDown(screen.getByRole('slider',{name:'音量'}),{key:'ArrowRight'});expect(video.currentTime).toBe(5);
  fireEvent.keyDown(group,{key:' '});await waitFor(()=>expect(video.paused).toBe(false));
  vi.spyOn(document,'hidden','get').mockReturnValue(true);fireEvent(document,new Event('visibilitychange'));expect(video.paused).toBe(true);
  expect(container.querySelector('[data-playback-state="paused"]')).toBeTruthy();
});
it('releases the media source on unmount and does not autoplay',()=>{
  const {video,unmount}=setup();expect(video.autoplay).toBe(false);unmount();expect(video.getAttribute('src')).toBeNull();expect(video.pause).toHaveBeenCalled();
});
it('restores its source after effect replay instead of leaving the player empty',()=>{
  const {container}=render(<StrictMode><MediaPlayer src="file:///new/replayed.webm" kind="video" name="replayed.webm" onReady={vi.fn()} onError={vi.fn()}/></StrictMode>);
  expect(container.querySelector('video')?.getAttribute('src')).toBe('file:///new/replayed.webm');
});
it('retains the reading position across panel remounts without resuming playback',()=>{
  const props={src:'file:///new/retained.webm',restoreKey:'retained',kind:'video' as const,name:'retained.webm',onReady:vi.fn(),onError:vi.fn()};
  const first=render(<MediaPlayer {...props}/>);const video=first.container.querySelector('video')!;
  Object.defineProperty(video,'readyState',{configurable:true,value:4});Object.defineProperty(video,'duration',{configurable:true,value:120});fireEvent.loadedMetadata(video);video.currentTime=42;video.playbackRate=1.5;first.unmount();
  const second=render(<MediaPlayer {...props}/>);const restoredVideo=second.container.querySelector('video')!;Object.defineProperty(restoredVideo,'duration',{configurable:true,value:120});fireEvent.loadedMetadata(restoredVideo);
  expect(restoredVideo.currentTime).toBe(42);expect(restoredVideo.playbackRate).toBe(1.5);expect(restoredVideo.paused).toBe(true);
});
it('shows finite times without NaN for unknown duration',()=>{
  expect(formatMediaTime(3661)).toBe('1:01:01');expect(formatMediaTime(NaN)).toBe('0:00');expect(formatMediaTime(-1)).toBe('0:00');
});
