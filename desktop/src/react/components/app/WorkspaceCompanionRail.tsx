import { usePanelExit } from '../../hooks/use-panel-exit';
import { useStore } from '../../stores';
import { RegionalErrorBoundary } from '../RegionalErrorBoundary';
import { RightDock } from '../right-workspace/RightDock';
import { WorkspaceFileChangeBridge } from './WorkspaceFileChangeBridge';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEngineering } from '../../engineering/state';
import { updateLayout } from '../SidebarLayout';

export function WorkspaceCompanionRail() {
  const jianOpen = useStore(s => s.jianOpen);
  const engineeringConnected = useEngineering(s => !!s.snapshot?.connected && s.paneOpen && !!s.active);
  const engineering = engineeringConnected;
  const layoutDrawer=useStore(s=>s.layoutDrawer);
  const autoCollapsed=useStore(s=>s.jianAutoCollapsed);
  const [narrow,setNarrow]=useState(()=>window.innerWidth<=860);
  const rail=useRef<HTMLElement>(null);
  const drawer=layoutDrawer==='workspace'&&jianOpen;
  const {floating,entering} = usePanelExit(drawer);
  const close=()=>{useStore.setState({jianOpen:false,jianAutoCollapsed:false,layoutDrawer:null});};

  useEffect(()=>{
    if(engineering)updateLayout();
  },[engineering,jianOpen,narrow]);
  useEffect(()=>{
    if(typeof window.matchMedia!=='function'){const change=()=>setNarrow(window.innerWidth<=860);window.addEventListener('resize',change);return()=>window.removeEventListener('resize',change);}
    const media=window.matchMedia('(max-width: 860px)'),change=()=>setNarrow(media.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change);
  },[]);
  useEffect(()=>{
    if(!drawer)return;
    const previous=document.activeElement as HTMLElement|null;
    // The catalogue may open both this drawer and an operation dialog in the
    // same render. The dialog owns focus until it is dismissed.
    if(!document.querySelector('.enigma-modal-backdrop'))rail.current?.querySelector<HTMLElement>('.enigma-dock-actions button[aria-label="收起工作面板"]')?.focus();
    const regions=[...document.querySelectorAll<HTMLElement>('.main-content:not([data-layout-managed]),.sidebar:not([data-layout-managed]),#previewPanel:not([data-layout-managed])')],inert=regions.map(region=>region.inert);
    regions.forEach(region=>{region.inert=true;});
    const key=(event:KeyboardEvent)=>{
      if(document.querySelector('.enigma-modal-backdrop,.enigma-surface-menu'))return;
      if(event.key==='Escape'){event.preventDefault();close();}
      if(event.key==='Tab'){
        const items=[...rail.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')||[]].filter(item=>item.getClientRects().length);
        const first=items[0],last=items.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    };
    document.addEventListener('keydown',key);
    return()=>{document.removeEventListener('keydown',key);regions.forEach((region,index)=>{region.inert=inert[index];});previous?.focus();};
  },[drawer]);

  return (
    <>
      <WorkspaceFileChangeBridge />
      {drawer&&createPortal(<button className="enigma-drawer-scrim" aria-label="关闭内容面板遮罩" tabIndex={-1} onClick={close}/>,document.body)}
      <aside ref={rail} className={`jian-sidebar${jianOpen ? '' : ' collapsed'}${drawer?' enigma-drawer':''}`} id="jianSidebar" data-floating={floating || undefined} data-panel-entering={entering || undefined} data-layout-managed="" data-auto-collapsed={autoCollapsed || undefined} inert={!jianOpen || layoutDrawer === 'sidebar'} aria-hidden={!jianOpen} role={drawer?'dialog':undefined} aria-modal={drawer||undefined} aria-label={drawer?'工作面板':undefined}>
        <div className="resize-handle resize-handle-left" id="jianResizeHandle"></div>
        <div className="jian-sidebar-inner">
          <RegionalErrorBoundary region="right-workspace">
            <RightDock />
          </RegionalErrorBoundary>
        </div>
      </aside>
    </>
  );
}
