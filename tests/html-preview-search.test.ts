import {expect,it,vi} from 'vitest';
import {JSDOM} from 'jsdom';
import {withHtmlPreviewSearch} from '../shared/html-preview-search';
it('finds visible text across inline formatting, ignores foreign messages and clears highlights',async()=>{
 const dom=new JSDOM(withHtmlPreviewSearch('<p>Alpha <b>beta</b></p><p>ALPHA</p><p hidden>Alpha beta</p><script>const hiddenText="Alpha beta"</script>'),{runScripts:'dangerously',beforeParse(window){
  Object.defineProperty(window,'CSS',{value:{highlights:new Map()}});Object.defineProperty(window,'Highlight',{value:class{ranges:any[];constructor(...ranges:any[]){this.ranges=ranges;}}});
  window.HTMLElement.prototype.getClientRects=()=>[{width:1,height:1}] as any;window.HTMLElement.prototype.scrollIntoView=()=>{};
 }});
 await new Promise<void>(resolve=>dom.window.addEventListener('load',()=>resolve(),{once:true}));
 const reply=vi.spyOn(dom.window,'postMessage').mockImplementation(()=>{});
 const send=(query:string,source:any=dom.window)=>dom.window.dispatchEvent(new dom.window.MessageEvent('message',{source,data:{type:'enigma-preview-find',id:'request',query,index:0}}));
 send('alpha beta',{});expect(reply).not.toHaveBeenCalled();
 send('alpha beta');expect(reply).toHaveBeenLastCalledWith({type:'enigma-preview-find-result',id:'request',count:1,index:0,truncated:false},'*');
 send('alpha');expect(reply.mock.lastCall?.[0].count).toBe(2);
 send('');expect(reply.mock.lastCall?.[0].count).toBe(0);
 dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'f',ctrlKey:true,cancelable:true}));expect(reply).toHaveBeenLastCalledWith({type:'enigma-preview-find-open'},'*');
 dom.window.close();
});
