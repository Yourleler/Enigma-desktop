import {Hono} from 'hono';
import path from 'node:path';
import {isLocalOwnerPrincipal} from '../http/route-security.ts';
import {resolveWorkbenchPreviewSource} from '../http/workbench-preview-source.ts';
import {readOfficePreview,inspectPdfPreview} from '../../lib/document-preview.ts';
import {resolveResourceContent} from './resources.ts';
import {createRequestContext} from '../http/boundary.ts';

export function createOfficePreviewRoute(engine) {
  const route=new Hono<{Variables:{authPrincipal:any}}>();
  const handler=async c=>{
    let body;try{body=await c.req.json();}catch{return c.json({error:'请求内容无效'},400);}
    let filePath;
    if(typeof body?.resourceId==='string') {
      try {filePath=resolveResourceContent(engine,body.resourceId,createRequestContext(c,engine)).filePath;}
      catch(error){return c.json({error:'文件不可访问，请确认当前权限'},error.status||403);}
    } else if(body?.remoteContentRef?.kind==='workbench-file') {
      const source=resolveWorkbenchPreviewSource(engine,c,body.remoteContentRef);
      if(source.response)return source.response;
      filePath=source.sourceFilePath;
    } else if(isLocalOwnerPrincipal(c.get('authPrincipal'))&&typeof body?.sourceFilePath==='string'&&path.isAbsolute(body.sourceFilePath))filePath=body.sourceFilePath;
    else return c.json({error:'请从已授权的工作台中打开文件'},403);
    try{return c.json(c.req.path.endsWith('/pdf')?await inspectPdfPreview(filePath):await readOfficePreview(filePath,body.format));}
    catch(error){return c.json({error:error.code==='ENOENT'?'文件已移动或不存在':error.message||'文档解析失败'},400);}
  };
  route.post('/preview/office',handler);
  route.post('/preview/pdf',handler);
  return route;
}
