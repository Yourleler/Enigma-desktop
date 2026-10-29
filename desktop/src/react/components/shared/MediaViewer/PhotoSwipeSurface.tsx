import {useEffect,useMemo,useRef,useState} from 'react';
import type PhotoSwipe from 'photoswipe';
import type {SlideData} from 'photoswipe';
import type {FileRef} from '../../../types/file-ref';
import {useStore} from '../../../stores';
import {fileRefVersionToken} from '../../../services/resource-url';
import {loadImageData} from './image-data';
import {loadMediaSource} from './media-source';
import {isWebRuntime} from '../../../utils/platform-runtime';
import {resolveServerConnection,isLocalOwnerConnection} from '../../../services/server-connection';
import 'photoswipe/style.css';
import './PhotoSwipeSurface.css';

interface Props {files:readonly FileRef[];currentId:string;embedded?:boolean;onCurrent?:(id:string)=>void;onClose?:()=>void;onDock?:(file:FileRef)=>void;onExpand?:(file:FileRef)=>void}
interface Item extends SlideData {ready:boolean;error?:string;file:FileRef;cleanup?:()=>void}
export function PhotoSwipeSurface({files,currentId,embedded=false,onCurrent,onClose,onDock,onExpand}:Props){
  const host=useRef<HTMLDivElement>(null),instance=useRef<PhotoSwipe|null>(null),callbacks=useRef({onCurrent,onClose,onDock,onExpand,currentId});callbacks.current={onCurrent,onClose,onDock,onExpand,currentId};
  const [loading,setLoading]=useState(true),[failure,setFailure]=useState(''),[attempt,setAttempt]=useState(0);
  const connectionKey=useStore(state=>JSON.stringify([state.activeServerConnectionId,state.activeServerConnection?.baseUrl,state.activeServerConnection?.token,state.serverPort,state.serverToken]));
  const signature=JSON.stringify(files.map(file=>[file.id,file.kind,file.path,fileRefVersionToken(file),file.resource,file.inlineData,file.workbenchScope]));
  const list=useMemo(()=>[...files],[signature]);
  useEffect(()=>{
    const target=host.current;if(!target||!list.length)return;
    let disposed=false,pswp:PhotoSwipe|undefined;
    const abort=new AbortController(),pending=new Map<number,Promise<void>>(),media=new Map<object,HTMLVideoElement>();
    const data:Item[]=list.map(file=>({file,ready:false,type:file.kind==='video'?'html':'image',src:'about:blank',width:800,height:600,alt:file.name}));
    const cleanupDownloads=new Map<string,ReturnType<typeof setTimeout>>();
    const releaseVideos=()=>{media.forEach(video=>{video.pause();video.removeAttribute('src');video.load();});media.clear();};
    setLoading(true);setFailure('');
    const currentFile=()=>list[pswp?.currIndex||0];
    const canLocal=()=>{const connection=resolveServerConnection(useStore.getState());return !isWebRuntime()&&(!connection||isLocalOwnerConnection(connection));};
    const prepare=(index:number,retry=false):Promise<void>=>{
      if(pending.has(index))return pending.get(index)!;const item=data[index];if(!item||item.ready&&!retry)return Promise.resolve();
      const promise=(async()=>{
        item.cleanup?.();item.cleanup=undefined;item.error=undefined;item.ready=false;item.type=item.file.kind==='video'?'html':'image';
        try{
          if(item.file.kind==='video'){const source=await loadMediaSource(item.file);if(disposed){source.cleanup?.();return;}Object.assign(item,{src:source.url,cleanup:source.cleanup,ready:true});}
          else {const info=await loadImageData(item.file,abort.signal);if(disposed){info.cleanup?.();return;}Object.assign(item,{src:info.src,width:info.width,height:info.height,cleanup:info.cleanup,ready:true,type:'image'});}
        }catch(error){if(disposed)return;Object.assign(item,{ready:true,error:error instanceof Error?error.message:'文件无法读取',type:'html'});}
        if(!disposed&&pswp?.isOpen)pswp.refreshSlideContent(index);
      })().finally(()=>pending.delete(index));pending.set(index,promise);return promise;
    };
    const showNotice=(message:string)=>{const caption=pswp?.element?.querySelector('.enigma-photo-info');if(caption)caption.textContent=message;};
    const download=async()=>{
      const item=data[pswp?.currIndex||0];if(!item?.ready||item.error)return;
      try{const response=await fetch(item.src!,{signal:abort.signal});if(!response.ok)throw Error();const blob=await response.blob();if(disposed)return;
        const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=item.file.name;document.body.append(link);link.click();link.remove();cleanupDownloads.set(url,setTimeout(()=>{URL.revokeObjectURL(url);cleanupDownloads.delete(url);},60000));
      }catch{if(!disposed)showNotice('下载失败，请重试或用系统应用打开。');}
    };
    const update=()=>{
      if(!pswp?.element)return;const item=data[pswp.currIndex],slide=pswp.currSlide;if(!item)return;
      const title=pswp.element.querySelector<HTMLElement>('.enigma-photo-title');if(title){title.textContent=item.file.name;title.title=item.file.name;}
      const info=pswp.element.querySelector<HTMLElement>('.enigma-photo-info');if(info){info.textContent=item.error||(!item.ready?'正在读取文件…':item.file.kind==='video'?'视频 · 系统播放控件':`${item.width} × ${item.height} 像素 · ${Math.round((slide?.currZoomLevel||1)*100)}% · 滚轮缩放，放大后拖动`);}
      for(const action of ['fit','original','zoom-in','zoom-out']){const button=pswp.element.querySelector<HTMLButtonElement>('.pswp__button--'+action);if(button)button.disabled=!item.ready||!!item.error||item.file.kind==='video';}
      for(const action of ['open-system','reveal']){const button=pswp.element.querySelector<HTMLButtonElement>('.pswp__button--'+action);if(button)button.hidden=!canLocal()||!item.file.path;}
      const button=pswp.element.querySelector<HTMLButtonElement>('.pswp__button--download');if(button)button.disabled=!item.ready||!!item.error;
      if(item.ready)callbacks.current.onCurrent?.(item.file.id);
    };
    void(async()=>{
      const start=Math.max(0,list.findIndex(file=>file.id===callbacks.current.currentId));
      const [{default:PhotoSwipe}]=await Promise.all([import('photoswipe'),prepare(start)]);if(disposed)return;
      pswp=new PhotoSwipe({dataSource:data,index:start,appendToEl:target,getViewportSizeFn:()=>({x:target.clientWidth,y:target.clientHeight}),mainClass:`enigma-photoswipe ${embedded?'enigma-photoswipe-inline':'enigma-photoswipe-gallery'}`,bgOpacity:embedded?1:.96,showHideAnimationType:'none',showAnimationDuration:0,hideAnimationDuration:0,zoomAnimationDuration:document.body.classList.contains('enigma-motion-off')||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?0:180,loop:false,wheelToZoom:true,closeOnVerticalDrag:false,pinchToClose:false,trapFocus:!embedded,returnFocus:!embedded,escKey:!embedded,arrowKeys:!embedded,close:!embedded,zoom:false,counter:list.length>1,arrowPrev:list.length>1,arrowNext:list.length>1,clickToCloseNonZoomable:false,imageClickAction:false,bgClickAction:embedded?false:'close',tapAction:false,doubleTapAction:'zoom',initialZoomLevel:'fit',secondaryZoomLevel:1,maxZoomLevel:level=>Math.max(4,level.fit*4),paddingFn:()=>({top:Math.max(48,pswp?.element?.querySelector('.pswp__top-bar')?.getBoundingClientRect().height||78)+10,bottom:48,left:16,right:16}),preload:[1,1],closeTitle:'关闭查看器',arrowPrevTitle:'上一张',arrowNextTitle:'下一张',errorMsg:'文件无法读取，请重试或用系统应用打开。'});
      instance.current=pswp;
      const offset=()=>{const rect=target.getBoundingClientRect();pswp!.offset.x=rect.left+window.scrollX;pswp!.offset.y=rect.top+window.scrollY;};
      pswp.on('updateScrollOffset',offset);pswp.on('afterInit',offset);
      pswp.on('wheel',event=>{if(!embedded)return;event.preventDefault();const wheel=event.originalEvent,slide=pswp!.currSlide;if(!slide?.isZoomable())return;const rect=target.getBoundingClientRect();const factor=2**(-wheel.deltaY*(wheel.deltaMode===1?.05:wheel.deltaMode?1:.002));slide.zoomTo(slide.currZoomLevel*factor,{x:wheel.clientX-rect.left,y:wheel.clientY-rect.top});});
      pswp.addFilter('preventPointerEvent',(prevent,event)=>event.target instanceof Element&&event.target.closest('video,button,input,select')?false:prevent);
      pswp.on('uiRegister',()=>{
        const button=(name:string,label:string,order:number,action:()=>void)=>pswp!.ui!.registerElement({name,title:label,ariaLabel:label,order,isButton:true,html:label,onClick:action});
        pswp!.ui!.registerElement({name:'file-title',className:'enigma-photo-title',order:1,appendTo:'bar',onInit:element=>{element.setAttribute('aria-live','polite');}});
        button('zoom-out','缩小',5,()=>{const slide=pswp!.currSlide;if(slide)pswp!.zoomTo(slide.currZoomLevel/1.5);});
        button('fit','适应',6,()=>{const slide=pswp!.currSlide;if(slide)pswp!.zoomTo(slide.zoomLevels.fit);});
        button('original','原始大小',7,()=>pswp!.zoomTo(1));
        button('zoom-in','放大',8,()=>{const slide=pswp!.currSlide;if(slide)pswp!.zoomTo(slide.currZoomLevel*1.5);});
        button('download','下载',9,()=>void download());
        button('open-system','系统打开',10,()=>{const file=currentFile();if(canLocal()&&file.path)window.platform.openFile(file.path);});
        button('reveal','位置',11,()=>{const file=currentFile();if(canLocal()&&file.path)window.platform.showInFinder?.(file.path);});
        if(embedded&&callbacks.current.onExpand)button('expand','画廊',12,()=>callbacks.current.onExpand?.(currentFile()));
        if(!embedded&&callbacks.current.onDock)button('dock','在侧栏查看',12,()=>callbacks.current.onDock?.(currentFile()));
        pswp!.ui!.registerElement({name:'file-info',className:'enigma-photo-info',appendTo:'root',order:20,onInit:element=>{element.setAttribute('role','status');}});
      });
      pswp.on('contentLoad',event=>{
        const content=event.content,item=data[content.index];if(!item)return;
        if(!item.ready){event.preventDefault();void prepare(content.index);return;}
        if(item.error){event.preventDefault();const node=document.createElement('div');node.className='enigma-photo-error';const message=document.createElement('p');message.textContent=item.error;const retry=document.createElement('button');retry.textContent='重新加载';retry.onclick=()=>void prepare(content.index,true);node.append(message,retry);content.element=node;content.onLoaded();return;}
        if(item.file.kind==='video'){
          event.preventDefault();const node=document.createElement('div');node.className='enigma-photo-video';const video=document.createElement('video');video.src=item.src!;video.controls=true;video.preload='metadata';video.playsInline=true;video.setAttribute('aria-label',item.file.name);node.append(video);content.element=node;media.set(content,video);video.onloadeddata=()=>content.onLoaded();video.onerror=()=>content.onError();content.onLoaded();
        }
      });
      pswp.on('contentDeactivate',event=>media.get(event.content)?.pause());
      pswp.on('contentDestroy',event=>{const video=media.get(event.content);if(video){video.pause();video.removeAttribute('src');video.load();media.delete(event.content);}});
      pswp.on('keydown',event=>{const keyEvent=event.originalEvent;const element=keyEvent.target as Element|null;
        if(embedded&&(!target.contains(document.activeElement)||!!document.querySelector('.enigma-photoswipe-gallery'))||element?.closest('input,textarea,select,video,[contenteditable=true]')&&(keyEvent.key!=='Escape'||!!document.fullscreenElement)){event.preventDefault();return;}
        if(['+','=','-','0'].includes(keyEvent.key)){event.preventDefault();keyEvent.preventDefault();const slide=pswp!.currSlide;if(slide){const zoom=keyEvent.key==='0'?slide.zoomLevels.fit:slide.currZoomLevel*(keyEvent.key==='-'?1/1.5:1.5);pswp!.zoomTo(zoom);}}
      });
      pswp.addFilter('contentErrorElement',(element,content)=>{const button=document.createElement('button');button.textContent='重新加载';button.onclick=()=>void prepare(content.index,true);element.append(button);return element;});
      pswp.on('change',update);pswp.on('zoomPanUpdate',update);pswp.on('loadComplete',update);pswp.on('loadError',event=>{const item=data[event.content.index];if(item)item.error='无法读取或解码此媒体，请重试或用系统应用打开。';update();});pswp.on('close',()=>{releaseVideos();if(!disposed)callbacks.current.onClose?.();});
      pswp.init();
      const itemsId='enigma-photo-'+crypto.randomUUID();if(pswp.container)pswp.container.id=itemsId;pswp.element?.querySelectorAll('[aria-controls="pswp__items"]').forEach(element=>element.setAttribute('aria-controls',itemsId));
      pswp.element?.addEventListener('dblclick',event=>{if((event.target as Element)?.closest('img.pswp__img')){event.preventDefault();pswp!.toggleZoom();}});
      pswp.element?.addEventListener('pointerdown',event=>{offset();if(embedded&&!(event.target as Element).closest('button,input,video,select'))target.focus({preventScroll:true});},{capture:true});
      if(!embedded){pswp.element?.setAttribute('aria-label','媒体画廊');pswp.element?.setAttribute('aria-modal','true');}
      if(embedded){pswp.element?.setAttribute('role','group');pswp.element?.removeAttribute('aria-modal');pswp.element?.setAttribute('aria-label','图片缩放与拖动');}setLoading(false);update();
    })().catch(()=>{if(!disposed){setLoading(false);setFailure('图片查看器未能启动，请重试');}});
    const resize=new ResizeObserver(()=>pswp?.updateSize(true));resize.observe(target);
    const hidden=()=>{if(document.hidden)media.forEach(video=>video.pause());};document.addEventListener('visibilitychange',hidden);
    return()=>{disposed=true;abort.abort();resize.disconnect();document.removeEventListener('visibilitychange',hidden);releaseVideos();pswp?.destroy();instance.current=null;data.forEach(item=>item.cleanup?.());cleanupDownloads.forEach((timer,url)=>{clearTimeout(timer);URL.revokeObjectURL(url);});};
  },[signature,connectionKey,embedded,attempt]);
  useEffect(()=>{const index=list.findIndex(file=>file.id===currentId);if(index>=0&&instance.current&&instance.current.currIndex!==index)instance.current.goTo(index);},[currentId,list]);
  return <div ref={host} className={`enigma-photo-host ${embedded?'is-inline':'is-gallery'}`} tabIndex={embedded?0:-1} data-testid="photoswipe-host">{loading&&<div className="enigma-photo-loading" role="status">正在加载图片…{onClose&&<button onClick={onClose}>关闭</button>}</div>}{failure&&<div className="enigma-photo-loading" role="alert"><p>{failure}</p><button onClick={()=>setAttempt(value=>value+1)}>重新加载</button>{onClose&&<button onClick={onClose}>关闭</button>}</div>}</div>;
}
