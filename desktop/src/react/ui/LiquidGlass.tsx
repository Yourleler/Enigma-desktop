import { installGlassInteractions } from './glass-interaction';
import { useEffect } from 'react';
import { createGlassMap } from './liquid-glass-map';
import '../engineering/liquid-glass.css';
import '../engineering/menu-surfaces.css';

const selectors='[data-liquid],.enigma-toolbar,.enigma-tabs-row,.enigma-surface-menu,.enigma-token-popover';
const svgNS='http://www.w3.org/2000/svg';

/** One bounded texture cache per window. Text is never filtered: only the
 * pseudo-element's backdrop is refracted. Resize work is coalesced, and
 * offscreen/large surfaces use the cheaper translucent material. */
export function LiquidGlass() {
  useEffect(()=>{
    if (typeof ResizeObserver === 'undefined') return;
    const svg=document.createElementNS(svgNS,'svg');svg.setAttribute('width','0');svg.setAttribute('height','0');svg.setAttribute('aria-hidden','true');svg.classList.add('enigma-liquid-definitions');
    const defs=document.createElementNS(svgNS,'defs');svg.append(defs);document.body.append(svg);
    const maps=new Map<string,string>(), tracked=new Set<HTMLElement>();
    const timers=new Map<HTMLElement,ReturnType<typeof setTimeout>>();
    let seq=0;
    const attach=(el:HTMLElement)=>{
      if(tracked.has(el)||el.closest('.enigma-liquid-definitions'))return;
      tracked.add(el);el.dataset.liquidSurface='';resize.observe(el);
    };
    const update=(el:HTMLElement)=>{
      if(!el.isConnected){resize.unobserve(el);tracked.delete(el);return;}
      const rect=el.getBoundingClientRect();
      // Avoid allocating filters for hidden views and large scrolling panels.
      if(el.dataset.liquid==='sidebar'||rect.width<8||rect.height<8||rect.width*rect.height>240000||document.body.classList.contains('enigma-glass-off')){el.style.removeProperty('--liquid-refraction');el.removeAttribute('data-liquid-refraction');return;}
      const w=Math.round(rect.width/8)*8,h=Math.round(rect.height/8)*8;
      const radius=parseFloat(getComputedStyle(el).borderRadius)||14,key=`${w}:${h}:${Math.round(radius)}`;
      let id=maps.get(key);
      if(!id&&maps.size>=40){
        const used=new Set([...tracked].filter(node=>node.isConnected&&node!==el).map(node=>node.style.getPropertyValue('--liquid-refraction')));
        for(const [oldKey,oldId] of maps){if(used.has(`url(#${oldId})`))continue;defs.querySelector(`[id="${oldId}"]`)?.remove();maps.delete(oldKey);break;}
      }
      if(!id&&maps.size<40){
        const started=performance.now();
        const map=createGlassMap(w,h,radius),canvas=document.createElement('canvas');canvas.width=map.width;canvas.height=map.height;
        const ctx=canvas.getContext('2d');if(!ctx)return;
        ctx.putImageData(new ImageData(map.pixels,map.width,map.height),0,0);
        id=`enigma-liquid-${++seq}`;
        const filter=document.createElementNS(svgNS,'filter');filter.id=id;filter.setAttribute('x','0');filter.setAttribute('y','0');filter.setAttribute('width','1');filter.setAttribute('height','1');filter.setAttribute('color-interpolation-filters','sRGB');
        const image=document.createElementNS(svgNS,'feImage');image.setAttribute('href',canvas.toDataURL());image.setAttribute('width','100%');image.setAttribute('height','100%');image.setAttribute('preserveAspectRatio','none');image.setAttribute('result','edge-map');
        const warp=document.createElementNS(svgNS,'feDisplacementMap');warp.setAttribute('in','SourceGraphic');warp.setAttribute('in2','edge-map');warp.setAttribute('scale','28');warp.setAttribute('xChannelSelector','R');warp.setAttribute('yChannelSelector','G');
        filter.append(image,warp);defs.append(filter);maps.set(key,id);
        svg.dataset.textureCount=String(maps.size);
        svg.dataset.lastMapMs=(performance.now()-started).toFixed(2);
      }
      if(id){maps.delete(key);maps.set(key,id);el.style.setProperty('--liquid-refraction',`url(#${id})`);el.dataset.liquidRefraction='ready';}
    };
    const resize=new ResizeObserver(entries=>{for(const entry of entries){const el=entry.target as HTMLElement;clearTimeout(timers.get(el));timers.set(el,setTimeout(()=>{timers.delete(el);update(el);},100));}});
    document.querySelectorAll<HTMLElement>(selectors).forEach(attach);
    const mutations=new MutationObserver(records=>{
      for(const record of records){
        if(record.type==='attributes'&&record.target instanceof HTMLElement){
          const node=record.target;
          if(node.matches(selectors))attach(node);
          else if(tracked.has(node)){resize.unobserve(node);tracked.delete(node);clearTimeout(timers.get(node));timers.delete(node);node.removeAttribute('data-liquid-surface');node.removeAttribute('data-liquid-refraction');node.style.removeProperty('--liquid-refraction');}
          continue;
        }
        for(const node of record.addedNodes)if(node instanceof HTMLElement){if(node.matches(selectors))attach(node);node.querySelectorAll<HTMLElement>(selectors).forEach(attach);}
      }
      for(const el of tracked)if(!el.isConnected){resize.unobserve(el);clearTimeout(timers.get(el));timers.delete(el);tracked.delete(el);}
    });
    mutations.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','data-liquid']});
    let wasDisabled=document.body.classList.contains('enigma-glass-off');
    const preferenceObserver=new MutationObserver(()=>{
      const disabled=document.body.classList.contains('enigma-glass-off');
      if(wasDisabled&&!disabled)for(const el of tracked){clearTimeout(timers.get(el));timers.set(el,setTimeout(()=>{timers.delete(el);update(el);},100));}
      wasDisabled=disabled;
    });
    preferenceObserver.observe(document.body,{attributes:true,attributeFilter:['class']});
    const disposeInteractions = installGlassInteractions();
    // Explicit local UI audit mode records frame spacing to DOM diagnostics;
    // it neither sends telemetry nor runs during ordinary use.
    let frame=0,previous=0,frames=0,longTaskObserver:PerformanceObserver|undefined;const intervals:number[]=[];
    if(new URLSearchParams(location.search).has('enigma_perf')){
      const sample=(at:number)=>{
        if(document.hidden){previous=0;intervals.length=0;}else{
          if(previous)intervals.push(at-previous);previous=at;if(intervals.length>180)intervals.shift();
          if(intervals.length>=60&&++frames%60===0){const sorted=intervals.slice().sort((a,b)=>a-b);svg.dataset.frameP95Ms=sorted[Math.floor(sorted.length*.95)].toFixed(2);svg.dataset.frameMeanMs=(sorted.reduce((a,b)=>a+b,0)/sorted.length).toFixed(2);svg.dataset.frameMaxMs=sorted.at(-1)!.toFixed(2);svg.dataset.frameSamples=String(sorted.length);svg.dataset.sampledAt=String(Date.now());}
        }
        frame=requestAnimationFrame(sample);
      };frame=requestAnimationFrame(sample);
      if(typeof PerformanceObserver!=='undefined'&&PerformanceObserver.supportedEntryTypes?.includes('longtask')){let count=0,maximum=0;longTaskObserver=new PerformanceObserver(list=>{for(const entry of list.getEntries()){count++;maximum=Math.max(maximum,entry.duration);}svg.dataset.longTasks=String(count);svg.dataset.longTaskMaxMs=maximum.toFixed(2);});longTaskObserver.observe({type:'longtask'});}
    }
    return()=>{cancelAnimationFrame(frame);disposeInteractions();longTaskObserver?.disconnect();preferenceObserver.disconnect();mutations.disconnect();resize.disconnect();for(const timer of timers.values())clearTimeout(timer);for(const el of tracked){el.removeAttribute('data-liquid-surface');el.removeAttribute('data-liquid-refraction');el.style.removeProperty('--liquid-refraction');}svg.remove();};
  },[]);
  return null;
}
