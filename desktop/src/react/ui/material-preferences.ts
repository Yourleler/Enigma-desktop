import {useEffect,useState} from 'react';
export type DarkBackground = 'aurora' | 'halo' | 'solid';
export type LightBackground = 'ribbon' | 'marble' | 'solid';
export interface MaterialPreferences {glass:boolean;motion:boolean;tint?:number;darkBackground?:DarkBackground;lightBackground?:LightBackground}
const eventName='enigma-material-preferences';
export function readMaterialPreferences():MaterialPreferences{
 try{const value=JSON.parse(localStorage.getItem('enigma-appearance')||'{}');return {glass:value.glass!==false,motion:value.motion!==false,...(typeof value.tint==='number'&&Number.isFinite(value.tint)?{tint:Math.max(0,Math.min(100,value.tint))}:{}),...(['aurora','halo','solid'].includes(value.darkBackground)?{darkBackground:value.darkBackground}:{}),...(['ribbon','marble','solid'].includes(value.lightBackground)?{lightBackground:value.lightBackground}:{})};}catch{return {glass:true,motion:true};}
}
export function applyMaterialPreferences(value:MaterialPreferences){
 const tint=value.tint??50;
 document.body.classList.toggle('enigma-glass-off',!value.glass);document.body.classList.toggle('enigma-motion-off',!value.motion);
 document.body.dataset.darkBackground=value.darkBackground??'aurora';
 document.body.dataset.lightBackground=value.lightBackground??'ribbon';
 document.body.style.setProperty('--glass-navigation-mix',`${15+tint*.4}%`);
 document.body.style.setProperty('--glass-control-mix',`${4+tint*.2}%`);
 document.body.style.setProperty('--glass-navigation-blur',`${2+tint*.06}px`);
 document.body.style.setProperty('--glass-control-blur',`${.5+tint*.02}px`);
 document.body.style.setProperty('--glass-composer-mix',`${3+tint*.7}%`);
 document.body.style.setProperty('--glass-composer-blur',`${.35+tint*.1}px`);
 document.body.style.setProperty('--glass-control-highlight',`${10+tint*.32}%`);
 document.body.style.setProperty('--glass-menu-mix',`${38+tint*.32}%`);
 document.body.style.setProperty('--glass-frame-mix',`${38+tint*.38}%`);
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
