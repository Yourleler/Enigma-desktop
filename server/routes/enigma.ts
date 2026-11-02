import {desktopInputQueue} from '../../core/desktop-input-queue.ts';
import { SessionChanges } from '../../plugins/enigma/session-changes.ts';
import {ChangeWorkbench} from '../../plugins/enigma/change-workbench.ts';
import { Hono } from "hono";
import { safeJson } from "../hono-helpers.ts";
import { createRequestContext } from "../http/boundary.ts";
import { engineeringHost } from "../../plugins/enigma/host.ts";
import { Artifacts, DocumentationStore,BackgroundRuns,TaskEvents,ServiceManager,artifactPresentation,artifactContentDisposition,readStoredReviewSource } from "enigma-next";
import fs from "node:fs/promises";
import { withNativeEngineeringExecution } from "../../plugins/enigma/execution-policy.ts";
import { isReadOnlyPermissionMode } from '../../core/session-permission-mode.ts';
import { hash } from 'enigma-next/storage';

/** Thin authenticated transport for the system engineering plugin. */
export function createEnigmaRoute(engine: any) {
  const route = new Hono(),
    host = engineeringHost(engine);
  async function session(c: any, write = false, body: any = {}) {
    const ref = engine.resolveSessionRef({
      sessionId: body.sessionId || c.req.query("sessionId"),
      sessionPath: body.sessionPath || c.req.query("sessionPath"),
    });
    const sessionPath = ref.sessionPath || ref.currentLocator?.path;
    if (!sessionPath) throw new Error("Native session locator is unavailable");
    const context = createRequestContext(c, engine);
    const allowed = context.authorize?.(
      write ? "sessions.write" : "sessions.read",
      { kind: "session", sessionId: ref.sessionId, sessionPath },
    );
    if (!allowed?.allowed) {
      const error: any = new Error("Insufficient access to this conversation");
      error.status = 403;
      throw error;
    }
    if (ref.lifecycle && ref.lifecycle !== "active") {
      const error: any = new Error("Conversation is not active");
      error.status = 409;
      throw error;
    }
    return sessionPath;
  }
  const fail = (c: any, error: any) =>
    c.json({ error: error.message || String(error) }, error.status || 400);
  route.get("/enigma", async (c) => {
    try {
      return c.json(await host.snapshot(await session(c)));
    } catch (error) {
      return fail(c, error);
    }
  });
  route.get('/enigma/input-queue',async c=>{try{return c.json(await desktopInputQueue(engine).read(await session(c)));}catch(error){return fail(c,error);}});
  route.post('/enigma/input-queue',async c=>{try{const body=await safeJson(c),sessionPath=await session(c,true,body);return c.json(await desktopInputQueue(engine).add(sessionPath,body));}catch(error){return fail(c,error);}});
  route.patch('/enigma/input-queue',async c=>{try{const body=await safeJson(c),sessionPath=await session(c,true,body);return c.json(await desktopInputQueue(engine).update(sessionPath,body));}catch(error){return fail(c,error);}});
  route.post('/enigma/input-queue/send',async c=>{try{const body=await safeJson(c),sessionPath=await session(c,true,body);await desktopInputQueue(engine).sendNow(sessionPath,body.id);return c.json({ok:true});}catch(error){return fail(c,error);}});
  const changes = new SessionChanges(engine, host);
  const readingWorkbench=new ChangeWorkbench(engine,host);
  const readingAccess=async(c:any,write=false,body:any={})=>{
    const sessionPath=await session(c,write,body);
    if(!createRequestContext(c,engine).authorize?.('files.read',{kind:'session',sessionPath})?.allowed)throw Error('没有读取当前文件的权限');
    if(write&&isReadOnlyPermissionMode(engine.getSessionPermissionMode?.(sessionPath)))throw Error('只读对话不能发起分析或修复操作');
    return sessionPath;
  };
  route.get('/enigma/change-workbench',async c=>{try{return c.json(await readingWorkbench.catalog(await readingAccess(c)));}catch(error){return fail(c,error);}});
  route.get('/enigma/change-workbench/summary',async c=>{try{return c.json(await readingWorkbench.summary(await readingAccess(c)));}catch(error){return fail(c,error);}});
  route.post('/enigma/change-workbench/source',async c=>{try{const body=await safeJson(c),sp=await readingAccess(c,false,body);return c.json(await readingWorkbench.capture(sp,body.input));}catch(error){return fail(c,error);}});
  route.get('/enigma/change-workbench/source',async c=>{try{return c.json(await readingWorkbench.source(await readingAccess(c),c.req.query('id')||''));}catch(error){return fail(c,error);}});
  route.get('/enigma/change-workbench/file',async c=>{try{return c.json(await readingWorkbench.file(await readingAccess(c),c.req.query('id')||'',c.req.query('repo')||'',c.req.query('file')||''));}catch(error){return fail(c,error);}});
  route.post('/enigma/change-workbench/analyze',async c=>{try{const body=await safeJson(c),sp=await readingAccess(c,true,body);if(!['reading','review'].includes(body.kind))throw Error('分析类型无效');return c.json(await readingWorkbench.analyze(sp,body.source,body.kind,body.model,body.previous));}catch(error){return fail(c,error);}});
  route.get('/enigma/change-workbench/job',async c=>{try{return c.json(await readingWorkbench.job(await readingAccess(c),c.req.query('id')||''));}catch(error){return fail(c,error);}});
  route.post('/enigma/change-workbench/action',async c=>{try{const body=await safeJson(c),sp=await readingAccess(c,true,body);return c.json(await readingWorkbench.action(sp,body.job,body.action,body.finding,body.reason));}catch(error){return fail(c,error);}});
  route.get('/enigma/changes/files',async c=>{
    try{
      const sessionPath=await session(c);
      if(!createRequestContext(c,engine).authorize?.('files.read',{kind:'session',sessionPath})?.allowed)return c.json({error:'没有读取当前项目的权限'},403);
      return c.json(await changes.fileStatuses(sessionPath,AbortSignal.any([c.req.raw.signal,AbortSignal.timeout(25000)])));
    }catch(error){return fail(c,error);}
  });
  route.get('/enigma/changes', async c => {
    try {
      const sessionPath = await session(c);
      if (!createRequestContext(c, engine).authorize?.('files.read', { kind: 'session', sessionPath })?.allowed) return c.json({ error: '没有读取当前项目的权限' }, 403);
      return c.json(await changes.summary(sessionPath, c.req.raw.signal));
    }
    catch (error) { return fail(c, error); }
  });
  route.get('/enigma/changes/source', async c => {
    try {
      const sessionPath = await session(c);
      if (!createRequestContext(c, engine).authorize?.('files.read', { kind: 'session', sessionPath })?.allowed) return c.json({ error: '没有读取当前项目的权限' }, 403);
      return c.json(await changes.source(sessionPath, c.req.query('repo') || '', c.req.query('file') || ''));
    } catch (error) { return fail(c, error); }
  });
  route.post('/enigma/changes/read', async c => {
    try {
      const body = await safeJson(c), sessionPath = await session(c, false, body);
      if (!['working', 'staged'].includes(body.kind)) return c.json({ error: '请选择工作区或暂存变更' }, 400);
      const context = createRequestContext(c, engine);
      if (!context.authorize?.('files.read', { kind: 'session', sessionPath })?.allowed) return c.json({ error: '没有读取当前项目的权限' }, 403);
      return c.json(await changes.read(sessionPath, body.kind, AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(90000)])));
    } catch (error) { return fail(c, error); }
  });
  route.post("/enigma/connect", async (c) => {
    try {
      const body = await safeJson(c),
        sessionPath = await session(c, true, body);
      if (body.root === undefined) return c.json(await host.connectProject(sessionPath, body.memory === true));
      if (typeof body.root !== "string" || !body.root.trim())
        throw new Error("请选择有效的工作目录");
      return c.json(
        await host.connect(sessionPath, body.root, body.memory === true),
      );
    } catch (error) {
      return fail(c, error);
    }
  });
  route.post("/enigma/model", async (c) => {
    try {
      const body = await safeJson(c),
        sessionPath = await session(c, true, body);
      if (typeof body.provider !== "string" || typeof body.modelId !== "string")
        throw new Error("Select a configured provider and model");
      return c.json(
        await host.requestModel(sessionPath, body.provider, body.modelId),
      );
    } catch (error) {
      return fail(c, error);
    }
  });
  route.post("/enigma/model-policy", async (c) => {
    try {
      const body = await safeJson(c);
      return c.json(
        await host.configureModelPolicy(
          await session(c, true, body),
          body.policy,
        ),
      );
    } catch (error) {
      return fail(c, error);
    }
  });
  route.get('/enigma/model-policy', async c => {
    try {
      const sessionPath = await session(c);
      return c.json({policy:(await host.modelBinding(sessionPath))?.modelPolicy || null});
    } catch(error) { return fail(c,error); }
  });
  route.get("/enigma/model-policy-default", async (c) => {
    try {
      const context = createRequestContext(c, engine);
      if (!context.authorize?.("settings.read")?.allowed)
        return c.json({ error: "Settings permission required" }, 403);
      return c.json({ policy: await host.getDefaultModelPolicy() });
    } catch (error) { return fail(c, error); }
  });
  route.post("/enigma/model-policy-default", async (c) => {
    try {
      const context = createRequestContext(c, engine),
        allowed = context.authorize?.("settings.write");
      if (!allowed?.allowed)
        return c.json({ error: "Settings permission required" }, 403);
      const body = await safeJson(c);
      return c.json(await host.configureDefaultModelPolicy(body.policy));
    } catch (error) {
      return fail(c, error);
    }
  });
  route.post("/enigma/conductor/new", async (c) => {
    try {
      const body = await safeJson(c);
      let sourcePath:string|null=null;
      if(body.sessionPath||body.sessionId)sourcePath=await session(c,true,body);
      else{
        const context=createRequestContext(c,engine);
        if(!context.authorize?.('sessions.write',{kind:'studio',studioId:context.studioId})?.allowed)return c.json({error:'没有创建管家对话的权限'},403);
      }
      return c.json(
        await host.createConductor(sourcePath, body.limits,{agentId:body.agentId,modelPolicy:body.modelPolicy}),
      );
    } catch (error) {
      return fail(c, error);
    }
  });
  route.post("/enigma/conductor/report", async (c) => {
    try {
      const body = await safeJson(c);
      return c.json(
        await host.conductor(await session(c, true, body)).report(),
      );
    } catch (error) {
      return fail(c, error);
    }
  });
  route.post('/enigma/side-chat/new',async c=>{
    try{const body=await safeJson(c);return c.json(await host.createSideConversation(await session(c,true,body),body.includeContext===true));}
    catch(error){return fail(c,error);}
  });
  route.post('/enigma/conductor/cancel',async c=>{
    try{const body=await safeJson(c),sessionPath=await session(c,true,body);if(typeof body.id!=='string'||!body.id.trim())return c.json({error:'请选择当前管家创建的工作对话'},400);return c.json(await host.conductor(sessionPath).cancel(body.id));}
    catch(error){return fail(c,error);}
  });
  route.post('/enigma/runtime/cancel',async c=>{
    try{
      const body=await safeJson(c),sessionPath=await session(c,true,body);
      if(!['service','background','wait'].includes(body.kind)||typeof body.id!=='string'||!body.id.trim())return c.json({error:'请选择已登记的服务、后台任务或等待'},400);
      const controller=await host.controller(sessionPath),workspace=controller.options.workspace,task=controller.chat.session;
      const result=body.kind==='service'?await new ServiceManager(workspace).stop(body.id):body.kind==='background'?await new BackgroundRuns(workspace).cancel(body.id,task):await new TaskEvents(workspace).cancel(body.id,task);
      host.publish(sessionPath,'refresh',{event:'settled'});return c.json(controller.safeSnapshot(result));
    }catch(error){return fail(c,error);}
  });
  route.post("/enigma/guardian/start", async (c) => {
    try {
      const body = await safeJson(c);
      return c.json(
        await host.guardian.start(await session(c, true, body), body.config),
      );
    } catch (error) {
      return fail(c, error);
    }
  });
  route.post("/enigma/guardian/stop", async (c) => {
    try {
      const body = await safeJson(c);
      return c.json(await host.guardian.stop(await session(c, true, body)));
    } catch (error) {
      return fail(c, error);
    }
  });
  route.get("/enigma/guardian/status", async (c) => {
    try {
      return c.json(await host.guardian.status(await session(c)));
    } catch (error) {
      return fail(c, error);
    }
  });
  route.post("/enigma/guardian/diagnose", async (c) => {
    try {
      const body = await safeJson(c);
      return c.json(
        await host.guardian.diagnose(
          await session(c, false, body),
          body.question,
        ),
      );
    } catch (error) {
      return fail(c, error);
    }
  });
  route.post("/enigma/guardian/act", async (c) => {
    try {
      const body = await safeJson(c);
      return c.json(
        await host.guardian.act(await session(c, true, body), body),
      );
    } catch (error) {
      return fail(c, error);
    }
  });
  route.get("/enigma/memory-dream", async (c) => {
    try {
      return c.json(await host.memoryWork.list(await session(c)));
    } catch (error) {
      return fail(c, error);
    }
  });
  route.post("/enigma/memory-dream", async (c) => {
    try {
      const body = await safeJson(c);
      return c.json(
        await host.memoryWork.start(
          await session(c, true, body),
          body.sources,
          body.maxRequests,
        ),
      );
    } catch (error) {
      return fail(c, error);
    }
  });
  route.post("/enigma/memory-dream/control", async (c) => {
    try {
      const body = await safeJson(c);
      if (!["pause", "cancel", "resume", "publish", "recover"].includes(body.action))
        throw new Error("Select a memory work action");
      return c.json(
        await host.memoryWork.action(
          await session(c, true, body),
          body.id,
          body.action,
        ),
      );
    } catch (error) {
      return fail(c, error);
    }
  });
  route.post("/enigma/memory-feedback", async (c) => {
    try {
      const body = await safeJson(c);
      return c.json(
        await host.memoryWork.feedback(
          await session(c, true, body),
          body.id,
          body.verdict,
        ),
      );
    } catch (error) {
      return fail(c, error);
    }
  });
  route.post("/enigma/document/register", async (c) => {
    try {
      const body = await safeJson(c),sessionPath=await session(c,true,body);
      if(isReadOnlyPermissionMode(engine.getSessionPermissionMode(sessionPath)))return c.json({error:'当前对话只读，不能登记文档'},403);
      const controller = await host.controller(sessionPath);
      return c.json(
        await new DocumentationStore(controller.options.workspace).register(
          body.document,
        ),
      );
    } catch (error) {
      return fail(c, error);
    }
  });
  route.post("/enigma/document/example", async (c) => {
    try {
      const body = await safeJson(c),
        sessionPath = await session(c, true, body),
        controller = await host.controller(sessionPath),
        store = new DocumentationStore(controller.options.workspace),
        document = await store.read(body.id),
        example = document.record.examples?.find(
          (item) => item.id === body.example,
        );
      if (!example) throw new Error("Select a registered example");
      if (
        (await host.confirm(sessionPath, {
          kind: "confirm",
          title: "运行文档示例",
          message: JSON.stringify(example),
        })) !== true
      )
        throw new Error("Document example was not approved");
      return c.json(
        await withNativeEngineeringExecution(
          engine,
          controller.options.workspace,
          sessionPath,
          () => store.runExample(body.id, body.example),
        ),
      );
    } catch (error) {
      return fail(c, error);
    }
  });
  route.get('/enigma/choices', async c => {
    try { const sources=(c.req.query('sources')||'').split(',').filter(Boolean);return c.json(await host.choices(await session(c),sources,c.req.query('query')||'')); }
    catch(error){return fail(c,error);}
  });
  route.get("/enigma/data/:group", async (c) => {
    try {
      return c.json(
        await host.data(
          await session(c),
          c.req.param("group"),
          c.req.query("query") || "",
          {offset:c.req.query('offset')===undefined?undefined:Number(c.req.query('offset'))},
        ),
      );
    } catch (error) {
      return fail(c, error);
    }
  });
  route.post("/enigma/action", async (c) => {
    try {
      const body = await safeJson(c),
        sessionPath = await session(c, true, body);
      if (
        typeof body.action !== "string" ||
        !body.args ||
        typeof body.args !== "object" ||
        Array.isArray(body.args)
      )
        throw new Error("Invalid engineering operation");
      return c.json(await host.action(sessionPath, body.action, body.args));
    } catch (error) {
      return fail(c, error);
    }
  });
  route.post("/enigma/cancel", async (c) => {
    try {
      const body = await safeJson(c);
      return c.json(await host.cancel(await session(c, true, body)));
    } catch (error) {
      return fail(c, error);
    }
  });
  route.get("/enigma/content", async (c) => {
    try {
      return c.json(
        await host.content(await session(c), {
          repo: c.req.query("repo"),
          file: c.req.query("file"),
          resource: c.req.query("resource"),
          artifact: c.req.query("artifact"),
        }),
      );
    } catch (error) {
      return fail(c, error);
    }
  });
  route.get("/enigma/files/:repo", async (c) => {
    try {
      const query=(c.req.query('query')||'').trim(),offset=Number(c.req.query('offset')||0),limit=Number(c.req.query('limit')||5000),expected=c.req.query('version');
      if(query.length>500 || !Number.isInteger(offset) || offset<0 || offset>1_000_000 || !Number.isInteger(limit) || limit<1 || limit>5000 || expected&&!/^[a-f0-9]{64}$/.test(expected))return c.json({error:'请使用有效的文件查询和分页范围。'},400);
      const controller = await host.controller(await session(c));
      const files = await controller.options.workspace.files(
        c.req.param("repo"),
      );
      const matched=files.filter(file=>file.toLowerCase().includes(query.toLowerCase())),version=hash(JSON.stringify({repo:c.req.param('repo'),query,files}));
      if(expected&&expected!==version)return c.json({error:'仓库文件列表已变化，请刷新后重新浏览。'},409);
      return c.json({
        repo: c.req.param("repo"),
        files: matched.slice(offset, offset+limit),
        truncated: offset+limit<matched.length,
        totalFiles:files.length,totalMatches:matched.length,offset,limit,version,
        nextOffset:offset+limit<matched.length?offset+limit:null,
      });
    } catch (error) {
      return fail(c, error);
    }
  });
  route.get('/enigma/review/source',async c=>{
    try{
      const controller=await host.controller(await session(c)),review=c.req.query('review'),repo=c.req.query('repo'),file=c.req.query('file'),side=c.req.query('side')||'target';
      if(!review||!repo||!file||!['baseline','target'].includes(side))return c.json({error:'请选择报告及其中的源码文件。'},400);
      const start=Number(c.req.query('start')||1),end=Number(c.req.query('end')||start+179);
      return c.json(await readStoredReviewSource(controller.options.workspace,review,controller.chat.session,repo,file,start,end,side as 'baseline'|'target'));
    }catch(error){return fail(c,error);}
  });
  route.get("/enigma/artifact/:id", async (c) => {
    try {
      const controller = await host.controller(await session(c));
      const artifact = await new Artifacts(controller.options.workspace).read(
        c.req.param("id"),
        controller.chat.session,
      );
      const bytes = await fs.readFile(artifact.path);
      return c.body(bytes, 200, {
        "Content-Type": artifactPresentation(artifact.record, bytes).mediaType,
        "Content-Disposition": artifactContentDisposition(artifact.record),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      });
    } catch (error) {
      return fail(c, error);
    }
  });
  return route;
}
