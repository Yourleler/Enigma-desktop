// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {refitDocxReading} from '../../components/preview/docx-reading-position';
afterEach(()=>{document.body.replaceChildren();vi.restoreAllMocks();});
const box=(top:number,height:number)=>({top,height,bottom:top+height,left:0,right:400,width:400} as DOMRect);
it('keeps the same point on the current page instead of the same scroll pixel',()=>{
 const root=document.createElement('div'),page=document.createElement('section');page.className='docx';root.append(page);document.body.append(root);
 let zoomed=false;vi.spyOn(page,'getBoundingClientRect').mockImplementation(()=>zoomed?box(-600,2000):box(-200,1000));
 const scroll=vi.spyOn(window,'scrollBy').mockImplementation(()=>{});
 refitDocxReading(root,()=>{zoomed=true;});
 const center=window.innerHeight/2;expect(scroll).toHaveBeenCalledWith(0,-600+2*(center+200)-center);
});
it('keeps a visible search hit in view but does not jump back to an offscreen hit',()=>{
 const root=document.createElement('div'),page=document.createElement('section'),hit=document.createElement('mark');page.className='docx';page.append(hit);root.append(page);document.body.append(root);
 let resized=false;vi.spyOn(page,'getBoundingClientRect').mockImplementation(()=>resized?box(-900,2400):box(-300,1200));
 vi.spyOn(hit,'getBoundingClientRect').mockImplementation(()=>resized?box(900,40):box(100,20));
 const scroll=vi.spyOn(window,'scrollBy').mockImplementation(()=>{});refitDocxReading(root,()=>{resized=true;},hit);expect(scroll).toHaveBeenCalledWith(0,810);
 vi.mocked(hit.getBoundingClientRect).mockImplementation(()=>box(-1500,20));resized=false;scroll.mockClear();refitDocxReading(root,()=>{resized=true;},hit);
 const center=window.innerHeight/2;expect(scroll.mock.calls[0][0]).toBe(0);expect(scroll.mock.calls[0][1]).toBeCloseTo(-900+2*(center+300)-center);
});
