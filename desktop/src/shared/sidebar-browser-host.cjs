/** Native browser views sit above renderer DOM. One explicit surface owns the
 * dock; stale messages cannot reattach a closed panel or cover app controls. */
function clampDockBounds(bounds, size, zoom = 1, topInset = 44) {
  if(!bounds||!['x','y','width','height'].every(key=>Number.isFinite(bounds[key])))return null;
  const [width,height]=size;
  const left=Math.max(0,Math.round(bounds.x*zoom)),top=Math.max(topInset,Math.round(bounds.y*zoom));
  const right=Math.min(width,Math.round((bounds.x+bounds.width)*zoom)),bottom=Math.min(height,Math.round((bounds.y+bounds.height)*zoom));
  if(right-left<40||bottom-top<40)return null;
  return {x:left,y:top,width:right-left,height:bottom-top};
}

class SidebarBrowserHost {
  constructor({getWindow,detachOtherHost,notify,topInset=44}) {
    this.getWindow=getWindow;this.detachOtherHost=detachOtherHost;this.notify=notify;this.topInset=topInset;
    this.binding=null;this.generation=0;
  }
  owns(surfaceId){return this.binding?.surfaceId===surfaceId;}
  isFor(sessionPath){return !!this.binding&&this.binding.sessionPath===(sessionPath||null);}
  hasView(view){return this.binding?.view===view;}
  bind({surfaceId,sessionPath,tabId,view}) {
    if(typeof surfaceId!=='string'||!surfaceId||surfaceId.length>160)throw new Error('Invalid browser surface');
    const old=this.binding;
    const same=old?.surfaceId===surfaceId&&old.sessionPath===(sessionPath||null);
    if(old?.view!==view)this.detachView(old?.view);
    this.binding={surfaceId,sessionPath:sessionPath||null,tabId,view,sequence:same?old.sequence:-1,bounds:same?old.bounds:null,visible:same?old.visible:false};
    this.generation++;
    if(view)this.detachOtherHost(view);
    const win=this.getWindow();if(!win||win.isDestroyed())throw new Error('Main window is unavailable');
    if(view){try{win.contentView.removeChildView(view);}catch{}win.contentView.addChildView(view);}
    this.refresh();
    return this.binding;
  }
  switchView(sessionPath,tabId,view) {
    if(!this.isFor(sessionPath))return false;
    this.bind({...this.binding,tabId,view});return true;
  }
  layout({surfaceId,sequence,bounds,visible}) {
    if(!this.owns(surfaceId)||!Number.isInteger(sequence)||sequence<=this.binding.sequence)return false;
    const before=this.binding.visible;
    this.binding.sequence=sequence;this.binding.bounds=bounds;this.binding.visible=visible===true;
    if(before&&!this.binding.visible)this.capturePlaceholder();
    this.refresh();return true;
  }
  refresh() {
    const binding=this.binding,win=this.getWindow();if(!binding?.view||!win||win.isDestroyed())return;
    const bounds=clampDockBounds(binding.bounds,win.getContentSize(),win.webContents.getZoomFactor?.()||1,this.topInset);
    if(bounds)binding.view.setBounds(bounds);
    binding.view.setVisible(!!bounds&&binding.visible&&win.isVisible()&&!win.isMinimized());
  }
  detachView(view) {
    if(!view)return;
    try{view.setVisible(false);}catch{}
    const win=this.getWindow();if(win&&!win.isDestroyed())try{win.contentView.removeChildView(view);}catch{}
  }
  release(surfaceId) {
    if(!this.owns(surfaceId))return null;
    const old=this.binding;this.detachView(old.view);this.binding=null;this.generation++;return old;
  }
  forget(view) {
    if(!this.hasView(view))return null;
    const old={...this.binding};this.detachView(view);this.binding={...this.binding,view:null,tabId:null};this.generation++;return old;
  }
  async capturePlaceholder() {
    const binding=this.binding,generation=this.generation;if(!binding?.view)return;
    try {
      const image=await binding.view.webContents.capturePage();
      if(this.generation!==generation||!this.owns(binding.surfaceId))return;
      this.notify({surfaceId:binding.surfaceId,sessionPath:binding.sessionPath,previewImage:`data:image/jpeg;base64,${image.resize({width:900}).toJPEG(65).toString('base64')}`});
    } catch {}
  }
}
module.exports={SidebarBrowserHost,clampDockBounds};
