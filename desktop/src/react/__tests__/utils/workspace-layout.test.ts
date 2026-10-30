import {describe,expect,it} from 'vitest';
import {resolveWorkspaceLayout} from '../../utils/workspace-layout';
const base={width:1280,sidebarWidth:240,workspaceWidth:580,sidebarWanted:true,workspaceWanted:true,priority:'workspace' as const,drawer:null};
describe('unified panel layout',()=>{
  it('shows both sides at laptop/fullscreen widths and shrinks the right pane before closing navigation',()=>{
    expect(resolveWorkspaceLayout(base)).toMatchObject({sidebarOpen:true,jianOpen:true,sidebarWidth:240,workspaceWidth:580,layoutDrawer:null});
    expect(resolveWorkspaceLayout({...base,width:1024})).toMatchObject({sidebarOpen:true,jianOpen:true,sidebarWidth:240,workspaceWidth:384,layoutDrawer:null});
    expect(resolveWorkspaceLayout({...base,width:960,workspaceWidth:900})).toMatchObject({sidebarOpen:true,jianOpen:true,workspaceWidth:320});
  });
  it('does not force the left pane closed while the reading area is expanded',()=>{
    const value=resolveWorkspaceLayout({...base,expanded:true});
    expect(value).toMatchObject({sidebarOpen:true,jianOpen:true,sidebarWidth:240,workspaceWidth:1040,layoutDrawer:null});
  });
  it('remembers the most recently opened side when only one fits beside chat',()=>{
    const left=resolveWorkspaceLayout({...base,width:800,intent:'sidebar'});
    expect(left).toMatchObject({sidebarOpen:true,jianOpen:false,layoutPriority:'sidebar',layoutDrawer:null});
    expect(resolveWorkspaceLayout({...base,width:800,priority:left.layoutPriority})).toMatchObject({sidebarOpen:true,jianOpen:false});
    expect(resolveWorkspaceLayout({...base,width:800,intent:'workspace'})).toMatchObject({sidebarOpen:false,jianOpen:true,workspaceWidth:400,layoutDrawer:null});
  });
  it('uses a flush single pane on a phone only after an explicit action',()=>{
    expect(resolveWorkspaceLayout({...base,width:420})).toMatchObject({sidebarOpen:false,jianOpen:false,layoutDrawer:null});
    expect(resolveWorkspaceLayout({...base,width:420,intent:'sidebar'})).toMatchObject({sidebarOpen:true,jianOpen:false,sidebarWidth:420,layoutDrawer:'sidebar'});
    expect(resolveWorkspaceLayout({...base,width:420,intent:'workspace'})).toMatchObject({sidebarOpen:false,jianOpen:true,workspaceWidth:420,layoutDrawer:'workspace'});
  });
  it('never alternates layout under repeated reconciliation or exceeds available width',()=>{
    for(const width of [420,600,720,800,920,960,1024,1280,1440,1512,1920])for(const sidebarWidth of [200,240,400])for(const workspaceWidth of [320,580,900])for(const intent of [undefined,'sidebar','workspace'] as const){
      const input={...base,width,sidebarWidth,workspaceWidth,intent};const first=resolveWorkspaceLayout(input);
      let current=first;
      for(let i=0;i<12;i++){
        current=resolveWorkspaceLayout({...input,intent:undefined,drawer:current.layoutDrawer,priority:current.layoutPriority,sidebarWanted:current.sidebarOpen||current.sidebarAutoCollapsed,workspaceWanted:current.jianOpen||current.jianAutoCollapsed});
        expect(current).toEqual(first);
      }
      const occupied=(current.sidebarOpen?current.sidebarWidth:0)+(current.jianOpen?current.workspaceWidth:0);
      expect(occupied+(current.layoutDrawer?0:Math.min(400,width))).toBeLessThanOrEqual(width);
    }
  });
  it('restores requested panes on widening without resurrecting explicitly closed panes',()=>{
    expect(resolveWorkspaceLayout({...base,width:1512,sidebarWanted:false})).toMatchObject({sidebarOpen:false,sidebarAutoCollapsed:false,jianOpen:true});
    const narrow=resolveWorkspaceLayout({...base,width:700});
    expect(resolveWorkspaceLayout({...base,sidebarWanted:narrow.sidebarOpen||narrow.sidebarAutoCollapsed,workspaceWanted:narrow.jianOpen||narrow.jianAutoCollapsed})).toMatchObject({sidebarOpen:true,jianOpen:true});
  });
});
