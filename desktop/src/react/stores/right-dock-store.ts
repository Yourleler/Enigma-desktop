import {create} from 'zustand';
export type DockTab='files'|'changes'|'browser'|'tasks'|'tools'|'agents'|'sidechat'|`tool:${string}`|`preview:${string}`;
export type SideChatRef={sessionPath:string;sessionId:string;agentId:string;contextIncluded?:boolean;model?:string;provider?:string};
export type DockView={tab:DockTab;expanded:boolean;fileId?:string;browserSession?:string|null;sideChat?:SideChatRef;order?:DockTab[];hidden?:DockTab[];inlineIds?:string[];directoryPreviewId?:string;fileListOpen?:boolean;fileListWidth?:number};
const fallback:DockView={tab:'files',expanded:false};
export const defaultDockTabs:DockTab[]=['files','changes','browser','tasks'];
export const dockScope=(s:{activeServerConnectionId?:string|null;currentSessionPath?:string|null;deskBasePath?:string})=>JSON.stringify([s.activeServerConnectionId||'local',s.currentSessionPath||s.deskBasePath||'new']);
const valid=(tab:unknown):tab is DockTab=>typeof tab==='string'&&([...defaultDockTabs,'tools','agents','sidechat'].includes(tab as DockTab)||/^tool:[a-z-]+$/.test(tab)||tab.startsWith('preview:'));
const list=(value:unknown):DockTab[]=>Array.isArray(value)?[...new Set(value.filter(valid))]:[];
export function normalizeDockView(v:any):DockView {
  return {tab:valid(v?.tab)?v.tab:'files',expanded:false,
    ...(typeof v?.sideChat?.sessionPath==='string'&&typeof v?.sideChat?.sessionId==='string'&&typeof v?.sideChat?.agentId==='string'?{sideChat:{sessionPath:v.sideChat.sessionPath,sessionId:v.sideChat.sessionId,agentId:v.sideChat.agentId,contextIncluded:v.sideChat.contextIncluded===true,...(typeof v.sideChat.model==='string'?{model:v.sideChat.model}:{}),...(typeof v.sideChat.provider==='string'?{provider:v.sideChat.provider}:{})}}:{}),
    ...(typeof v?.fileId==='string'?{fileId:v.fileId}:{}),
    ...(Number.isFinite(v?.fileListWidth)?{fileListWidth:Math.max(160,Math.min(1000,v.fileListWidth))}:{}),
    ...(v?.browserSession===null||typeof v?.browserSession==='string'?{browserSession:v.browserSession}:{}),
    order:list(v?.order),hidden:list(v?.hidden),inlineIds:Array.isArray(v?.inlineIds)?v.inlineIds.filter((x:unknown)=>typeof x==='string'):[],
    ...(typeof v?.directoryPreviewId==='string'?{directoryPreviewId:v.directoryPreviewId}:{}),fileListOpen:v?.fileListOpen===true};
}
function read():Record<string,DockView>{try{const rows=JSON.parse(localStorage.getItem('enigma-right-tabs-v1')||'[]');return Object.fromEntries((Array.isArray(rows)?rows:[]).slice(-60).filter(row=>Array.isArray(row)&&typeof row[0]==='string').map(([scope,v])=>[scope,normalizeDockView(v)]));}catch{return {};}}
export const useRightDock=create<{views:Record<string,DockView>}>(()=>({views:read()}));
export const dockView=(scope:string)=>useRightDock.getState().views[scope]||fallback;
export function patchDockView(scope:string,patch:Partial<DockView>){
  useRightDock.setState(s=>({views:{...s.views,[scope]:{...s.views[scope]||fallback,...patch}}}));
  try{localStorage.setItem('enigma-right-tabs-v1',JSON.stringify(Object.entries(useRightDock.getState().views).slice(-60)));}catch{}
}
export function selectDockTab(scope:string,tab:DockTab,extras:Partial<DockView>={},available:DockTab[]=[]){
  const view=dockView(scope);patchDockView(scope,{...extras,tab,order:[...new Set([...(view.order?.length?view.order:defaultDockTabs),...available,tab])],hidden:(view.hidden||[]).filter(id=>id!==tab),...(tab.startsWith('preview:')?{fileId:tab.slice(8),inlineIds:(view.inlineIds||[]).filter(id=>id!==tab.slice(8))}:{})});
}
export function expandDock(scope:string,expanded:boolean){patchDockView(scope,{expanded});}
export function reorderDockTabs(scope:string,visible:DockTab[]){
  const view=dockView(scope),queue=[...new Set(visible.filter(valid))],visibleSet=new Set(queue);
  const order=(view.order?.length?view.order:defaultDockTabs).map(id=>visibleSet.has(id)?queue.shift()!:id);
  patchDockView(scope,{order:[...order,...queue]});
}
export function orderedDockTabs(view:DockView|undefined,available:DockTab[]):DockTab[]{const hidden=new Set(view?.hidden||[]);return [...new Set([...(view?.order||[]).filter(id=>available.includes(id)),...available])].filter(id=>!hidden.has(id));}
export function moveDockTab(scope:string,id:DockTab,before:DockTab|undefined,available:DockTab[]){if(id===before)return;const order=orderedDockTabs(dockView(scope),available).filter(tab=>tab!==id);const index=before?order.indexOf(before):-1;order.splice(index<0?order.length:index,0,id);patchDockView(scope,{order});}
export function hideDockTab(scope:string,id:DockTab,available:DockTab[]){const view=dockView(scope),hidden=[...new Set([...(view.hidden||[]),id])],remaining=orderedDockTabs({...view,hidden},available);patchDockView(scope,{hidden,...(view.tab===id?{tab:remaining[0]||'files'}:{})});}
export function showDirectoryPreview(scope:string,id:string,alreadyPinned=false){const view=dockView(scope);patchDockView(scope,{tab:'files',hidden:(view.hidden||[]).filter(tab=>tab!=='files'),directoryPreviewId:id,fileListOpen:false,inlineIds:alreadyPinned?(view.inlineIds||[]):[...new Set([...(view.inlineIds||[]),id])]});}
