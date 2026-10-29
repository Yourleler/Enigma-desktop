import {useCallback,useEffect,useId,useRef,useState,type KeyboardEvent} from 'react';
import './MediaPlayer.css';

type PlaybackState='loading'|'paused'|'playing'|'buffering'|'ended';
export function formatMediaTime(seconds:number):string {
  if(!Number.isFinite(seconds)||seconds<0)return '0:00';
  const whole=Math.floor(seconds),hours=Math.floor(whole/3600),minutes=Math.floor(whole/60)%60;
  return `${hours?hours+':':''}${hours?String(minutes).padStart(2,'0'):minutes}:${String(whole%60).padStart(2,'0')}`;
}
const statusLabels:Record<PlaybackState,string>={loading:'正在加载',paused:'已暂停',playing:'正在播放',buffering:'正在缓冲',ended:'播放结束'};
const playbackPositions=new Map<string,{time:number;volume:number;muted:boolean;rate:number}>();
type IconName='play'|'pause'|'replay'|'volume'|'mute'|'expand'|'collapse';
/** Small original media glyphs use the same stroke and grid as the app icons. */
function MediaIcon({name}:{name:IconName}) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name==='play'?<path d="m8 5 11 7-11 7Z"/>:name==='pause'?<><path d="M8 5v14M16 5v14"/></>:name==='replay'?<><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/></>:name==='expand'?<path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/>:name==='collapse'?<path d="M4 9h5V4m11 5h-5V4M9 20v-5H4m11 5v-5h5"/>:<><path d="M10 5 5 9H2v6h3l5 4Z"/>{name==='mute'?<path d="m16 9 6 6m0-6-6 6"/>:<><path d="M14 8a6 6 0 0 1 0 8M17 5a10 10 0 0 1 0 14"/></>}</>}
  </svg>;
}

