import {useEffect} from 'react';
import {useStore} from '../../../stores';
import {PhotoSwipeSurface} from './PhotoSwipeSurface';
import {openMediaPreview} from '../../../utils/media-preview';
import {isMediaKind} from '../../../utils/file-kind';
export function MediaViewer(){
  const state=useStore(s=>s.mediaViewer),close=useStore(s=>s.closeMediaViewer),setCurrent=useStore(s=>s.setMediaViewerCurrent);
  useEffect(()=>{if(state&&!state.files.some(file=>file.id===state.currentId&&isMediaKind(file.kind)))close();},[state,close]);
  if(!state)return null;const files=state.files.filter(file=>isMediaKind(file.kind));
  return <PhotoSwipeSurface files={files} currentId={state.currentId} onClose={close} onCurrent={id=>{if(id!==useStore.getState().mediaViewer?.currentId)setCurrent(id);}} onDock={file=>{openMediaPreview(file);close();}}/>;
}
