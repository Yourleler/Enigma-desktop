import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {expect,it,vi} from 'vitest';

function fixture({docked=false,active=true}={}) {
  const source=readFileSync('desktop/main.cjs','utf8');
  const marker="browserViewerWindow.webContents.on('before-input-event', (event, input) => {";
  const start=source.indexOf(marker),end=source.indexOf('\n  });',start);
  expect(start).toBeGreaterThan(0);expect(end).toBeGreaterThan(start);
  let handle:(event:any,input:any)=>void;
  const send=vi.fn(),zoom=vi.fn(),preventDefault=vi.fn();
  const view={webContents:{getZoomFactor:()=>1}},tab={tabId:'current',view};
  const context={process:{platform:'darwin'},browserViewerWindow:{webContents:{on:(_event:string,fn:any)=>{handle=fn;},send}},_currentBrowserSession:'/test/session',_getBrowserWorkspace:()=>({}),_activeBrowserTabRecord:()=>active?tab:null,_browserWebView:view,_sidebarBrowser:{hasView:()=>docked},browserReading:new Map([[view.webContents,{command:zoom}]])};
  vm.runInNewContext(source.slice(start,end+6),context);
  return {send,zoom,preventDefault,key:(key:string,extra={})=>handle!({preventDefault},{type:'keyDown',meta:true,key,...extra})};
}
it('routes new-tab followed by close-tab from the blank-page chrome without closing the window',()=>{
  const f=fixture();f.key('t');f.key('w');
  expect(f.preventDefault).toHaveBeenCalledTimes(2);
  expect(f.send.mock.calls.map(call=>call[1])).toEqual([
    {surfaceId:null,sessionPath:'/test/session',tabId:'current',key:'t'},
    {surfaceId:null,sessionPath:'/test/session',tabId:'current',key:'w'},
  ]);
});
it('keeps zoom shortcuts on the active webpage when focus is in the browser address bar',()=>{
  const f=fixture();f.key('=');f.key('0');
  expect(f.zoom.mock.calls).toEqual([['zoom',{zoomFactor:1.1}],['zoom',{zoomFactor:1}]]);
});
it('does not intercept ordinary keys or shortcuts from a docked or missing page',()=>{
  for(const f of [fixture({docked:true}),fixture({active:false})]){f.key('w');expect(f.preventDefault).not.toHaveBeenCalled();}
  const f=fixture();f.key('w',{meta:false});f.key('w',{type:'keyUp'});expect(f.preventDefault).not.toHaveBeenCalled();
});
