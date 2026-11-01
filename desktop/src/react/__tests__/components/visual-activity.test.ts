// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {installVisualActivity,visualsSuspended} from '../../ui/visual-activity';
const releases:(()=>void)[]=[];
afterEach(()=>{for(const release of releases.splice(0))release();vi.restoreAllMocks();vi.unstubAllGlobals();document.body.className='';});

it('rejects a stale initial response after an unlock event and keeps visual settings intact',async()=>{
 let respond!:(value:{suspended:boolean})=>void,notify!:(value:{suspended:boolean})=>void;const off=vi.fn();
 vi.stubGlobal('hana',{getVisualActivity:()=>new Promise(resolve=>{respond=resolve;}),onVisualActivity:(callback:any)=>{notify=callback;return off;}});
 vi.spyOn(document,'hidden','get').mockReturnValue(false);document.body.className='enigma-surface';
 releases.push(installVisualActivity());notify({suspended:false});respond({suspended:true});await Promise.resolve();
 expect(visualsSuspended()).toBe(false);notify({suspended:true});expect(visualsSuspended()).toBe(true);
 expect(document.body.className).toBe('enigma-surface');notify({suspended:false});expect(visualsSuspended()).toBe(false);
 releases.pop()!();expect(off).toHaveBeenCalledOnce();expect(document.body.dataset.enigmaVisualActivity).toBeUndefined();
});

it('uses document visibility in Web mode and shares one subscription between multiple owners',()=>{
 vi.stubGlobal('hana',undefined);const hidden=vi.spyOn(document,'hidden','get').mockReturnValue(false);
 const one=installVisualActivity(),two=installVisualActivity();releases.push(one,two);
 hidden.mockReturnValue(true);document.dispatchEvent(new Event('visibilitychange'));expect(visualsSuspended()).toBe(true);
 one();expect(document.body.dataset.enigmaVisualActivity).toBe('suspended');
 hidden.mockReturnValue(false);document.dispatchEvent(new Event('visibilitychange'));expect(visualsSuspended()).toBe(false);
 two();expect(document.body.dataset.enigmaVisualActivity).toBeUndefined();
});
