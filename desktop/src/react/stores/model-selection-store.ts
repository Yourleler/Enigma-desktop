import {create} from 'zustand';
import type {ModelSelection} from '../../../../shared/model-selection';
const key=(connection:string|null|undefined,path:string)=>JSON.stringify([connection,path]);
export const modelSelectionKey=key;
export const useModelSelectionStore=create<{items:Record<string,ModelSelection|null>}>()(()=>({items:{}}));
export function receiveModelSelection(connection:string|null|undefined,path:string,selection:ModelSelection|null){
  const id=key(connection,path),previous=useModelSelectionStore.getState().items[id];
  if(previous&&selection&&previous.revision>selection.revision)return;
  if(previous&&selection&&previous.revision===selection.revision&&previous.state!=='pending'&&selection.state==='pending')return;
  if(previous?.state==='pending'&&!selection)return;
  useModelSelectionStore.setState(s=>({items:{...s.items,[id]:selection}}));
}
