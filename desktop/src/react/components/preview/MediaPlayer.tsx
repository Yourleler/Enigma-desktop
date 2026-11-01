import {useEffect,useRef,useState,type ChangeEvent} from 'react';
import {Video,VideoPlayer,VideoSkin} from '@videojs/react/video';
import {Audio,AudioPlayer,AudioSkin} from '@videojs/react/audio';
import {I18nProvider} from '@videojs/react/i18n';
import zhCN from '@videojs/react/i18n/locales/zh-CN';
import '@videojs/react/video/skin.css';
import '@videojs/react/audio/skin.css';
import './MediaPlayer.css';

type PlaybackState='loading'|'paused'|'playing'|'buffering'|'ended';
const statusLabels:Record<PlaybackState,string>={loading:'正在加载',paused:'已暂停',playing:'正在播放',buffering:'正在缓冲',ended:'播放结束'};
const playbackPositions=new Map<string,{time:number;volume:number;muted:boolean;rate:number}>();
export function formatMediaTime(seconds:number):string {
  if(!Number.isFinite(seconds)||seconds<0)return '0:00';
  const whole=Math.floor(seconds),hours=Math.floor(whole/3600),minutes=Math.floor(whole/60)%60;
  return `${hours?hours+':':''}${hours?String(minutes).padStart(2,'0'):minutes}:${String(whole%60).padStart(2,'0')}`;
}
interface Props {src:string;name:string;kind:'audio'|'video';restoreKey?:string;active?:boolean;onReady:()=>void;onError:()=>void}

