export const VISUAL_ACTIVITY_EVENT='enigma-visual-activity';
export function visualsSuspended(){return document.hidden||document.body.dataset.enigmaVisualActivity==='suspended';}
let owners=0,stop:(()=>void)|undefined;

/** Native screen lock and document visibility affect decoration only, not tasks or media. */
export function installVisualActivity(){
 if(++owners===1){
  let nativeSuspended=false,alive=true,generation=0;
  const apply=()=>{const state=document.hidden||nativeSuspended?'suspended':'active';if(document.body.dataset.enigmaVisualActivity!==state){document.body.dataset.enigmaVisualActivity=state;window.dispatchEvent(new Event(VISUAL_ACTIVITY_EVENT));}};
  const update=(value:{suspended:boolean})=>{if(!alive||typeof value?.suspended!=='boolean')return;nativeSuspended=value.suspended;apply();};
  const off=window.hana?.onVisualActivity?.(value=>{generation++;update(value);});
  const initial=generation;void window.hana?.getVisualActivity?.().then(value=>{if(generation===initial)update(value);}).catch(()=>{});
  document.addEventListener('visibilitychange',apply);apply();
  stop=()=>{alive=false;off?.();document.removeEventListener('visibilitychange',apply);delete document.body.dataset.enigmaVisualActivity;window.dispatchEvent(new Event(VISUAL_ACTIVITY_EVENT));};
 }
 let released=false;
 return()=>{if(released)return;released=true;if(--owners===0){stop?.();stop=undefined;}};
}