interface Props {src:string;name:string;kind:'audio'|'video';restoreKey?:string;onReady:()=>void;onError:()=>void}
export function MediaPlayer({src,name,kind,restoreKey=src,onReady,onError}:Props) {
  const id=useId(),container=useRef<HTMLDivElement>(null),media=useRef<HTMLMediaElement|null>(null);
  const mounted=useRef(true),playSequence=useRef(0);
  const restored=useRef(false);
  const [state,setState]=useState<PlaybackState>('loading');
  const [ready,setReady]=useState(false),[duration,setDuration]=useState(0),[time,setTime]=useState(0);
  const [volume,setVolume]=useState(1),[muted,setMuted]=useState(false),[speed,setSpeed]=useState(1);
  const [seekDraft,setSeekDraft]=useState<number|null>(null);
  const [message,setMessage]=useState(''),[systemControls,setSystemControls]=useState(false),[fullscreen,setFullscreen]=useState(false);
  const [pip,setPip]=useState(false);
  const syncTime=useCallback(()=>{const element=media.current;if(element){setTime(element.currentTime);setDuration(element.duration);}},[]);
  const syncVolume=useCallback(()=>{const element=media.current;if(element){setVolume(element.volume);setMuted(element.muted);}},[]);
  useEffect(()=>{
    mounted.current=true;
    restored.current=false;
    const node=media.current;
    // StrictMode/remount checks replay effects on the same element. Restore
    // the attribute removed by cleanup before requesting metadata again.
    if(node&&node.getAttribute('src')!==src){node.src=src;node.load();}
    const onVisibility=()=>{if(document.hidden&&node&&!node.paused){playSequence.current++;node.pause();}};
    const onFullscreen=()=>setFullscreen(document.fullscreenElement===container.current);
    const enterPip=()=>setPip(true),leavePip=()=>setPip(false);
    document.addEventListener('visibilitychange',onVisibility);document.addEventListener('fullscreenchange',onFullscreen);
    node?.addEventListener('enterpictureinpicture',enterPip);node?.addEventListener('leavepictureinpicture',leavePip);
    return()=>{
      mounted.current=false;playSequence.current++;
      document.removeEventListener('visibilitychange',onVisibility);document.removeEventListener('fullscreenchange',onFullscreen);
      node?.removeEventListener('enterpictureinpicture',enterPip);node?.removeEventListener('leavepictureinpicture',leavePip);
      if(node){
        if(node.readyState>=1){playbackPositions.delete(restoreKey);playbackPositions.set(restoreKey,{time:node.currentTime,volume:node.volume,muted:node.muted,rate:node.playbackRate});if(playbackPositions.size>64)playbackPositions.delete(playbackPositions.keys().next().value!);}
        node.pause();node.removeAttribute('src');node.load();
      }
    };
  },[src,restoreKey]);
  const play=async()=>{
    const element=media.current;if(!element||!ready)return;
    const sequence=++playSequence.current;setMessage('');
    if(!element.paused&&!element.ended){element.pause();return;}
    if(element.ended)element.currentTime=0;
    try{await element.play();}
    catch(error){if(mounted.current&&sequence===playSequence.current){setState('paused');setMessage(error&&typeof error==='object'&&'name' in error&&error.name==='NotAllowedError'?'播放被浏览器阻止，请再次点击播放。':'播放未开始，请重试或切换系统控件。');}}
  };
  const seek=(value:number)=>{const element=media.current;if(!element||!Number.isFinite(duration)||duration<=0)return;const next=Math.min(duration,Math.max(0,value));element.currentTime=next;setTime(next);};
  const commitSeek=()=>{if(seekDraft!==null){seek(seekDraft);setSeekDraft(null);}};
  const setLoudness=(value:number)=>{const element=media.current;if(!element)return;element.volume=value;if(value>0)element.muted=false;syncVolume();};
  const toggleMute=()=>{const element=media.current;if(!element)return;if(element.volume===0){element.volume=.5;element.muted=false;}else element.muted=!element.muted;syncVolume();};
  const toggleFullscreen=async()=>{try{if(fullscreen)await document.exitFullscreen();else await container.current?.requestFullscreen();}catch{setMessage('无法进入全屏，请使用系统控件或系统应用。');}};
  const togglePip=async()=>{try{if(document.pictureInPictureElement)await document.exitPictureInPicture();else if(media.current instanceof HTMLVideoElement)await media.current.requestPictureInPicture();}catch{setMessage('当前视频无法开启画中画，可使用全屏查看。');}};
  const onKey=(event:KeyboardEvent<HTMLDivElement>)=>{
    if(event.target!==event.currentTarget||event.metaKey||event.ctrlKey||event.altKey)return;
    if(event.key===' '||event.key.toLowerCase()==='k'){event.preventDefault();void play();}
    else if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();seek(time+(event.key==='ArrowLeft'?-5:5));}
    else if(event.key.toLowerCase()==='m'){event.preventDefault();toggleMute();}
  };
  const events={
    onLoadedMetadata:()=>{
      const element=media.current,previous=playbackPositions.get(restoreKey);
      if(element&&previous&&!restored.current){
        if(Number.isFinite(element.duration)&&previous.time<element.duration)element.currentTime=previous.time;
        element.volume=previous.volume;element.muted=previous.muted;element.playbackRate=previous.rate;
      }
      restored.current=true;setReady(true);syncTime();syncVolume();setSpeed(element?.playbackRate||1);setState('paused');onReady();
    },
    onTimeUpdate:syncTime,onDurationChange:syncTime,onVolumeChange:syncVolume,
    onPlay:()=>setState('playing'),onPlaying:()=>setState('playing'),
    onPause:()=>setState(media.current?.ended?'ended':'paused'),onEnded:()=>{setState('ended');syncTime();},
    onWaiting:()=>{if(!media.current?.paused)setState('buffering');},
    onCanPlay:()=>setState(media.current?.paused?'paused':'playing'),
    onRateChange:()=>setSpeed(media.current?.playbackRate||1),onError,
  };
  const playLabel=state==='ended'?'重新播放':state==='playing'||state==='buffering'?'暂停':'播放';
  const finiteDuration=Number.isFinite(duration)&&duration>0;
  const shownTime=seekDraft??time;
  return <div ref={container} className={`enigma-media-player is-${kind}`} tabIndex={0} role="group" aria-label={`${name}播放控制`} onKeyDown={onKey} data-playback-state={state}>
    <div className="enigma-player-picture">
      {kind==='video'?<video id={id} ref={node=>{media.current=node}} src={src} controls={systemControls} playsInline preload="metadata" aria-label={name} {...events}/>:<><audio id={id} ref={node=>{media.current=node}} src={src} controls={systemControls} preload="metadata" aria-label={name} {...events}/><div className="enigma-audio-cover" aria-hidden="true"><MediaIcon name={muted?'mute':'volume'}/><span>音频</span><div className="enigma-audio-wave"><i/><i/><i/><i/><i/><i/><i/></div></div></>}
    </div>
    <div className="enigma-player-controls" aria-label="播放工具栏">
      <div className="enigma-player-progress"><input type="range" aria-label="播放进度" aria-valuetext={`${formatMediaTime(shownTime)} / ${finiteDuration?formatMediaTime(duration):'未知时长'}`} min={0} max={finiteDuration?duration:1} step={.1} value={Math.min(finiteDuration?duration:1,Math.max(0,shownTime))} disabled={!ready||!finiteDuration} onChange={event=>setSeekDraft(Number(event.target.value))} onPointerUp={commitSeek} onKeyUp={commitSeek} onBlur={commitSeek}/><span>{formatMediaTime(shownTime)}<span className="enigma-player-duration"> / {finiteDuration?formatMediaTime(duration):'--:--'}</span></span></div>
      <div className="enigma-player-buttons">
        <button type="button" className="enigma-player-play" aria-label={playLabel} title={`${playLabel} · Space / K`} aria-controls={id} onClick={()=>void play()} disabled={!ready}><MediaIcon name={state==='ended'?'replay':playLabel==='暂停'?'pause':'play'}/><span>{playLabel}</span></button>
        <span className="enigma-player-state" role="status">{statusLabels[state]}</span>
        <div className="enigma-player-volume"><button type="button" aria-label={muted||volume===0?'取消静音':'静音'} aria-pressed={muted||volume===0} title="静音 · M" onClick={toggleMute} disabled={!ready}><MediaIcon name={muted||volume===0?'mute':'volume'}/></button><input type="range" aria-label="音量" min={0} max={1} step={.05} value={muted?0:volume} disabled={!ready} onChange={event=>setLoudness(Number(event.target.value))}/></div>
        <select aria-label="播放速度" title="播放速度" value={speed} disabled={!ready} onChange={event=>{if(media.current){media.current.playbackRate=Number(event.target.value);setSpeed(Number(event.target.value))}}}>{[.5,.75,1,1.25,1.5,2].map(rate=><option key={rate} value={rate}>{rate}×</option>)}</select>
        {kind==='video'&&document.fullscreenEnabled&&<button type="button" aria-label={fullscreen?'退出全屏':'全屏'} title={fullscreen?'退出全屏':'全屏'} disabled={!ready} onClick={()=>void toggleFullscreen()}><MediaIcon name={fullscreen?'collapse':'expand'}/></button>}
        {kind==='video'&&document.pictureInPictureEnabled&&<button type="button" aria-label={pip?'退出画中画':'画中画'} aria-pressed={pip} title="画中画" disabled={!ready} onClick={()=>void togglePip()}>画中画</button>}
      </div>
      <div className="enigma-player-footer"><small>聚焦播放器后：空格播放 · ← → 跳转 5 秒</small><button type="button" aria-pressed={systemControls} onClick={()=>setSystemControls(value=>!value)} title="显示浏览器内置控制，可使用其额外播放选项">系统控件</button></div>
      {message&&<div className="enigma-player-message" role="alert">{message}</div>}
    </div>
  </div>;
}
