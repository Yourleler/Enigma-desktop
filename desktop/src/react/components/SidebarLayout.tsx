import {dockScope,dockView,selectDockTab,useRightDock} from '../stores/right-dock-store';
import { useChangesPanel } from '../stores/changes-panel-store';
/** Shared desktop layout arbitration: preserve useful reading widths and user intent. */
import { useLayoutEffect } from 'react';
import { useStore } from '../stores';
import { createNewSession } from '../stores/session-actions';
import { closePreview } from '../stores/preview-actions';
import { useEngineering } from '../engineering/state';
import { resolveWorkspaceLayout, type LayoutIntent } from '../utils/workspace-layout';
import './WorkspaceLayout.css';

function preferredWidth(variable:string,key:string,fallback:number):number {
  const explicit=parseFloat(document.documentElement.style.getPropertyValue(variable));
  const saved=Number(localStorage.getItem(key));
  return Number.isFinite(explicit)&&explicit>0?explicit:Number.isFinite(saved)&&saved>0?saved:fallback;
}
let resolving=false;
export function updateLayout(intent?:LayoutIntent):void {
  if(resolving)return;
  resolving=true;
  try{
    const s=useStore.getState(),root=document.documentElement;
    const app=document.querySelector<HTMLElement>('.app');
    const width=app?.clientWidth||window.innerWidth;
    const expanded=(s.jianOpen||s.jianAutoCollapsed)&&dockView(dockScope(s)).expanded;
    const result=resolveWorkspaceLayout({width,
      sidebarWidth:preferredWidth('--sidebar-preferred-width','hana-sidebar-width',240),
      workspaceWidth:preferredWidth('--right-dock-preferred-width','enigma-dock-width',520),
      inspectorWidth:s.currentTab==='channels'&&s.currentChannel?preferredWidth('--channel-inspector-width','hana-channel-inspector-width',280):0,
      sidebarWanted:!String(s.currentTab).startsWith('plugin:')&&(s.sidebarOpen||s.sidebarAutoCollapsed),
      workspaceWanted:s.jianOpen||s.jianAutoCollapsed,
      priority:s.layoutPriority,expanded,drawer:s.layoutDrawer,intent,
    });
    const {sidebarWidth,workspaceWidth,previewWidth,...state}=result;
    const properties:Record<string,string>={
      '--layout-sidebar-width':`${sidebarWidth}px`,
      '--right-dock-width':`${workspaceWidth}px`,
      '--layout-chat-min':`${Math.min(400,width)}px`,
      '--layout-sidebar-space':`${state.sidebarOpen?sidebarWidth:0}px`,
      '--layout-workspace-space':`${state.jianOpen?workspaceWidth:0}px`,
    };
    for(const [name,value] of Object.entries(properties))if(root.style.getPropertyValue(name)!==value)root.style.setProperty(name,value);
    document.body.classList.toggle('enigma-dock-expanded',expanded&&state.jianOpen);
    if(Object.entries(state).some(([key,value])=>s[key as keyof typeof s]!==value))useStore.setState(state);
  }finally{resolving=false;}
}

export function toggleSidebar(forceOpen?: boolean): void {
  const s = useStore.getState(), open = forceOpen ?? !s.sidebarOpen;
  localStorage.setItem(`hana-sidebar-${s.currentTab || 'chat'}`, open ? 'open' : 'closed');
  useStore.setState({ sidebarOpen: open, sidebarAutoCollapsed: false,
    ...(s.layoutDrawer === 'sidebar' && !open ? {layoutDrawer: null} : {}) });
  updateLayout(open ? 'sidebar' : undefined);
}

export function SidebarLayout({ restorePreference = true }: { restorePreference?: boolean } = {}) {
  const drawer = useStore(s => s.layoutDrawer);
  useLayoutEffect(() => {
    const legacy = localStorage.getItem('hana-sidebar');
    if (legacy && !localStorage.getItem('hana-sidebar-chat')) localStorage.setItem('hana-sidebar-chat', legacy);
    if (restorePreference) useStore.setState({ sidebarOpen: localStorage.getItem('hana-sidebar-chat') !== 'closed', sidebarAutoCollapsed: false, jianAutoCollapsed: false });
    let frame = 0;
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; updateLayout(); }); };
    const unsubscribe = useStore.subscribe((s, previous) => {
      if (['sidebarOpen','jianOpen','previewOpen','currentTab','currentChannel','layoutDrawer'].some(key => s[key as keyof typeof s] !== previous[key as keyof typeof previous])) schedule();
    });
    const unsubscribeEngineering = useEngineering.subscribe((s, previous) => {
      if (s.sessionPath !== previous.sessionPath || s.connectionId !== previous.connectionId) { schedule(); return; }
      if (s.paneOpen && s.active && (s.paneOpen !== previous.paneOpen || s.active !== previous.active)) { useChangesPanel.setState({open:false});selectDockTab(dockScope(useStore.getState()),'tools');useStore.setState({jianOpen:true,jianAutoCollapsed:false}); updateLayout('workspace'); }
      else if (s.paneOpen !== previous.paneOpen || s.active !== previous.active || !!s.snapshot?.connected !== !!previous.snapshot?.connected) schedule();
    });
    const unsubscribeChanges = useChangesPanel.subscribe((s,previous) => { if(s.open&&(s.open!==previous.open||s.session!==previous.session)){selectDockTab(dockScope(useStore.getState()),'changes');useStore.setState({jianOpen:true,jianAutoCollapsed:false});updateLayout('workspace');} });
    const unsubscribeDock=useRightDock.subscribe(()=>schedule());
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    // Inner panel widths animate; observing them feeds transient geometry back
    // into the decision and can alternate open/closed states. Observe the viewport only.
    const app=document.querySelector('.app');if(app)observer?.observe(app);
    window.addEventListener('resize', schedule);
    updateLayout();
    const onKeydown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); toggleSidebar(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); createNewSession(); }
      if (e.key === 'Escape' && !useStore.getState().layoutDrawer && !document.querySelector('[role="dialog"],[role="menu"],.cm-panels') && useStore.getState().previewOpen) closePreview();
    };
    document.addEventListener('keydown', onKeydown);
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); unsubscribe(); unsubscribeEngineering(); unsubscribeChanges(); unsubscribeDock(); window.removeEventListener('resize', schedule); document.removeEventListener('keydown', onKeydown); };
  }, [restorePreference]);

  useLayoutEffect(()=>{
    if(!drawer)return;
    const key=(event:KeyboardEvent)=>{
      if(event.defaultPrevented||document.querySelector('[role="dialog"],[role="menu"],.enigma-surface-menu'))return;
      if(event.key==='Escape'){
        event.preventDefault();
        if(drawer==='sidebar')toggleSidebar(false);
        else{useStore.setState({jianOpen:false,jianAutoCollapsed:false,layoutDrawer:null});updateLayout();}
      }
    };
    document.addEventListener('keydown',key);
    return()=>document.removeEventListener('keydown',key);
  },[drawer]);
  return null;
}