/** Video.js owns controls, input gestures and accessibility; this adapter owns file lifetime. */
export function MediaPlayer({src,name,kind,restoreKey=src,active=true,onReady,onError}:Props) {
  const media=useRef<HTMLMediaElement|null>(null),subtitleInput=useRef<HTMLInputElement>(null);
  const [state,setState]=useState<PlaybackState>('loading'),[systemControls,setSystemControls]=useState(false);
  const [subtitle,setSubtitle]=useState<{url:string;name:string}|null>(null),[message,setMessage]=useState('');
  const activeRef=useRef(active);activeRef.current=active;
  const subtitleUrl=useRef(''),subtitleSequence=useRef(0),restored=useRef(false);
  const savePosition=(node:HTMLMediaElement)=>{
    if(node.readyState<1)return;
    playbackPositions.delete(restoreKey);
    playbackPositions.set(restoreKey,{time:node.currentTime,volume:node.volume,muted:node.muted,rate:node.playbackRate});
    if(playbackPositions.size>64)playbackPositions.delete(playbackPositions.keys().next().value!);
  };
  useEffect(()=>{
    const node=media.current;if(!node)return;
    let disposed=false;
    restored.current=false;setState('loading');
    // A picture-in-picture window remains visible after its owner window is
    // hidden. Inactive previews still stop, even when they own that window.
    const playbackAllowed=()=>activeRef.current&&(!document.hidden||document.pictureInPictureElement===node);
    // Surface rejected play requests (the packaged controls intentionally swallow
    // their promise). Keep the wrapper local to this media element and lifetime.
    const nativePlay=node.play;
    const requestPlay=async()=>{
      setMessage('');
      try{
        if(!playbackAllowed())throw new DOMException('Inactive preview','AbortError');
        await nativePlay.call(node);
        if(disposed||!playbackAllowed())node.pause();
      }catch(error){
        if(!disposed){setState('paused');setMessage(error instanceof DOMException&&error.name==='NotAllowedError'?'播放被浏览器阻止，请再次点击播放。':error instanceof DOMException&&error.name==='AbortError'?'':'播放未开始，请重试或切换系统控件。');}
        throw error;
      }
    };
    node.play=requestPlay;
    const fullscreenTarget=node.closest<HTMLElement>('.enigma-video-skin');
    const nativeFullscreen=fullscreenTarget?.requestFullscreen;
    const nativePip=node instanceof HTMLVideoElement?node.requestPictureInPicture:undefined;
    if(fullscreenTarget&&nativeFullscreen)fullscreenTarget.requestFullscreen=async options=>{
      try{await nativeFullscreen.call(fullscreenTarget,options);if(!disposed&&!document.fullscreenElement)setMessage('当前宿主未进入全屏，可以使用系统控件或系统应用打开。');}
      catch(error){if(!disposed)setMessage('当前宿主无法进入全屏，可以使用系统控件或系统应用打开。');throw error;}
    };
    if(node instanceof HTMLVideoElement&&nativePip)node.requestPictureInPicture=async()=>{
      try{const window=await nativePip.call(node);if(!disposed&&!document.pictureInPictureElement)setMessage('当前宿主未开启画中画，可以使用系统应用打开。');return window;}
      catch(error){if(!disposed)setMessage('当前宿主无法开启画中画，可以使用系统应用打开。');throw error;}
    };
    // React StrictMode replays effects on an existing element after cleanup.
    if(node.getAttribute('src')!==src){node.src=src;node.load();}
    const hidden=()=>{if(!playbackAllowed())node.pause();};
    // A pending play promise may resolve after the preview is hidden.
    const guardPlayback=()=>{if(!playbackAllowed())node.pause();};
    document.addEventListener('visibilitychange',hidden);node.addEventListener('play',guardPlayback);
    node.addEventListener('leavepictureinpicture',hidden);
    return()=>{
      disposed=true;if(node.play===requestPlay)node.play=nativePlay;
      if(fullscreenTarget&&nativeFullscreen)fullscreenTarget.requestFullscreen=nativeFullscreen;
      if(node instanceof HTMLVideoElement&&nativePip)node.requestPictureInPicture=nativePip;
      document.removeEventListener('visibilitychange',hidden);node.removeEventListener('play',guardPlayback);
      node.removeEventListener('leavepictureinpicture',hidden);
      savePosition(node);node.pause();node.removeAttribute('src');node.load();
      if(document.pictureInPictureElement===node)void document.exitPictureInPicture().catch(()=>{});
    };
  },[src,restoreKey,systemControls]);
  useEffect(()=>()=>{subtitleSequence.current++;if(subtitleUrl.current)URL.revokeObjectURL(subtitleUrl.current);subtitleUrl.current='';},[src]);
  useEffect(()=>{if(!active)media.current?.pause();},[active]);
  const loaded=()=>{
    const node=media.current;if(!node)return;const previous=playbackPositions.get(restoreKey);
    if(previous&&!restored.current){
      if(Number.isFinite(node.duration)&&previous.time<node.duration)node.currentTime=previous.time;
      node.volume=previous.volume;node.muted=previous.muted;node.playbackRate=previous.rate;
    }
    restored.current=true;setState(node.paused?'paused':'playing');onReady();
  };
  const loadSubtitle=async(event:ChangeEvent<HTMLInputElement>)=>{
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    const sequence=++subtitleSequence.current;
    if(file.size>2*1024*1024){setMessage('字幕文件超过 2 MB，请选择更小的 WebVTT 文件。');return;}
    try{
      const text=(await file.text()).replace(/^\uFEFF/,'');if(sequence!==subtitleSequence.current)return;
      if(!/^WEBVTT(?:[ \t\r\n]|$)/.test(text))throw Error('请选择以 WEBVTT 开头的 .vtt 字幕文件。');
      const url=URL.createObjectURL(new Blob([text],{type:'text/vtt'}));
      if(subtitleUrl.current)URL.revokeObjectURL(subtitleUrl.current);subtitleUrl.current=url;
      setSubtitle({url,name:file.name});setMessage('');
    }catch(error){if(sequence===subtitleSequence.current)setMessage(error instanceof Error?error.message:'字幕未能读取，请重试。');}
  };
  const events={onLoadedMetadata:loaded,onError,
    onPlay:()=>setState('playing'),onPlaying:()=>setState('playing'),
    onPause:()=>setState(media.current?.ended?'ended':'paused'),onEnded:()=>setState('ended'),
    onWaiting:()=>{if(!media.current?.paused)setState('buffering');},
    onCanPlay:()=>setState(media.current?.paused?'paused':'playing'),
  };
  const element=kind==='video'
    ?<Video ref={node=>{media.current=node}} src={src} aria-label={name} playsInline preload="metadata" controls={systemControls} {...events}>
      {subtitle&&<track key={subtitle.url} kind="subtitles" srcLang="und" src={subtitle.url} label={subtitle.name} default onLoad={event=>{event.currentTarget.track.mode='showing';}} onError={()=>setMessage('字幕无法解析，请检查 WebVTT 内容。')}/>}
    </Video>
    :<Audio ref={node=>{media.current=node}} src={src} aria-label={name} preload="metadata" controls={systemControls} {...events}/>;
  return <div className={`enigma-media-player is-${kind}`} role="group" aria-label={`${name}播放控制`} data-playback-state={state}>
    <div className="enigma-player-stage">
      {kind==='audio'&&<div className="enigma-audio-cover" aria-hidden="true"><span>♫</span><strong>{name}</strong></div>}
      <I18nProvider locale="zh-CN" translations={zhCN}>
        {systemControls?<div className="enigma-native-player">{element}</div>:kind==='video'
          ?<VideoPlayer><VideoSkin className="enigma-video-skin">{element}</VideoSkin></VideoPlayer>
          :<AudioPlayer><AudioSkin className="enigma-audio-skin">{element}</AudioSkin></AudioPlayer>}
      </I18nProvider>
    </div>
    <div className="enigma-player-footer">
      <span role="status">{statusLabels[state]}</span>
      {kind==='video'&&<><input ref={subtitleInput} type="file" accept=".vtt,text/vtt" aria-label="选择 WebVTT 字幕" hidden onChange={event=>void loadSubtitle(event)}/><button type="button" onClick={()=>subtitleInput.current?.click()} title={subtitle?.name||'加载本机 .vtt 字幕；文件仅在当前播放器读取'}>加载字幕</button></>}
      <button type="button" aria-pressed={systemControls} onClick={()=>setSystemControls(value=>!value)} title="切换浏览器内置控件作为备用；保持播放位置，不自动播放">{systemControls?'返回增强控件':'系统控件'}</button>
    </div>
    <small className="enigma-player-help">聚焦播放器后：空格播放 · ← → 跳转 10 秒{kind==='video'?' · F 全屏':''}</small>
    {message&&<div className="enigma-player-message" role="alert">{message}</div>}
  </div>;
}
