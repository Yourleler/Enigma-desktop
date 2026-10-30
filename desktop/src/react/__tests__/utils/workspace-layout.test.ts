import { describe, expect, it } from 'vitest';
import { resolveWorkspaceLayout } from '../../utils/workspace-layout';

const base = {width: 1920, sidebarWidth: 250, workspaceWidth: 320, previewWidth: 580, inspectorWidth: 0,
  sidebarWanted: true, workspaceWanted: true, sidebarAutoCollapsed: false, workspaceAutoCollapsed: false,
  previewOpen: true, engineeringDrawer: false, drawer: null};

describe('workspace width arbitration', () => {
  it('fits all four columns only when the conversation has room', () => {
    expect(resolveWorkspaceLayout(base)).toMatchObject({sidebarOpen:true,jianOpen:true,previewExpanded:false});
    expect(resolveWorkspaceLayout({...base,width:1440})).toMatchObject({sidebarOpen:false,sidebarAutoCollapsed:true,jianOpen:true});
    expect(resolveWorkspaceLayout({...base,width:960})).toMatchObject({sidebarOpen:false,jianOpen:false,previewExpanded:false,previewWidth:480});
  });
  it('uses the work area for a document below the two-column minimum', () => {
    expect(resolveWorkspaceLayout({...base,width:740})).toMatchObject({sidebarOpen:false,jianOpen:false,previewExpanded:true,previewWidth:740});
  });
  it('opening a document from an engineering drawer keeps that drawer out of the way', () => {
    const closed=resolveWorkspaceLayout({...base,width:740,engineeringDrawer:true,drawer:'workspace',intent:'preview'});
    expect(closed).toMatchObject({layoutDrawer:null,jianOpen:false});
    expect(resolveWorkspaceLayout({...base,width:740,engineeringDrawer:true,drawer:null,workspaceAutoCollapsed:true})).toMatchObject({layoutDrawer:null,jianOpen:false});
    expect(resolveWorkspaceLayout({...base,width:740,engineeringDrawer:true,intent:'workspace'})).toMatchObject({layoutDrawer:'workspace',jianOpen:true});
  });
  it('an explicitly opened auxiliary pane floats without stealing reading width', () => {
    expect(resolveWorkspaceLayout({...base,width:960,intent:'workspace'})).toMatchObject({layoutDrawer:'workspace',jianOpen:true,previewWidth:480});
    expect(resolveWorkspaceLayout({...base,width:960,intent:'sidebar'})).toMatchObject({layoutDrawer:'sidebar',sidebarOpen:true,jianOpen:false});
    expect(resolveWorkspaceLayout({...base,width:740,drawer:'workspace',intent:'preview'})).toMatchObject({layoutDrawer:null,jianOpen:false,previewExpanded:true});
  });
  it('restores automatic collapse with headroom, but respects a manually closed panel', () => {
    expect(resolveWorkspaceLayout({...base,width:1410,workspaceAutoCollapsed:true})).toMatchObject({jianOpen:false});
    expect(resolveWorkspaceLayout({...base,width:1460,workspaceAutoCollapsed:true})).toMatchObject({jianOpen:true});
    expect(resolveWorkspaceLayout({...base,sidebarWanted:false})).toMatchObject({sidebarOpen:false,sidebarAutoCollapsed:false});
    expect(resolveWorkspaceLayout({...base,width:960,previewOpen:false,sidebarAutoCollapsed:true,workspaceAutoCollapsed:true})).toMatchObject({jianOpen:true,sidebarOpen:false});
  });
  it('does not open a floating panel just because the window became narrow', () => {
    expect(resolveWorkspaceLayout({...base,width:780,previewOpen:false,engineeringDrawer:true})).toMatchObject({layoutDrawer:null,jianOpen:false});
    expect(resolveWorkspaceLayout({...base,width:780,previewOpen:false,engineeringDrawer:true,intent:'workspace'})).toMatchObject({layoutDrawer:'workspace',jianOpen:true});
  });
  it('does not squeeze chat across narrow/wide sizes, stored widths and pane combinations', () => {
    for (const width of [420,600,740,899,900,960,1024,1280,1440,1920]) for (const sidebarWidth of [180,250,400]) for (const workspaceWidth of [200,320,600]) for (const previewOpen of [false,true]) {
      const layout=resolveWorkspaceLayout({...base,width,sidebarWidth,workspaceWidth,previewOpen});
      const used=(layout.sidebarOpen&&layout.layoutDrawer!=='sidebar'?sidebarWidth:0)+(layout.jianOpen&&layout.layoutDrawer!=='workspace'?workspaceWidth:0)+layout.previewWidth;
      expect(layout.previewExpanded?used<=width:width-used>=Math.min(width,480)).toBe(true);
    }
  });
});
