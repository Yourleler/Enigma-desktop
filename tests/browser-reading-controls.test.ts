import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {describe,it,expect,vi} from 'vitest';
const require=createRequire(import.meta.url);
const {createBrowserReadingControls,validateBrowserPageTarget,browserViewerBounds}=require('../desktop/src/shared/browser-reading-controls.cjs');
function mockContents(){const wc=new EventEmitter() as any;let id=0,zoom=1;wc.isDestroyed=()=>false;wc.findInPage=vi.fn(()=>++id);wc.stopFindInPage=vi.fn();wc.getZoomFactor=()=>zoom;wc.setZoomFactor=vi.fn((value:number)=>{zoom=value;});return wc;}
describe('native browser reading controls',()=>{
 it('ignores late results after another query, navigation and closing search',()=>{
  const wc=mockContents(),publish=vi.fn(),control=createBrowserReadingControls(wc,publish);
  control.command('find',{query:'old'});control.command('find',{query:'new'});
  wc.emit('found-in-page',{}, {requestId:1,matches:10,activeMatchOrdinal:5,finalUpdate:true});expect(control.snapshot().find.matches).toBe(0);
  wc.emit('found-in-page',{}, {requestId:2,matches:2,activeMatchOrdinal:1,finalUpdate:true});expect(control.snapshot().find).toMatchObject({query:'new',matches:2,active:1,pending:false});
  wc.emit('did-start-navigation',{},'https://example.com',false,true);expect(control.snapshot().find.query).toBe('');
  wc.emit('found-in-page',{}, {requestId:2,matches:2,activeMatchOrdinal:2,finalUpdate:true});expect(control.snapshot().find.matches).toBe(0);
  control.command('find',{query:'last'});control.command('stopFind');expect(wc.stopFindInPage).toHaveBeenCalledWith('clearSelection');expect(control.snapshot().find.query).toBe('');
 });
 it('starts and advances searches with the Electron contract and isolates WebContents',()=>{
  const a=mockContents(),b=mockContents(),ca=createBrowserReadingControls(a),cb=createBrowserReadingControls(b);
  ca.command('find',{query:'Test',matchCase:true});ca.command('find',{query:'Test',matchCase:true,next:true,forward:false});
  expect(a.findInPage).toHaveBeenNthCalledWith(1,'Test',{forward:true,findNext:true,matchCase:true});
  expect(a.findInPage).toHaveBeenNthCalledWith(2,'Test',{forward:false,findNext:false,matchCase:true});expect(cb.snapshot().find.query).toBe('');
  a.emit('destroyed');expect(a.listenerCount('found-in-page')).toBe(0);
 });
 it('rejects stale page commands and invalid zoom values',()=>{
  expect(()=>validateBrowserPageTarget({action:'find',tabId:'old'},'new')).toThrow('标签页');
  expect(()=>validateBrowserPageTarget({action:'closeTab',tabId:'background'},'current')).not.toThrow();
  const control=createBrowserReadingControls(mockContents());for(const zoomFactor of [Infinity,0,9])expect(()=>control.command('zoom',{zoomFactor})).toThrow('缩放');
  control.command('zoom',{zoomFactor:1.5});expect(control.snapshot().zoomFactor).toBe(1.5);
 });
 it('keeps native page bounds below expanded controls and inside a narrow window',()=>{
  expect(browserViewerBounds([600,400],190)).toEqual({x:8,y:194,width:584,height:198});
  const bounds=browserViewerBounds([480,360],999);expect(bounds.height).toBe(0);expect(bounds.y).toBeGreaterThanOrEqual(360);
 });
});
it('find results never cross from a stopped tab into another tab',()=>{
 const a=mockContents(),b=mockContents(),ca=createBrowserReadingControls(a),cb=createBrowserReadingControls(b);
 ca.command('find',{query:'first'});cb.command('find',{query:'second'});ca.command('stopFind');
 a.emit('found-in-page',{}, {requestId:1,matches:99,activeMatchOrdinal:1,finalUpdate:true});
 b.emit('found-in-page',{}, {requestId:1,matches:3,activeMatchOrdinal:2,finalUpdate:true});
 expect(ca.snapshot().find.matches).toBe(0);expect(cb.snapshot().find).toMatchObject({query:'second',matches:3,active:2});
});
