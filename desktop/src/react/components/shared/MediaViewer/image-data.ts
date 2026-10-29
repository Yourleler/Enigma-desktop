import type {FileRef} from '../../../types/file-ref';
import {loadMediaSource} from './media-source';
export interface ImageData {src:string;width:number;height:number;cleanup?:()=>void}
/** Decode dimensions using the browser; no conversion or upload of image files. */
export async function loadImageData(file:FileRef,signal:AbortSignal):Promise<ImageData>{
  signal.throwIfAborted();const source=await loadMediaSource(file);
  if(signal.aborted){source.cleanup?.();signal.throwIfAborted();}
  try{
    const dimensions=await new Promise<{width:number;height:number}>((resolve,reject)=>{
      const image=new Image();let done=false;
      const finish=(error?:unknown)=>{if(done)return;done=true;clearTimeout(timer);signal.removeEventListener('abort',abort);image.onload=image.onerror=null;const width=image.naturalWidth,height=image.naturalHeight;image.removeAttribute('src');error?reject(error):width>0&&height>0?resolve({width,height}):reject(new Error('图片尺寸无效'));};
      const abort=()=>finish(new DOMException('Cancelled','AbortError'));
      const timer=setTimeout(()=>finish(new Error('图片加载超时，请重试')),20000);
      signal.addEventListener('abort',abort,{once:true});image.onload=()=>finish();image.onerror=()=>finish(new Error('无法读取或解码图片，请重试或用系统应用打开'));image.src=source.url;
    });
    return {src:source.url,...dimensions,cleanup:source.cleanup};
  }catch(error){source.cleanup?.();throw error;}
}
