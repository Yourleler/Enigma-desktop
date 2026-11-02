import {useStore} from '../stores';
import {resolveServerConnection} from '../services/server-connection';
import type {PreviewItem} from '../types';

/** Request ownership includes the principal, not only the selected connection label. */
export function previewConnectionKey(){
 const state=useStore.getState(),connection=resolveServerConnection(state);
 return JSON.stringify([state.activeServerConnectionId,connection?.connectionId,connection?.baseUrl,connection?.serverId,connection?.studioId,connection?.userId]);
}
export function capturePreviewContext(workspace=false):()=>boolean{
 const key=previewConnectionKey(),platform=window.platform,state=useStore.getState();
 return()=>key===previewConnectionKey()&&platform===window.platform&&(!workspace||state.deskBasePath===useStore.getState().deskBasePath&&state.currentSessionPath===useStore.getState().currentSessionPath);
}
export function currentPreviewReadTarget(original:PreviewItem):PreviewItem|undefined{
 const current=useStore.getState().previewItems.find(item=>item.id===original.id);
 if(!current||current.type!==original.type||current.filePath!==original.filePath||current.content!==original.content||current.sourceUrl!==original.sourceUrl||JSON.stringify(current.fileVersion)!==JSON.stringify(original.fileVersion)||JSON.stringify(current.remoteContentRef)!==JSON.stringify(original.remoteContentRef))return;
 return current;
}
