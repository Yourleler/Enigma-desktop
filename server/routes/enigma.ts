import { Hono } from 'hono';
import { safeJson } from '../hono-helpers.ts';
import { createRequestContext } from '../http/boundary.ts';
import { engineeringHost } from '../../plugins/enigma/host.ts';
import { Artifacts } from 'enigma-next';
import fs from 'node:fs/promises';

/** Thin authenticated transport for the system engineering plugin. */
export function createEnigmaRoute(engine: any) {
  const route = new Hono(), host = engineeringHost(engine);
  async function session(c: any, write = false, body: any = {}) {
    const ref = engine.resolveSessionRef({ sessionId: body.sessionId || c.req.query('sessionId'), sessionPath: body.sessionPath || c.req.query('sessionPath') });
    const sessionPath = ref.sessionPath || ref.currentLocator?.path;
    if (!sessionPath) throw new Error('Native session locator is unavailable');
    const context = createRequestContext(c, engine);
    const allowed = context.authorize?.(write ? 'sessions.write' : 'sessions.read', { kind: 'session', sessionId: ref.sessionId, sessionPath });
    if (!allowed?.allowed) {
      const error: any = new Error('Insufficient access to this conversation'); error.status = 403; throw error;
    }
    if (ref.lifecycle && ref.lifecycle !== 'active') { const error: any = new Error('Conversation is not active'); error.status = 409; throw error; }
    return sessionPath;
  }
  const fail = (c: any, error: any) => c.json({ error: error.message || String(error) }, error.status || 400);
  route.get('/enigma', async c => {
    try { return c.json(await host.snapshot(await session(c))); } catch (error) { return fail(c, error); }
  });
  route.post('/enigma/connect', async c => {
    try {
      const body = await safeJson(c), sessionPath = await session(c, true, body);
      if (typeof body.root !== 'string' || !body.root.trim()) throw new Error('Select an engineering workspace directory');
      return c.json(await host.connect(sessionPath, body.root, body.memory === true));
    } catch (error) { return fail(c, error); }
  });
  route.post('/enigma/model', async c => {
    try {
      const body = await safeJson(c), sessionPath = await session(c, true, body);
      if (typeof body.provider !== 'string' || typeof body.modelId !== 'string') throw new Error('Select a configured provider and model');
      return c.json(await host.requestModel(sessionPath, body.provider, body.modelId));
    } catch (error) { return fail(c, error); }
  });
  route.post('/enigma/model-policy', async c => {
    try { const body=await safeJson(c);return c.json(await host.configureModelPolicy(await session(c,true,body),body.policy)); }
    catch(error){return fail(c,error);}
  });
  route.get("/enigma/model-policy-default", async (c) => {
    try {
      const context = createRequestContext(c, engine);
      if (!context.authorize?.("settings.read")?.allowed)
        return c.json({ error: "Settings permission required" }, 403);
      return c.json({ policy: await host.getDefaultModelPolicy() });
    } catch (error) { return fail(c, error); }
  });
  route.post('/enigma/model-policy-default', async c => {
    try {
      const context=createRequestContext(c,engine),allowed=context.authorize?.('settings.write');
      if(!allowed?.allowed)return c.json({error:'Settings permission required'},403);
      const body=await safeJson(c);return c.json(await host.configureDefaultModelPolicy(body.policy));
    }catch(error){return fail(c,error);}
  });
  route.post('/enigma/conductor/new',async c=>{try{const body=await safeJson(c);return c.json(await host.createConductor(await session(c,true,body),body.limits));}catch(error){return fail(c,error);}});
  route.post('/enigma/conductor/report',async c=>{try{const body=await safeJson(c);return c.json(await host.conductor(await session(c,true,body)).report());}catch(error){return fail(c,error);}});
  route.post('/enigma/guardian/start',async c=>{try{const body=await safeJson(c);return c.json(await host.guardian.start(await session(c,true,body),body.config));}catch(error){return fail(c,error);}});
  route.post('/enigma/guardian/stop',async c=>{try{const body=await safeJson(c);return c.json(await host.guardian.stop(await session(c,true,body)));}catch(error){return fail(c,error);}});
  route.get('/enigma/guardian/status',async c=>{try{return c.json(await host.guardian.status(await session(c)));}catch(error){return fail(c,error);}});
  route.post('/enigma/guardian/diagnose',async c=>{try{const body=await safeJson(c);return c.json(await host.guardian.diagnose(await session(c,false,body),body.question));}catch(error){return fail(c,error);}});
  route.post('/enigma/guardian/act',async c=>{try{const body=await safeJson(c);return c.json(await host.guardian.act(await session(c,true,body),body));}catch(error){return fail(c,error);}});
  route.get('/enigma/data/:group', async c => {
    try { return c.json(await host.data(await session(c), c.req.param('group'), c.req.query('query') || '')); } catch (error) { return fail(c, error); }
  });
  route.post('/enigma/action', async c => {
    try {
      const body = await safeJson(c), sessionPath = await session(c, true, body);
      if (typeof body.action !== 'string' || !body.args || typeof body.args !== 'object' || Array.isArray(body.args)) throw new Error('Invalid engineering operation');
      return c.json(await host.action(sessionPath, body.action, body.args));
    } catch (error) { return fail(c, error); }
  });
  route.post('/enigma/cancel', async c => {
    try { const body = await safeJson(c); return c.json(await host.cancel(await session(c, true, body))); } catch (error) { return fail(c, error); }
  });
  route.get('/enigma/content', async c => {
    try { return c.json(await host.content(await session(c), { repo: c.req.query('repo'), file: c.req.query('file'), resource: c.req.query('resource'), artifact: c.req.query('artifact') })); }
    catch (error) { return fail(c, error); }
  });
  route.get('/enigma/files/:repo', async c => {
    try {
      const controller = await host.controller(await session(c));
      const files = await controller.options.workspace.files(c.req.param('repo'));
      return c.json({ repo: c.req.param('repo'), files: files.slice(0, 5000), truncated: files.length > 5000 });
    } catch (error) { return fail(c, error); }
  });
  route.get('/enigma/artifact/:id', async c => {
    try {
      const controller = await host.controller(await session(c));
      const artifact = await new Artifacts(controller.options.workspace).read(c.req.param('id'), controller.chat.session);
      return c.body(await fs.readFile(artifact.path), 200, { 'Content-Type': artifact.record.kind === 'screenshot' ? 'image/png' : 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${artifact.record.id}${artifact.record.extension}"`, 'Cache-Control': 'no-store' });
    } catch (error) { return fail(c, error); }
  });
  return route;
}
