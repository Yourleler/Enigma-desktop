import {useCallback,useEffect,useMemo,useState} from 'react';
import type {PreviewItem} from '../../types';
import type {FileRef} from '../../types/file-ref';
import {inferKindByExt} from '../../utils/file-kind';
import {PhotoSwipeSurface} from '../shared/MediaViewer/PhotoSwipeSurface';
import {openMediaViewerForRef} from '../../utils/open-media-viewer';
import {loadMediaSource} from '../shared/MediaViewer/media-source';
import {fileRefVersionToken} from '../../services/resource-url';
import {MediaPlayer} from './MediaPlayer';
import './MediaPreview.css';
export function MediaPreview({previewItem}:{previewItem:PreviewItem}){
  const file=useMemo<FileRef>(()=>previewItem.mediaRef?{...previewItem.mediaRef,version:previewItem.fileVersion??previewItem.mediaRef.version}:{id:previewItem.id,source:'desk',path:previewItem.filePath||'',name:previewItem.title,kind:inferKindByExt(previewItem.ext),ext:previewItem.ext,version:previewItem.fileVersion},[previewItem]);
  if(file.kind==='image'||file.kind==='svg')return <PhotoSwipeSurface files={[file]} currentId={file.id} embedded onExpand={current=>openMediaViewerForRef(current,{origin:'desk'})}/>;
  return <AudioVideoPreview file={file}/>;
}
function AudioVideoPreview({file}:{file:FileRef}){
  const [ready,setReady]=useState(false),[error,setError]=useState(''),[source,setSource]=useState(''),[attempt,setAttempt]=useState(0);
  const version=fileRefVersionToken(file);
  const onError=useCallback(()=>setError('无法读取或解码此文件。文件可能已移动，或当前系统不支持它的格式。'),[]);
  useEffect(()=>{if(ready||error)return;const timer=setTimeout(()=>setError('媒体加载超时，请重试或使用系统应用打开。'),15000);return()=>clearTimeout(timer);},[ready,error,attempt,file.id]);
  useEffect(()=>{
    let cancelled=false,cleanup:(()=>void)|undefined;setReady(false);setError('');setSource('');
    void loadMediaSource(file).then(value=>{if(cancelled){value.cleanup?.();return;}cleanup=value.cleanup;setSource(value.url);}).catch(()=>{if(!cancelled)onError();});
    return()=>{cancelled=true;cleanup?.();};
  },[file.id,version,attempt,onError]);
  return <section className="enigma-media-preview" aria-label={`${file.name}预览`}>
    <div className="enigma-media-toolbar"><span title={file.name}><b>{file.name}</b><small>{file.kind==='video'?'视频':'音频'} · {file.ext?.toUpperCase()}</small></span>{file.path&&window.platform?.openFile&&<button title="使用系统默认应用打开文件" onClick={()=>window.platform.openFile(file.path)}>系统打开</button>}</div>
    <div className="enigma-media-stage">{!error&&!ready&&<div className="enigma-media-loading" role="status">正在加载媒体…</div>}{error?<div className="enigma-media-error" role="alert"><p>{error}</p><button onClick={()=>setAttempt(value=>value+1)}>重新加载</button></div>:source&&<MediaPlayer key={`${file.id}:${version}:${attempt}`} restoreKey={`${file.id}:${version}`} src={source} kind={file.kind==='video'?'video':'audio'} name={file.name} onReady={()=>setReady(true)} onError={onError}/>}</div>
  </section>;
}
