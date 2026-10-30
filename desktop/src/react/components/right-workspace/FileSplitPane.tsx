import {useEffect,useRef,useState,type CSSProperties,type ReactNode} from 'react';
import {dockScope,patchDockView,useRightDock} from '../../stores/right-dock-store';
import {useStore} from '../../stores';

export const clampFileListWidth=(value:number,total:number)=>Math.max(160,Math.min(value,Math.max(160,total-280)));

/** The file tree and its preview share a resizable split; narrow panes use one view. */
export function FileSplitPane({scope,preview,listOpen,children}:{scope:string;preview:ReactNode;listOpen?:boolean;children:ReactNode}){
  const saved=useRightDock(s=>s.views[scope]?.fileListWidth);
  const root=useRef<HTMLDivElement>(null),cleanup=useRef<()=>void>(()=>{});
  const [width,setWidth]=useState(saved||200),[resizing,setResizing]=useState(false);
  useEffect(()=>{setWidth(saved||200);},[scope,saved]);
  useEffect(()=>()=>cleanup.current(),[scope]);
  const commit=(next:number)=>{if(dockScope(useStore.getState())===scope)patchDockView(scope,{fileListWidth:Math.round(next)});};
  return <div ref={root} className="enigma-files-grid" data-has-preview={!!preview} data-list-open={listOpen||undefined} style={{'--file-list-width':`${width}px`} as CSSProperties}>
    <div className="enigma-files-list">{children}</div>
    {preview&&<>
      <div role="separator" aria-label="调整文件列表与预览宽度" aria-orientation="vertical" aria-valuemin={160} aria-valuemax={Math.max(160,(root.current?.clientWidth||520)-280)} aria-valuenow={width} tabIndex={0} className="enigma-file-splitter" data-tooltip="拖动调整预览大小 · 双击还原 · 方向键微调"
        onDoubleClick={()=>{setWidth(200);commit(200);}}
        onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const total=root.current?.clientWidth||520;const next=clampFileListWidth(e.key==='Home'?160:e.key==='End'?total:width+(e.key==='ArrowLeft'?-20:20),total);setWidth(next);commit(next);}}
        onPointerDown={e=>{
          if(e.button!==0||!root.current)return;e.preventDefault();cleanup.current();
          const rect=root.current.getBoundingClientRect();let next=clampFileListWidth(width,rect.width);setResizing(true);
          const move=(event:PointerEvent)=>{next=clampFileListWidth(event.clientX-rect.left,rect.width);setWidth(next);};
          const finish=()=>{commit(next);cleanup.current();};
          const cancel=()=>{setWidth(saved||200);cleanup.current();};
          const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();cancel();}};
          cleanup.current=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',cancel);window.removeEventListener('keydown',escape);window.removeEventListener('blur',cancel);setResizing(false);};
          window.addEventListener('pointermove',move);window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',cancel);window.addEventListener('keydown',escape);window.addEventListener('blur',cancel);
        }}/>
      <div className="enigma-files-document">{preview}</div>
    </>}
    {resizing&&<div className="enigma-split-drag-cover" data-native-browser-occluder=""/>}
  </div>;
}
