import type {PreviewItem} from '../types';
import {useStore} from '../stores';
import {hanaFetch} from '../hooks/use-hana-fetch';
import {canUseNativeResourcePath,encodeWorkbenchContentPath} from '../services/resource-access';
import {resolveServerConnection} from '../services/server-connection';
import {isWebRuntime} from './platform-runtime';

export function officePreviewErrorMessage(error:unknown):string {
  const value=error instanceof Error?error.message:String(error||'');
  if(/main document part|central directory|end of data|zip file|corrupt|invalid.*docx/i.test(value))return 'DOCX 文件结构不完整或已损坏，请使用原始文档重试。';
  if(/failed to fetch|network|fetch failed/i.test(value))return '读取文档时连接中断，请检查连接后重试。';
  return /[\u3400-\u9fff]/.test(value)?value:'文档无法读取，请重试或使用系统应用打开。';
}

export {checkOfficeArchive} from './office-archive';
import {checkOfficeArchive} from './office-archive';
export async function loadOfficePreviewBinary(item:PreviewItem,signal:AbortSignal):Promise<Uint8Array> {
  signal.throwIfAborted();
  const connection=resolveServerConnection(useStore.getState());let bytes:Uint8Array;
  if(!isWebRuntime()&&item.filePath&&canUseNativeResourcePath({connection})&&window.platform?.readFileBase64){
    const base64=await window.platform.readFileBase64(item.filePath);signal.throwIfAborted();
    if(base64===null)throw new Error('文件无法读取，请确认仍存在且可访问');
    bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
  }else{
    const ref=item.remoteContentRef;
    const resourcePath=item.contentResourceId?`/api/resources/${encodeURIComponent(item.contentResourceId)}/content`
      :ref&&(ref.kind==='workbench-file'||ref.kind==='mobile-workbench')?encodeWorkbenchContentPath(ref):null;
    if(!resourcePath)throw new Error('文件缺少当前连接的读取入口，请从工作台重新打开');
    const response=await hanaFetch(resourcePath,{signal});
    const length=Number(response.headers.get('content-length'));if(length>20*1024*1024)throw new Error('文档超过 20 MB，请使用系统应用打开');
    bytes=new Uint8Array(await response.arrayBuffer());signal.throwIfAborted();
  }
  checkOfficeArchive(bytes);return bytes;
}

/** Semantic fallback is loaded only when requested, not before layout rendering. */
export async function loadOfficePreviewText(item:PreviewItem,signal:AbortSignal):Promise<string> {
  signal.throwIfAborted();const connection=resolveServerConnection(useStore.getState());
  if(!isWebRuntime()&&item.filePath&&canUseNativeResourcePath({connection})&&window.platform?.readDocxHtml){
    const html=await window.platform.readDocxHtml(item.filePath);signal.throwIfAborted();
    if(html==null)throw new Error('无法读取文档文本');return html;
  }
  const response=await hanaFetch('/api/preview/office',{signal,throwOnHttpError:false,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({format:'docx',remoteContentRef:item.remoteContentRef,resourceId:item.contentResourceId})});
  const result=await response.json();signal.throwIfAborted();
  if(!response.ok||typeof result.html!=='string')throw new Error(result.error||'无法读取文档文本');return result.html;
}
