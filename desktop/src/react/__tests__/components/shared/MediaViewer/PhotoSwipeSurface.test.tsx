/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import {act,cleanup,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {PhotoSwipeSurface} from '../../../../components/shared/MediaViewer/PhotoSwipeSurface';
const mocks=vi.hoisted(()=>({load:vi.fn(),instances:[] as any[],cleanup:vi.fn()}));
vi.mock('../../../../components/shared/MediaViewer/image-data',()=>({loadImageData:mocks.load}));
vi.mock('../../../../components/shared/MediaViewer/media-source',()=>({loadMediaSource:vi.fn(async()=>({url:'blob:video'}))}));
vi.mock('photoswipe',()=>({default:class{
 options:any;currIndex:number;isOpen=false;handlers=new Map();ui={registerElement:vi.fn()};container=document.createElement('div');element=document.createElement('div');offset={x:0,y:0};currSlide={currZoomLevel:1,zoomLevels:{fit:.5}};destroy=vi.fn();refreshSlideContent=vi.fn();updateSize=vi.fn();zoomTo=vi.fn();
 constructor(options:any){this.options=options;this.currIndex=options.index;mocks.instances.push(this);}on(name:string,fn:any){this.handlers.set(name,fn);}addFilter(){}init(){this.handlers.get('uiRegister')?.();this.isOpen=true;this.options.appendToEl.append(this.element);this.handlers.get('change')?.();}goTo(index:number){this.currIndex=index;this.handlers.get('change')?.();}
}}));
const file={id:'a',source:'desk',kind:'image',name:'new.png',path:'/new-tests/new.png',version:{mtimeMs:1,size:2}} as const;
beforeEach(()=>{mocks.instances.length=0;mocks.load.mockReset();mocks.cleanup.mockClear();mocks.load.mockResolvedValue({src:'blob:a',width:100,height:80,cleanup:mocks.cleanup});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('uses embedded geometry without trapping focus and preserves instance for unchanged metadata',async()=>{
 const view=render(<PhotoSwipeSurface files={[file]} currentId="a" embedded/>);await waitFor(()=>expect(mocks.instances.length).toBe(1));const first=mocks.instances[0];expect(first.options).toMatchObject({trapFocus:false,escKey:false,wheelToZoom:true,loop:false});view.rerender(<PhotoSwipeSurface files={[{...file,version:{...file.version}}]} currentId="a" embedded/>);expect(mocks.instances.length).toBe(1);view.unmount();expect(first.destroy).toHaveBeenCalled();expect(mocks.cleanup).toHaveBeenCalled();
});
it('does not mount a late image after the panel has closed',async()=>{
 let resolve!:(value:any)=>void;mocks.load.mockReturnValue(new Promise(r=>resolve=r));const view=render(<PhotoSwipeSurface files={[file]} currentId="a"/>);view.unmount();await act(async()=>resolve({src:'blob:late',width:100,height:80,cleanup:mocks.cleanup}));expect(mocks.instances.length).toBe(0);expect(mocks.cleanup).toHaveBeenCalled();
});
it('closes the gallery through the upstream close event',async()=>{
 const close=vi.fn();render(<PhotoSwipeSurface files={[file]} currentId="a" onClose={close}/>);await waitFor(()=>expect(mocks.instances.length).toBe(1));expect(mocks.instances[0].options.trapFocus).toBe(true);act(()=>mocks.instances[0].handlers.get('close')());expect(close).toHaveBeenCalled();
});

it('blocks the embedded viewer keyboard handler while a gallery is active',async()=>{
 render(<PhotoSwipeSurface files={[file]} currentId="a" embedded/>);await waitFor(()=>expect(mocks.instances.length).toBe(1));
 const overlay=document.createElement('div');overlay.className='enigma-photoswipe-gallery';document.body.append(overlay);const preventDefault=vi.fn();act(()=>mocks.instances[0].handlers.get('keydown')({originalEvent:{key:'z',target:document.body},preventDefault}));expect(preventDefault).toHaveBeenCalled();overlay.remove();
});

it('pauses and unloads an active video even if the PhotoSwipe destroy clears event listeners first',async()=>{
 const pause=vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{}),load=vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});
 const view=render(<PhotoSwipeSurface files={[{...file,kind:'video',name:'new.webm'}]} currentId="a"/>);await waitFor(()=>expect(mocks.instances.length).toBe(1));const content={index:0,element:null as HTMLElement|null,onLoaded:vi.fn()};
 act(()=>mocks.instances[0].handlers.get('contentLoad')({content,preventDefault:vi.fn()}));const video=content.element!.querySelector('video')!;expect(video.src).toBe('blob:video');view.unmount();expect(pause).toHaveBeenCalled();expect(load).toHaveBeenCalled();expect(video.getAttribute('src')).toBeNull();pause.mockRestore();load.mockRestore();
});
