import {MountAwareFileService} from '../../core/mount-aware-file-service.ts';
import {createRequestContext} from './boundary.ts';

/** Resolve previews through the current principal and mount capabilities,
 * without making the open server depend on the mobile UI route module. */
export function resolveWorkbenchPreviewSource(engine, c, ref) {
  const context=createRequestContext(c,engine);
  if(context.authPrincipal?.kind!=='unknown') {
    const decision=context.authorize('files.read',{kind:'studio',studioId:context.studioId});
    if(!decision.allowed)return {response:c.json({error:'insufficient_scope',reason:decision.reason},403)};
  }
  try {
    const resourceIO=engine.resourceIO||engine.getResourceIO?.();
    const files=new MountAwareFileService({hanakoHome:engine.hanakoHome,
      defaultRoot:engine.defaultDeskCwd||engine.homeCwd||engine.deskCwd,studioId:context.studioId,
      resourceIO:resourceIO&&typeof resourceIO.stat==='function'&&typeof resourceIO.read==='function'?resourceIO:null,
    });
    const target=files.contentTarget(ref.mountId||ref.rootId||'default',ref.subdir||'',ref.name);
    return {sourceFilePath:target.filePath,sourceRootPath:target.root.path};
  } catch(error) {return {response:c.json({error:error.message||'文件不可访问'},error.status||400)};}
}
