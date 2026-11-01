import { Hono } from "hono";
import {createRequestContext} from "../http/boundary.ts";
import {queryUsageSummary} from "../usage-summary.ts";
import { denyWithoutScope } from '../http/capability-guard.ts';
import { isUsageRetention, MIN_USAGE_RETENTION, MAX_USAGE_RETENTION } from '../../shared/usage-retention.ts';
import {formatUsageExport} from '../usage-export.ts';

export function createUsageRoute(engine) {
  const route = new Hono();

  route.get('/usage/retention', c => c.json({ ...engine.usageLedger.coverage(), min: MIN_USAGE_RETENTION, max: MAX_USAGE_RETENTION }));
  route.put('/usage/retention', async c => {
    const denied = denyWithoutScope(c, 'settings.write');
    if (denied) return denied;
    let body;
    try { body = await c.req.json(); } catch { return c.json({ error: '请提供有效的保留条数' }, 400); }
    if (!isUsageRetention(body?.maximum)) return c.json({ error: '保留条数须为 100 至 100000 的整数' }, 400);
    try { return c.json({ ...engine.usageLedger.setMaxEntries(body.maximum), min: MIN_USAGE_RETENTION, max: MAX_USAGE_RETENTION }); }
    catch { return c.json({ error: '未能保存保留条数，原记录未改动' }, 500); }
  });

  route.get("/usage/llm", (c) => {
    const query = c.req.query();
    const filter: Record<string, any> = {};
    for (const key of [
      "since",
      "until",
      "attributionKind",
      "sessionId",
      "sessionPath",
      "childSessionId",
      "childSessionPath",
      "agentId",
      "subsystem",
      "operation",
      "modelId",
      "provider",
      "status",
    ]) {
      if (typeof query[key] === "string" && query[key].trim()) filter[key] = query[key].trim();
    }
    const hasDateWindow = !!filter.since || !!filter.until;
    if (typeof query.limit === "string" && query.limit.trim()) {
      const rawLimit = query.limit.trim().toLowerCase();
      if (rawLimit !== "all") {
        const limit = Number(rawLimit);
        filter.limit = Number.isFinite(limit) && limit > 0
          ? Math.min(Math.floor(limit), 2_000)
          : 500;
      }
    } else if (!hasDateWindow) {
      filter.limit = 500;
    }
    return c.json(engine.usageLedger.list(filter));
  });

  const readSummary=(c,allRecords=false)=>{
      const query=c.req.query();let session;
      if(query.sessionPath||query.sessionId){
        const ref=engine.resolveSessionRef({sessionPath:query.sessionPath,sessionId:query.sessionId});
        const sessionPath=ref.sessionPath||ref.currentLocator?.path;
        if(!sessionPath)return c.json({error:'对话不存在'},404);
        if(!createRequestContext(c,engine).authorize?.('sessions.read',{kind:'session',sessionId:ref.sessionId,sessionPath})?.allowed)return c.json({error:'无权读取该对话用量'},403);
        session={sessionId:ref.sessionId,sessionPath};
      }
      return queryUsageSummary(engine.usageLedger,query,session,{allRecords});
  };
  route.get('/usage/summary', c=>{
    try {
      const result=readSummary(c);return result instanceof Response?result:c.json(result);
    }catch(error){return c.json({error:error instanceof Error?error.message:'用量统计读取失败'},400);}
  });
  route.get('/usage/export',c=>{
    try{
      const format=c.req.query('format');
      if(format!=='csv'&&format!=='json')return c.json({error:'请选择 CSV 或 JSON 格式'},400);
      const report=readSummary(c,true);if(report instanceof Response)return report;
      const body=formatUsageExport(report,c.req.query(),format);
      return new Response(body,{headers:{'Content-Type':format==='csv'?'text/csv; charset=utf-8':'application/json; charset=utf-8',
        'Content-Disposition':`attachment; filename="enigma-usage-${new Date(report.sampledAt).toISOString().slice(0,10)}.${format}"`,
        'Cache-Control':'no-store','X-Enigma-Usage-Export':'1'}});
    }catch(error){return c.json({error:error instanceof Error?error.message:'用量导出失败'},400);}
  });
  return route;
}
