import {Extension, type Editor} from '@tiptap/core';
import {Plugin,PluginKey} from '@tiptap/pm/state';
const key=new PluginKey<Map<string,number>>('attachment-insertion');
export const AttachmentInsertion=Extension.create({name:'attachmentInsertion',addProseMirrorPlugins(){return [new Plugin({key,state:{init:()=>new Map(),apply(tr,old){const next=new Map<string,number>();for(const [id,pos]of old){const mapped=tr.mapping.mapResult(pos,-1);if(!mapped.deleted)next.set(id,mapped.pos);}const meta=tr.getMeta(key);if(meta?.add)next.set(meta.add,tr.selection.from);if(meta?.remove)next.delete(meta.remove);return next;}}})];}});
export function captureAttachmentInsertion(editor:Editor){const id=crypto.randomUUID();editor.view.dispatch(editor.state.tr.setMeta(key,{add:id}));return {position:()=>key.getState(editor.state)?.get(id),release:()=>{if(!editor.isDestroyed)editor.view.dispatch(editor.state.tr.setMeta(key,{remove:id}));}};}
