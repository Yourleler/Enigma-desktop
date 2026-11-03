import {useEffect,useState} from 'react';
export type DarkBackground = 'aurora' | 'halo' | 'solid';
export type LightBackground = 'ribbon' | 'marble' | 'solid';
export interface MaterialPreferences {glass:boolean;motion:boolean;tint?:number;darkBackground?:DarkBackground;lightBackground?:LightBackground}
const eventName='enigma-material-preferences';
export function readMaterialPreferences():MaterialPreferences{
 try{const value=JSON.parse(localStorage.getItem('enigma-appearance')||'{}');return {glass:value.glass!==false,motion:value.motion!==false,...(typeof value.tint==='number'&&Number.isFinite(value.tint)?{tint:Math.max(0,Math.min(100,value.tint))}:{}),...(['aurora','halo','solid'].includes(value.darkBackground)?{darkBackground:value.darkBackground}:{}),...(['ribbon','marble','solid'].includes(value.lightBackground)?{lightBackground:value.lightBackground}:{})};}catch{return {glass:true,motion:true};}
}
export function applyMaterialPreferences(value:MaterialPreferences){
 const tint=Math.max(0,Math.min(100,value.tint??50));
 const dense=Math.pow(Math.max(0,(tint-50)/50),1.5);
 document.body.classList.toggle('enigma-glass-off',!value.glass);document.body.classList.toggle('enigma-motion-off',!value.motion);
 document.body.dataset.darkBackground=value.darkBackground??'aurora';
 document.body.dataset.lightBackground=value.lightBackground??'ribbon';
 document.body.style.setProperty('--glass-navigation-mix',`${15+tint*.4+43*dense}%`);
 document.body.style.setProperty('--glass-control-mix',`${4+tint*.2+72*dense}%`);
 // Small controls retain their original clear material at zero, then gain
 // the same dense cover as the composer instead of staying fully refractive.
 document.body.style.setProperty('--glass-control-cover',`${tint*.2+76*dense}%`);
 document.body.style.setProperty('--glass-control-edge-opacity',`${1-.86*dense}`);
 document.body.style.setProperty('--glass-navigation-blur',`${2+tint*.06+20*dense}px`);
 document.body.style.setProperty('--glass-control-blur',`${.5+tint*.02+18*dense}px`);
 document.body.style.setProperty('--glass-composer-mix',`${3+tint*.7+25*dense}%`);
 // Starts at the usage pill's clarity plus a touch more blur; the slider
 // carries the composer from clear glass to a dense, readable slab.
 document.body.style.setProperty('--glass-composer-blur',`${1+tint*.055+14*dense}px`);
 document.body.style.setProperty('--glass-control-highlight',`${10+tint*.32-35*dense}%`);
 document.body.style.setProperty('--glass-menu-mix',`${38+tint*.32+28*dense}%`);
 document.body.style.setProperty('--glass-frame-mix',`${38+tint*.38+22*dense}%`);
 document.body.style.setProperty('--glass-chrome-mix',`${2+tint*.1+20*dense}%`);
 document.body.style.setProperty('--glass-chrome-blur',`${.5+tint*.035+7*dense}px`);
 document.body.style.setProperty('--glass-content-mix',`${6+tint*.72+18*dense}%`);
 document.body.style.setProperty('--glass-content-blur',`${2+tint*.12+18*dense}px`);
}
export function saveMaterialPreferences(value:MaterialPreferences){
 localStorage.setItem('enigma-appearance',JSON.stringify(value));
 applyMaterialPreferences(value);
 window.dispatchEvent(new Event(eventName));
}
export function useMaterialPreferences(){
 const [value,setValue]=useState(readMaterialPreferences);
 useEffect(()=>{const update=()=>setValue(readMaterialPreferences());window.addEventListener(eventName,update);window.addEventListener('storage',update);return()=>{window.removeEventListener(eventName,update);window.removeEventListener('storage',update);};},[]);
 return [value,saveMaterialPreferences] as const;
}

/** Motion-driven components must respect the same switch as CSS effects. */
export function useMotionEnabled() {
 const [preferences] = useMaterialPreferences();
 const [reduced,setReduced] = useState(() => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
 useEffect(() => {
  const query=window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const update=()=>setReduced(!!query?.matches);
  query?.addEventListener?.('change',update);
  return()=>query?.removeEventListener?.('change',update);
 },[]);
 return preferences.motion && !reduced;
}
