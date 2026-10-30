import { create } from 'zustand';
export type DockTab = 'files'|'changes'|'browser'|'tasks'|'tools'|`preview:${string}`;
type DockView = { tab: DockTab; expanded: boolean; fileId?: string; browserSession?: string|null };
const fallback: DockView = { tab:'files', expanded:false };
export const dockScope = (s: {activeServerConnectionId?:string|null;currentSessionPath?:string|null;deskBasePath?:string}) => JSON.stringify([s.activeServerConnectionId||'local',s.currentSessionPath||s.deskBasePath||'new']);
const valid = (tab:unknown): tab is DockTab => typeof tab==='string' && (['files','changes','browser','tasks','tools'].includes(tab)||tab.startsWith('preview:'));
function read():Record<string,DockView>{try{const rows=JSON.parse(localStorage.getItem('enigma-right-tabs-v1')||'[]');return Object.fromEntries((Array.isArray(rows)?rows:[]).slice(-60).filter(row=>Array.isArray(row)&&typeof row[0]==='string'&&valid(row[1]?.tab)).map(([scope,v])=>[scope,{tab:v.tab,expanded:false,...(typeof v.fileId==='string'?{fileId:v.fileId}:{}),...(v.browserSession===null||typeof v.browserSession==='string'?{browserSession:v.browserSession}:{})}]));}catch{return {};}}
export const useRightDock = create<{views:Record<string,DockView>}>(()=>({views:read()}));
export const dockView = (scope:string) => useRightDock.getState().views[scope] || fallback;
export function selectDockTab(scope:string,tab:DockTab,extras:Partial<DockView>={}){
  useRightDock.setState(s=>({views:{...s.views,[scope]:{...s.views[scope]||fallback,...extras,tab,...(tab.startsWith('preview:')?{fileId:tab.slice(8)}:{})}}}));
  try{localStorage.setItem('enigma-right-tabs-v1',JSON.stringify(Object.entries(useRightDock.getState().views).slice(-60)));}catch{}
}
export function expandDock(scope:string,expanded:boolean){selectDockTab(scope,dockView(scope).tab,{expanded});}
