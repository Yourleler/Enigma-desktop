import { useStore } from '../../stores';
import { RegionalErrorBoundary } from '../RegionalErrorBoundary';
import { RightDock } from '../right-workspace/RightDock';
import { WorkspaceFileChangeBridge } from './WorkspaceFileChangeBridge';

export function WorkspaceCompanionRail() {
  const open=useStore(s=>s.jianOpen);
  const solo=useStore(s=>s.layoutDrawer);
  const autoCollapsed=useStore(s=>s.jianAutoCollapsed);
  return <>
    <WorkspaceFileChangeBridge/>
    <aside className={`jian-sidebar${open?'':' collapsed'}`} id="jianSidebar" data-layout-managed="" data-auto-collapsed={autoCollapsed||undefined} inert={!open||solo==='sidebar'} aria-hidden={!open} aria-label="工作面板">
      <div className="resize-handle resize-handle-left" id="jianResizeHandle"/>
      <div className="jian-sidebar-inner"><RegionalErrorBoundary region="right-workspace"><RightDock/></RegionalErrorBoundary></div>
    </aside>
  </>;
}
