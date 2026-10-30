export type LayoutDrawer = 'sidebar' | 'workspace' | null;
export type LayoutIntent = Exclude<LayoutDrawer, null> | 'preview';
export const NAV_MIN_WIDTH = 200;
export const DOCK_MIN_WIDTH = 320;
export const CONVERSATION_MIN_WIDTH = 400;

interface LayoutInput {
  width: number;
  sidebarWidth: number;
  workspaceWidth: number;
  inspectorWidth?: number;
  sidebarWanted: boolean;
  workspaceWanted: boolean;
  priority?: 'sidebar'|'workspace';
  expanded?: boolean;
  drawer?: LayoutDrawer;
  intent?: LayoutIntent;
}
const clamp=(value:number,min:number,max:number)=>Math.min(max,Math.max(min,Number.isFinite(value)?value:min));

/** Decide from available width and user intent, never animated DOM geometry.
 * Panels shrink before either is hidden. Small screens use the same flush pane
 * in the work area; there is no floating navigation card. */
export function resolveWorkspaceLayout(input: LayoutInput) {
  const width=Math.max(0,input.width-(input.inspectorWidth||0));
  const left=clamp(input.sidebarWidth,NAV_MIN_WIDTH,400);
  const right=clamp(input.workspaceWidth,DOCK_MIN_WIDTH,900);
  const priority=input.intent==='sidebar'?'sidebar':input.intent==='workspace'||input.intent==='preview'?'workspace':input.priority||'workspace';
  let sidebarOpen=false,jianOpen=false,sidebarWidth=left,workspaceWidth=right;
  let layoutDrawer:LayoutDrawer=null;
  if(input.expanded&&input.workspaceWanted){
    jianOpen=true;
    sidebarOpen=input.sidebarWanted&&width>=NAV_MIN_WIDTH+DOCK_MIN_WIDTH;
    sidebarWidth=sidebarOpen?Math.min(left,width-DOCK_MIN_WIDTH):left;
    workspaceWidth=Math.max(0,width-(sidebarOpen?sidebarWidth:0));
  }else if(input.sidebarWanted&&input.workspaceWanted&&width>=NAV_MIN_WIDTH+CONVERSATION_MIN_WIDTH+DOCK_MIN_WIDTH){
    sidebarOpen=jianOpen=true;
    sidebarWidth=Math.min(left,width-CONVERSATION_MIN_WIDTH-DOCK_MIN_WIDTH);
    workspaceWidth=Math.min(right,width-CONVERSATION_MIN_WIDTH-sidebarWidth);
  }else{
    const candidates=priority==='sidebar'?['sidebar','workspace'] as const:['workspace','sidebar'] as const;
    for(const pane of candidates){
      const wanted=pane==='sidebar'?input.sidebarWanted:input.workspaceWanted;
      if(!wanted)continue;
      const minimum=pane==='sidebar'?NAV_MIN_WIDTH:DOCK_MIN_WIDTH;
      const requested=input.intent===pane||(pane==='workspace'&&input.intent==='preview')||input.drawer===pane;
      if(width>=minimum+CONVERSATION_MIN_WIDTH){
        if(pane==='sidebar'){sidebarOpen=true;sidebarWidth=Math.min(left,width-CONVERSATION_MIN_WIDTH);}
        else{jianOpen=true;workspaceWidth=Math.min(right,width-CONVERSATION_MIN_WIDTH);}
        break;
      }
      if(requested){
        layoutDrawer=pane;
        if(pane==='sidebar'){sidebarOpen=true;sidebarWidth=width;}else{jianOpen=true;workspaceWidth=width;}
        break;
      }
    }
  }
  return {sidebarOpen,jianOpen,sidebarWidth,workspaceWidth,
    sidebarAutoCollapsed:input.sidebarWanted&&!sidebarOpen,
    jianAutoCollapsed:input.workspaceWanted&&!jianOpen,
    layoutDrawer,layoutPriority:priority,previewExpanded:false,previewWidth:0};
}
