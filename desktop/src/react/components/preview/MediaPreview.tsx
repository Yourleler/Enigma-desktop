import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PreviewItem } from '../../types';
import type { FileRef } from '../../types/file-ref';
import { inferKindByExt } from '../../utils/file-kind';
import { ImageStage } from '../shared/MediaViewer/ImageStage';
import { loadMediaSource } from '../shared/MediaViewer/media-source';
import { fileRefVersionToken } from '../../services/resource-url';
import { AppIcon } from '../../ui/app-icons';
import './MediaPreview.css';
import {MediaPlayer} from './MediaPlayer';

export function MediaPreview({previewItem}: {previewItem: PreviewItem}) {
  const file = useMemo<FileRef>(() => previewItem.mediaRef ? {...previewItem.mediaRef, version: previewItem.fileVersion ?? previewItem.mediaRef.version} : {
    id: previewItem.id, source: 'desk', path: previewItem.filePath || '', name: previewItem.title,
    kind: inferKindByExt(previewItem.ext), ext: previewItem.ext, version: previewItem.fileVersion,
  }, [previewItem]);
  const image = file.kind === 'image' || file.kind === 'svg';
  const [viewport, setViewport] = useState({width: 320, height: 400});
  const [zoom, setZoom] = useState({in: 0, out: 0, reset: 0});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [source, setSource] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(()=>{
    if(ready||error)return;
    const timer=setTimeout(()=>setError('媒体加载超时，请重试或使用系统应用打开。'),15000);
    return()=>clearTimeout(timer);
  },[ready,error,attempt,file.id]);
  const stage = useRef<HTMLDivElement>(null);
  const version = fileRefVersionToken(file);
  const onError = useCallback(() => setError('无法读取或解码此文件。文件可能已移动，或当前系统不支持它的格式。'), []);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const update = () => {const rect = element.getBoundingClientRect(); setViewport({width: rect.width, height: rect.height});};
    const resize = new ResizeObserver(update); resize.observe(element); update();
    return () => resize.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false;
    let cleanup:(()=>void)|undefined;
    setReady(false); setError(''); setSource('');
    if (!image) void loadMediaSource(file).then(value => {if(cancelled){value.cleanup?.();return;}cleanup=value.cleanup;setSource(value.url);}).catch(() => {if (!cancelled) onError();});
    return () => {cancelled = true;cleanup?.();};
  // The same source is refreshed only on identity/version changes or retry.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id, version, image, attempt, onError]);
  return <section className="enigma-media-preview" aria-label={`${file.name}预览`}>
    <div className="enigma-media-toolbar">
      <span title={file.name}><b>{file.name}</b><small>{image ? '图片' : file.kind === 'video' ? '视频' : '音频'} · {file.ext?.toUpperCase()}</small></span>
      {image && <><button aria-label="缩小图片" title="缩小图片" onClick={() => setZoom(value => ({...value, out: value.out + 1}))}>−</button><button aria-label="适应面板" title="适应面板；双击图片可切换原始大小" onClick={() => setZoom(value => ({...value, reset: value.reset + 1}))}><AppIcon name="compact" size={15}/></button><button aria-label="放大图片" title="放大图片" onClick={() => setZoom(value => ({...value, in: value.in + 1}))}>＋</button></>}
      {file.path && window.platform?.openFile && <button title="使用系统默认应用打开文件" onClick={() => window.platform.openFile(file.path)}>系统打开</button>}
    </div>
    <div className="enigma-media-stage" ref={stage}>
      {!error && !ready && <div className="enigma-media-loading" role="status">正在加载{image ? '图片' : '媒体'}…</div>}
      {error ? <div className="enigma-media-error" role="alert"><p>{error}</p><button onClick={() => setAttempt(value => value + 1)}>重新加载</button></div> : image ?
        <ImageStage key={`${file.id}:${version}:${attempt}`} file={file} viewport={viewport} zoomCmd={zoom} onReady={() => setReady(true)} onError={onError}/> : source && (
          <MediaPlayer key={`${file.id}:${version}:${attempt}`} restoreKey={`${file.id}:${version}`} src={source} kind={file.kind==='video'?'video':'audio'} name={file.name} onReady={()=>setReady(true)} onError={onError}/>
        )}
    </div>
    {image && <small className="enigma-media-hint">滚轮缩放 · 放大后拖动 · 双击切换原始大小</small>}
  </section>;
}
