import {dockScope,dockView,selectDockTab,useRightDock} from '../stores/right-dock-store';
import { useChangesPanel } from '../stores/changes-panel-store';
/** Shared desktop layout arbitration: preserve useful reading widths and user intent. */
import { useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../stores';
import { createNewSession } from '../stores/session-actions';
import { closePreview } from '../stores/preview-actions';
import { useEngineering } from '../engineering/state';
import { resolveWorkspaceLayout, type LayoutIntent } from '../utils/workspace-layout';
import './WorkspaceLayout.css';

function panelWidth(name: string, selector: string, fallback: number): number {
  const css = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (/^\d+(?:\.\d+)?px$/.test(css)) return parseFloat(css);
  const actual = document.querySelector(selector)?.getBoundingClientRect().width;
  return actual && actual > 0 ? actual : fallback;
}

let resolving = false;
export function updateLayout(intent?: LayoutIntent): void {
  if (resolving) return;
  resolving = true;
  try {
    const s = useStore.getState();
    const width = document.querySelector('.app')?.clientWidth || window.innerWidth;
    const view=dockView(dockScope(s));
    const expanded=s.jianOpen&&view.expanded;
    document.body.classList.toggle('enigma-dock-expanded',expanded);
    const saved=parseFloat(document.documentElement.style.getPropertyValue('--right-dock-preferred-width'))||Number(localStorage.getItem('enigma-dock-width'))||580;
    const preferredDockWidth=Math.min(900,Math.max(380,saved));
    const dockWidth=width>860?Math.min(preferredDockWidth,Math.max(380,width-480)):preferredDockWidth;
    document.documentElement.style.setProperty('--right-dock-width',`${dockWidth}px`);
    const preferred = parseFloat(document.documentElement.style.getPropertyValue('--preview-preferred-width'))
      || Number(localStorage.getItem('hana-preview-width')) || 580;
    const result = resolveWorkspaceLayout({
      width,
      sidebarWidth: panelWidth('--sidebar-width', '.sidebar-inner', 250),
      workspaceWidth: expanded?width:dockWidth,
      previewWidth: preferred,
      inspectorWidth: s.currentTab === 'channels' && s.currentChannel ? panelWidth('--channel-inspector-width', '#channelInspector', 280) : 0,
      sidebarWanted: !expanded&&!String(s.currentTab).startsWith('plugin:') && (s.sidebarOpen || s.sidebarAutoCollapsed),
      workspaceWanted: s.jianOpen || s.jianAutoCollapsed,
      sidebarAutoCollapsed: s.sidebarAutoCollapsed,
      workspaceAutoCollapsed: s.jianAutoCollapsed,
      previewOpen:false,
      engineeringDrawer:false,
      drawer: s.layoutDrawer,
      intent:intent==='preview'?'workspace':intent,
    });
    const { previewWidth, ...state } = result;
    if(expanded){state.jianOpen=true;state.jianAutoCollapsed=false;state.layoutDrawer=null;state.sidebarOpen=false;state.sidebarAutoCollapsed=s.sidebarOpen||s.sidebarAutoCollapsed;state.previewExpanded=false;}
    const root = document.documentElement;
    root.style.setProperty('--layout-sidebar-space', `${state.sidebarOpen && state.layoutDrawer !== 'sidebar' ? panelWidth('--sidebar-width', '.sidebar-inner', 250) : 0}px`);
    root.style.setProperty('--layout-workspace-space', `${state.jianOpen && state.layoutDrawer !== 'workspace' ? dockWidth : 0}px`);
    if (previewWidth) {
      const px = `${previewWidth}px`;
      document.documentElement.style.setProperty('--preview-panel-width', px);
      const inner = document.querySelector<HTMLElement>('[data-preview-panel-inner]');
      if (inner) { inner.style.width = px; inner.style.minWidth = px; }
    }
    if (Object.entries(state).some(([key, value]) => s[key as keyof typeof s] !== value)) useStore.setState(state);
  } finally { resolving = false; }
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
    for (const el of document.querySelectorAll('.app,.sidebar-inner,.jian-sidebar-inner')) observer?.observe(el);
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

  useLayoutEffect(() => {
    if (drawer !== 'sidebar') return;
    const previous = document.activeElement as HTMLElement | null;
    const regions = [...document.querySelectorAll<HTMLElement>('.main-content:not([data-layout-managed]),#previewPanel:not([data-layout-managed]),#jianSidebar:not([data-layout-managed])')];
    const inert = regions.map(el => el.inert);
    regions.forEach(el => { el.inert = true; });
    const sidebar = document.getElementById('sidebar');
    if (!document.querySelector('[role="dialog"]')) sidebar?.querySelector<HTMLElement>('button')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector('[role="dialog"],[role="menu"],.enigma-surface-menu')) return;
      if (event.key === 'Escape') { event.preventDefault(); toggleSidebar(false); }
      if (event.key === 'Tab') {
        const items = [...sidebar?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]') || []].filter(el => el.getClientRects().length);
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); regions.forEach((el,i) => { el.inert = inert[i]; }); if (previous?.isConnected) previous.focus(); };
  }, [drawer]);
  return drawer === 'sidebar' ? createPortal(<button className="enigma-layout-scrim" data-native-browser-occluder="" aria-label="关闭导航栏遮罩" tabIndex={-1} onClick={() => toggleSidebar(false)}/>, document.body) : null;
}
