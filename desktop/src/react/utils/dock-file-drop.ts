import {useStore} from '../stores';
import {dockScope} from '../stores/right-dock-store';
import {openFilePreview} from './file-preview';
import {openFileRefPreview,openWorkbenchFilePreview} from './remote-file-preview';
import {canUseNativeResourcePath} from '../services/resource-access';
import {resolveServerConnection} from '../services/server-connection';
import {isWebRuntime} from './platform-runtime';
import {arrayBufferToBase64} from './markdown-attachments';
import {hanaFetch} from '../hooks/use-hana-fetch';
import {extOfName,inferKindByExt} from './file-kind';
import {selectDeskFiles,selectSessionFiles} from '../stores/selectors/file-refs';
import type {AppFileDragPayload} from './app-file-drag';

export async function openDockFiles(files:File[],payload?:AppFileDragPayload|null){
  const start=useStore.getState(),scope=dockScope(start),native=!isWebRuntime()&&canUseNativeResourcePath({connection:resolveServerConnection(start)});
  const current=()=>dockScope(useStore.getState())===scope;
  if(payload){
    for(const item of payload.files){
      if(!current())return;if(item.isDirectory)continue;
      const state=useStore.getState();
      if(payload.source==='workspace'&&item.sourceSubdir!==undefined){await openWorkbenchFilePreview({file:{name:item.name,isDir:false},subdir:item.sourceSubdir,mountId:state.deskWorkspaceMountId,localRootPath:state.deskBasePath,placement:'tab'});continue;}
      const match=[...selectDeskFiles(state),...selectSessionFiles(state,state.currentSessionPath||'')].find(file=>file.id===item.id||item.fileId&&file.fileId===item.fileId||item.path&&file.path===item.path);
      if(match){await openFileRefPreview(match,{origin:payload.source==='workspace'?'desk':'session',sessionPath:state.currentSessionPath||undefined,placement:'tab'});continue;}
      if(native&&item.path){await openFilePreview(item.path,item.name,extOfName(item.name)||'',{placement:'tab'});continue;}
      throw new Error('此文件的来源已变化，请从文件列表重新拖入');
    }
    return;
  }
  for(const file of files){
    if(!current())return;
    const nativePath=native?window.platform?.getFilePath?.(file):null;
    if(nativePath){await openFilePreview(nativePath,file.name,extOfName(file.name)||'',{placement:'tab'});continue;}
    if(!start.currentSessionPath)throw new Error('请先打开一个对话，再导入本机文件');
    const base64Data=arrayBufferToBase64(await file.arrayBuffer());if(!current())return;
    const response=await hanaFetch('/api/upload-blob',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:file.name,base64Data,mimeType:file.type||'application/octet-stream',sessionPath:start.currentSessionPath})});
    const data=await response.json(),upload=data.uploads?.[0];if(!response.ok||upload?.error||!upload?.dest)throw new Error(upload?.error||'文件导入失败');if(!current())return;
    await openFileRefPreview({id:upload.fileId||upload.id||upload.dest,fileId:upload.fileId,source:'session-registry',name:upload.name||file.name,path:upload.dest,kind:inferKindByExt(extOfName(file.name)),ext:extOfName(file.name),resource:upload.resource},{origin:'session',sessionPath:start.currentSessionPath,placement:'tab'});
  }
}
