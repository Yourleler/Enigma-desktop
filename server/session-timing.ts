import type { Hono } from 'hono';
import { createRequestContext } from './http/boundary.ts';
import fs from 'node:fs/promises';
import { timeMillis, type SessionTiming, type RuntimeClock } from '../shared/session-timing.ts';
import { engineeringHost } from '../plugins/enigma/host.ts';
import {safeJson} from './hono-helpers.ts';

/** Only reads the session header, current run meter and lightweight task ledgers.
 * Never scans message bodies, repositories or asks a model for status. */
export async function readSessionTiming(engine: any, sessionPath: string, meter: any, now = Date.now()): Promise<SessionTiming> {
  const native = engine.getSessionByPath?.(sessionPath);
  let createdAt = timeMillis(native?.sessionManager?.getHeader?.()?.timestamp);
  if (!createdAt) {
    const file = await fs.open(sessionPath, 'r');
    try {
      const buffer = Buffer.alloc(8192), { bytesRead } = await file.read(buffer,0,buffer.length,0);
      const header = JSON.parse(buffer.subarray(0,bytesRead).toString('utf8').split('\n')[0]);
      if (header.type === 'session') createdAt = timeMillis(header.timestamp);
    } finally { await file.close(); }
  }
  const streaming = !!engine.isSessionStreaming?.(sessionPath) || native?.isIdle === false || !!native?.isCompacting;
  const started = timeMillis(meter?.startedAt);
  let run: RuntimeClock | null = meter ? {kind:'conversation',startedAt:started,elapsedMs:Math.max(0,meter.elapsedMs || 0),state:meter.state==='running'?(streaming?'running':'unknown'):meter.state==='done'?'done':'stopped'} : streaming?{kind:'conversation',startedAt:null,elapsedMs:null,state:'running'}:null;
  const loop=engine.loopController?.toolStatus?.(sessionPath);
  let goal:RuntimeClock|null=null;
  if(loop){
    const start=timeMillis(loop.createdAt), activeSince=timeMillis(loop.activeSince);
    const elapsed=Number.isFinite(loop.activeElapsedMs)?loop.activeElapsedMs+(loop.status==='running'&&activeSince?Math.max(0,now-activeSince):0):start?Math.max(0,(loop.status==='running'?now:timeMillis(loop.updatedAt)||start)-start):null;
    goal={kind:'goal',startedAt:start,elapsedMs:elapsed,state:loop.status==='running'?'running':loop.status==='paused'?'paused':loop.status==='completed'?'done':'stopped',objective:loop.prompt,turnCount:loop.turnCount,maxTurns:loop.limits?.maxTurns,nextRunAt:timeMillis(loop.alarm?.wakeAt),reason:loop.pausedReason,revision:loop.updatedAt};
  }
  let conductor:RuntimeClock|null=null;
  if(engine.pluginManager?.getPlugin?.('enigma')?.status==='loaded'){
    const host=engineeringHost(engine),binding=await host.binding(sessionPath);
    if(binding?.kind==='manager')conductor=await host.conductor(sessionPath).timing(now);
  }
  return {sessionPath,createdAt,sampledAt:now,run,goal,conductor};
}

export function registerSessionTimingRoute(route:Hono,engine:any,snapshot:(path:string)=>any) {
  route.post('/sessions/goal',async c=>{
    try{
      const body=await safeJson(c);
      if(!['pause','resume','stop'].includes(body.action)||!body.sessionPath)return c.json({error:'请选择目标操作和对话'},400);
      const ref=engine.resolveSessionRef({sessionPath:body.sessionPath}),sessionPath=ref.sessionPath||ref.currentLocator?.path;
      if(!sessionPath||ref.lifecycle&&ref.lifecycle!=='active')return c.json({error:'对话不可操作'},409);
      if(!createRequestContext(c,engine).authorize?.('sessions.write',{kind:'session',sessionId:ref.sessionId,sessionPath})?.allowed)return c.json({error:'insufficient_scope'},403);
      const controller=engine.loopController,current=controller?.toolStatus(sessionPath);
      if(!current||current.createdAt!==body.createdAt||current.updatedAt!==body.revision)return c.json({error:'目标状态已变化，请刷新后重试'},409);
      if(!['running','paused'].includes(current.status))return c.json({error:'目标已经结束'},409);
      const target=await controller.targetFromSessionRef(current.target,{ensure:false});
      if(!target)return c.json({error:'目标对话已失效'},409);
      const latest=controller.toolStatus(sessionPath);
      if(latest?.createdAt!==body.createdAt||latest?.updatedAt!==body.revision)return c.json({error:'目标状态已变化，请刷新后重试'},409);
      if(body.action==='pause')await controller.pause(target,'user');
      else if(body.action==='stop')await controller.stop(target);
      else await controller.resume(target);
      return c.json(await readSessionTiming(engine,sessionPath,snapshot(sessionPath)));
    }catch(error){return c.json({error:error instanceof Error?error.message:'目标操作失败'},400);}
  });
  route.get('/sessions/timing',async c=>{
    try {
      if(!c.req.query('path')&&!c.req.query('sessionId'))return c.json({error:'Session is required'},400);
      const ref=engine.resolveSessionRef({sessionPath:c.req.query('path'),sessionId:c.req.query('sessionId')});
      const sessionPath=ref.sessionPath||ref.currentLocator?.path;
      if(!sessionPath)return c.json({error:'Session not found'},404);
      const context=createRequestContext(c,engine);
      if(!context.authorize?.('sessions.read',{kind:'session',sessionId:ref.sessionId,sessionPath})?.allowed)return c.json({error:'insufficient_scope'},403);
      return c.json(await readSessionTiming(engine,sessionPath,snapshot(sessionPath)));
    }catch{return c.json({error:'运行时间暂不可用'},500);}
  });
}
