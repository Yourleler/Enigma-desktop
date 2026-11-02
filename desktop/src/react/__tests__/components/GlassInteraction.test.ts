// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { installGlassInteractions } from '../../ui/glass-interaction';
afterEach(()=>{document.body.innerHTML='';document.body.className='';vi.unstubAllGlobals();});
it('cancels press and pointer lighting when preferences change without another pointer move',async()=>{
 vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));vi.stubGlobal('cancelAnimationFrame',vi.fn());
 const button=document.createElement('button');button.dataset.glassInteractive='';document.body.append(button);
 const dispose=installGlassInteractions();button.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,button:0,clientX:5,clientY:5}));
 expect(button.hasAttribute('data-liquid-pressed')).toBe(true);
 document.body.classList.add('enigma-motion-off');await Promise.resolve();
 expect(button.hasAttribute('data-liquid-pressed')).toBe(false);expect(button.hasAttribute('data-liquid-active')).toBe(false);dispose();
});
it('never applies a press effect to a disabled control or a text-entry surface',()=>{
 vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));vi.stubGlobal('cancelAnimationFrame',vi.fn());
 const surface=document.createElement('div');surface.dataset.liquidSurface='';const button=document.createElement('button');button.disabled=true;surface.append(button);document.body.append(surface);
 const dispose=installGlassInteractions();button.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,button:0}));expect(surface.hasAttribute('data-liquid-active')).toBe(false);
 surface.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,button:0}));expect(surface.hasAttribute('data-liquid-pressed')).toBe(false);dispose();
});
it('keeps a sheet glow positioned while crossing child controls and fades it without reverting to a corner',()=>{
 const frames:FrameRequestCallback[]=[];vi.stubGlobal('requestAnimationFrame',vi.fn((cb:FrameRequestCallback)=>{frames.push(cb);return frames.length;}));vi.stubGlobal('cancelAnimationFrame',vi.fn());
 const sheet=document.createElement('div');sheet.dataset.glassFrame='settings';sheet.dataset.glassControls='';
 const a=document.createElement('button'),b=document.createElement('button');sheet.append(a,b);document.body.append(sheet);
 sheet.getBoundingClientRect=()=>({left:100,top:100,width:400,height:400} as DOMRect);
 a.getBoundingClientRect=()=>({left:140,top:140,width:80,height:40} as DOMRect);b.getBoundingClientRect=()=>({left:140,top:190,width:80,height:40} as DOMRect);
 const dispose=installGlassInteractions();
 sheet.dispatchEvent(new MouseEvent('pointermove',{bubbles:true,clientX:180,clientY:160}));
 expect(sheet.style.getPropertyValue('--glass-pointer-x')).toBe('20.00%');expect(sheet.style.getPropertyValue('--glass-pointer-y')).toBe('15.00%');
 a.dispatchEvent(new MouseEvent('pointermove',{bubbles:true,clientX:180,clientY:160}));
 expect(sheet.style.getPropertyValue('--glass-light-opacity')).toBe('0');expect(sheet.style.getPropertyValue('--glass-pointer-y')).toBe('15.00%');
 frames.shift()!(16);const entered=Number(sheet.style.getPropertyValue('--glass-light-opacity'));expect(entered).toBeGreaterThan(0);expect(entered).toBeLessThan(.2);
 for(let i=1;i<90&&frames.length;i++)frames.shift()!(16+i*16);
 expect(Number(sheet.style.getPropertyValue('--glass-light-opacity'))).toBe(.72);
 b.dispatchEvent(new MouseEvent('pointermove',{bubbles:true,clientX:180,clientY:210}));
 expect(sheet.style.getPropertyValue('--glass-pointer-y')).toBe('15.00%');expect(sheet.hasAttribute('data-liquid-active')).toBe(true);
 document.dispatchEvent(new Event('pointerleave'));
 expect(sheet.style.getPropertyValue('--glass-light-opacity')).toBe('0');expect(sheet.style.getPropertyValue('--glass-pointer-y')).toBe('15.00%');dispose();
});
