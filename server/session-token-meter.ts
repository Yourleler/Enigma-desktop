import { TransportStatusFilter } from './transport-status-filter.ts';
/**
 * session-token-meter.ts — 实时 Token 流速表（Claude Code 风格 ↑/↓）
 *
 * 设计目标：在模型“上传请求 / 流式下传”期间给出**连续跳动**的 token 数，
 * 而不是只在 turn 结束后才出现一个最终用量。
 *
 * 数据来源分两层：
 *   1. 估算（estimated=true）：
 *      - 上传：复用宿主 getContextUsage()（上一条真实 usage + 尾部消息估算）；
 *      - 下传：按流式 delta 字符数估算，中日韩字符按 ~1 token/字、拉丁按 ~1/4。
 *   2. 真值（estimated=false）：
 *      - provider 在 SSE 中回传 usage 后立即覆盖估算（Anthropic 首包给 input、
 *        message_delta 给 output；OpenAI 系在末包给全量）。
 *
 * 一个“run”= 用户一次发送后 agent 的完整执行（可能含多个工具回合）。
 * session_status(true/false) 包裹整体；没有该事件的宿主路径（插件/旁路）
 * 用 turn_start 懒启动、turn_end 后延迟收尾兜底。
 */

import type {
  TokenMeterPhase,
  TokenMeterSnapshot as TokenMeterSnapshotShape,
} from "../shared/token-meter-types.ts";

export type {
  TokenMeterPhase,
  TokenMeterSnapshot,
} from "../shared/token-meter-types.ts";

interface MeterRequest {
  statusFilter: TransportStatusFilter;
  model: string | null;
  startedAt: number;
  firstByteAt: number | null;
  endedAt: number | null;
  phase: TokenMeterPhase;
  inputEstimate: number;
  inputReal: number | null;
  cacheRead: number;
  cacheWrite: number;
  downEstimate: number;
  downReal: number | null;
  /** provider 是否给过非零 output（决定结束时可否用真值覆盖估算）。 */
  sawRealDown: boolean;
  cjkChars: number;
  otherChars: number;
  estimateAtUsage: number;
  lastOutputAt: number | null;
}

interface MeterState {
  runId: number;
  startedAt: number;
  endedAt: number | null;
  state: "running" | "done" | "aborted";
  model: string | null;
  requests: MeterRequest[];
  /** 延迟收尾定时器（无 session_status 包裹的宿主路径）。 */
  idleFinishTimer?: ReturnType<typeof setTimeout>;
  lastEmitAt: number;
  /** 最近速率采样：[时间戳, 估算下传数]。 */
  lastRateSample: { at: number; down: number; rate: number } | null;
  rate: number;
  /** run 开始后、首个 request 建立前持续刷新的上行估算（轻事件链）。 */
  pendingInputEstimate: number;
  managedLifecycle: boolean;
}

const EMIT_INTERVAL_MS = 140;
const IDLE_FINISH_DELAY_MS = 2500;
const CJK_RE = /[㐀-䶿一-鿿豈-﫿぀-ゟ゠-ヿ가-힯]/g;

/** 流式输出的字符→token 粗估：CJK 按 1 token/字，其余按 4 字符/token。 */
export function estimateStreamTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(CJK_RE) || []).length;
  const other = text.length - cjk;
  return Math.ceil(cjk + other / 4);
}

function normalizeUsage(usage: any): {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning?: number;
} | null {
  if (!usage || typeof usage !== "object") return null;
  const num = (v: unknown) =>
    Number.isFinite(v) ? Math.max(0, Math.round(v as number)) : 0;
  const input = num(usage.input);
  const output = num(usage.output);
  const cacheRead = num(usage.cacheRead);
  const cacheWrite = num(usage.cacheWrite);
  if (!input && !output && !cacheRead && !cacheWrite) return null;
  const reasoning = num(usage.reasoning) || undefined;
  return { input, output, cacheRead, cacheWrite, reasoning };
}

export class SessionTokenMeters {
  private readonly meters = new Map<string, MeterState>();
  private seq = 0;

  /**
   * 发送或取消时若上一轮没收尾，先重置，避免串轮。
   */
  startRun(sessionPath: string, now = Date.now(), managedLifecycle = false): void {
    const existing = this.meters.get(sessionPath);
    if (existing?.idleFinishTimer) clearTimeout(existing.idleFinishTimer);
    this.meters.set(sessionPath, {
      runId: ++this.seq,
      startedAt: now,
      endedAt: null,
      state: "running",
      model: null,
      requests: [],
      lastEmitAt: 0,
      lastRateSample: null,
      rate: 0,
      pendingInputEstimate: 0,
      managedLifecycle,
    });
    const completed=[...this.meters].filter(([,meter])=>meter.state!=='running');
    for(const [path] of completed.slice(0,Math.max(0,completed.length-200)))this.drop(path);
  }

  activateLifecycle(sessionPath:string,now=Date.now()){
    const meter=this.meters.get(sessionPath);
    if(!meter||meter.state!=='running'){this.startRun(sessionPath,now,true);return;}
    meter.managedLifecycle=true;
    if(meter.idleFinishTimer){clearTimeout(meter.idleFinishTimer);meter.idleFinishTimer=undefined;}
  }

  beginRequest(
    sessionPath: string,
    opts: {
      inputEstimate?: number | null;
      model?: string | null;
      now?: number;
    } = {},
  ): void {
    const meter = this.ensure(sessionPath, opts.now ?? Date.now());
    if (meter.idleFinishTimer) {
      clearTimeout(meter.idleFinishTimer);
      meter.idleFinishTimer = undefined;
    }
    if (opts.model) meter.model = opts.model;
    meter.lastRateSample = null;
    meter.rate = 0;
    const inputEstimate =
      opts.inputEstimate ?? (meter.pendingInputEstimate || null);
    meter.requests.push({
      statusFilter: new TransportStatusFilter(),
      model: opts.model ?? meter.model,
      startedAt: opts.now ?? Date.now(),
      firstByteAt: null,
      endedAt: null,
      phase: "upload",
      inputEstimate: Math.max(0, Math.round(inputEstimate ?? 0)),
      inputReal: null,
      cacheRead: 0,
      cacheWrite: 0,
      downEstimate: 0,
      downReal: null,
      sawRealDown: false,
      cjkChars: 0,
      otherChars: 0,
      estimateAtUsage: 0,
      lastOutputAt: null,
    });
  }

  /** 开启新的一次模型请求；上一请求仍活跃时忽略（turn_start 与 session_status 可能同时触发）。 */
  beginRequestUnlessActive(
    sessionPath: string,
    opts: {
      inputEstimate?: number | null;
      model?: string | null;
      now?: number;
    } = {},
  ): void {
    const meter = this.ensure(sessionPath, opts.now ?? Date.now());
    const last = meter.requests.at(-1);
    if (last && last.endedAt == null) return;
    this.beginRequest(sessionPath, opts);
  }

  /** 定时器扫描用：仍在运行的会话（140ms tick 本身很轻；收尾靠 finishRun/idle）。 */
  activePaths(): string[] {
    const out: string[] = [];
    for (const [path, meter] of this.meters) {
      if (meter.state === "running") out.push(path);
    }
    return out;
  }

  /** 丢弃一个会话的计量（运行时关闭/删除会话时）。 */
  drop(sessionPath: string): void {
    const meter = this.meters.get(sessionPath);
    if (meter?.idleFinishTimer) clearTimeout(meter.idleFinishTimer);
    this.meters.delete(sessionPath);
  }

  addDelta(
    sessionPath: string,
    delta: string | undefined,
    phase: Extract<TokenMeterPhase, "thinking" | "writing">,
    now = Date.now(),
    opts: { inputEstimate?: number | null; model?: string | null } = {},
  ): void {
    if (!delta) return;
    const meter = this.ensure(sessionPath, now);
    if (meter.requests.length === 0) {
      this.beginRequest(sessionPath, { ...opts, now });
    }
    const req = meter.requests.at(-1);
    if (!req || req.endedAt != null) return;
    if (opts.model) req.model = opts.model;
    delta = phase === 'thinking' ? req.statusFilter.push(delta) : req.statusFilter.flush() + delta;
    if (!delta) { if (req.statusFilter.waiting) req.phase='upload'; return; }
    if (req.firstByteAt == null) req.firstByteAt = now;
    req.lastOutputAt = now;
    req.phase = phase;
    const cjk = (delta.match(CJK_RE) || []).length;
    req.cjkChars += cjk;
    req.otherChars += delta.length - cjk;
    req.downEstimate = Math.ceil(req.cjkChars + req.otherChars / 4);
    this.updateRate(meter, now);
  }

  /**
   * 轻事件链上行估算分两段补：
   *  - 首个 request 建立前：写 run 级 pending；
   *  - request 已建立但 provider 真值未到、还没产出时：持续刷新该 request 的估算。
   * 一旦有真实 input usage 或首字输出即停止（那时真值/输出估算已接管）。
   */
  refreshInputEstimateIfNeeded(
    sessionPath: string,
    estimate: number | null,
  ): void {
    if (estimate == null || estimate <= 0) return;
    const meter = this.meters.get(sessionPath);
    if (!meter || meter.state !== "running") return;
    const req = meter.requests.at(-1);
    if (!req) {
      meter.pendingInputEstimate = Math.max(
        meter.pendingInputEstimate,
        estimate,
      );
      return;
    }
    if (
      req.inputReal == null &&
      req.firstByteAt == null &&
      req.downEstimate === 0
    ) {
      req.inputEstimate = Math.max(req.inputEstimate, estimate);
    }
  }

  needsInputEstimate(sessionPath: string): boolean {
    const meter=this.meters.get(sessionPath),req=meter?.requests.at(-1);
    return !meter || meter.state==='running' && (!req || req.inputReal==null && req.firstByteAt==null && req.endedAt==null);
  }

  markTool(sessionPath: string, now = Date.now()): void {
    const meter = this.meters.get(sessionPath);
    const req = meter?.requests.at(-1);
    if (!req) return;
    req.phase = "tool";
    meter!.rate = 0;
    meter!.lastEmitAt = 0;
  }

  /** provider SSE 中途回传的 usage（partial）。 */
  applyLiveUsage(
    sessionPath: string,
    rawUsage: unknown,
    now = Date.now(),
  ): void {
    const usage = normalizeUsage(rawUsage);
    if (!usage) return;
    const meter = this.meters.get(sessionPath);
    const req = meter?.requests.at(-1);
    if (!req || req.endedAt != null) return;
    if (usage.input || usage.cacheRead || usage.cacheWrite) {
      req.inputReal = usage.input;
      req.cacheRead = usage.cacheRead;
      req.cacheWrite = usage.cacheWrite;
    }
    if (usage.output > 0) {
      req.sawRealDown = true;
      req.downReal = usage.output;
      req.estimateAtUsage = req.downEstimate;
      if (req.firstByteAt == null) req.firstByteAt = now;
      if (req.phase === "upload") req.phase = "writing";
      this.updateRate(meter!, now);
    }
  }

  /** 一条 assistant 消息结束：用 message.usage 做最终对账。 */
  endRequest(sessionPath: string, rawUsage: unknown, now = Date.now(), model?:string): void {
    const usage = normalizeUsage(rawUsage);
    const meter = this.meters.get(sessionPath);
    const req = meter?.requests.at(-1);
    if (!meter || !req || req.endedAt != null) return;
    if(model)req.model=model;
    const tail=req.statusFilter.flush();
    if(tail){const cjk=(tail.match(CJK_RE)||[]).length;req.cjkChars+=cjk;req.otherChars+=tail.length-cjk;req.downEstimate=Math.ceil(req.cjkChars+req.otherChars/4);}
    req.endedAt = now;
    if (usage) {
      if (typeof (rawUsage as any)?.input === "number" || usage.cacheRead || usage.cacheWrite) {
        req.inputReal = usage.input;
        req.cacheRead = usage.cacheRead;
        req.cacheWrite = usage.cacheWrite;
      }
      if (typeof (rawUsage as any)?.output === "number") {
        req.sawRealDown = true;
        req.downReal = usage.output;
        req.estimateAtUsage = req.downEstimate;
      }
    }
    req.phase = "processing";
    meter.rate = 0;
    meter.lastEmitAt = 0;
  }

  finishRun(
    sessionPath: string,
    outcome: "done" | "aborted",
    now = Date.now(),
  ): TokenMeterSnapshotShape | null {
    const meter = this.meters.get(sessionPath);
    if (!meter || meter.state !== "running") return this.snapshot(sessionPath);
    if (meter.idleFinishTimer) {
      clearTimeout(meter.idleFinishTimer);
      meter.idleFinishTimer = undefined;
    }
    meter.state = outcome;
    meter.endedAt = now;
    meter.lastEmitAt = 0;
    return this.snapshot(sessionPath);
  }

  /** 无 session_status 包裹的宿主路径：turn_end 后若没有下一回合则延迟收尾。 */
  scheduleIdleFinish(
    sessionPath: string,
    outcome: "done" | "aborted" = "done",
    onFinish?: (snapshot: TokenMeterSnapshotShape | null) => void,
  ): void {
    const meter = this.meters.get(sessionPath);
    if (!meter || meter.state !== "running" || meter.managedLifecycle) return;
    const last = meter.requests.at(-1);
    if (!last?.endedAt) return;
    if (meter.idleFinishTimer) clearTimeout(meter.idleFinishTimer);
    meter.idleFinishTimer = setTimeout(() => {
      const snapshot = this.finishRun(sessionPath, outcome, Date.now());
      onFinish?.(snapshot);
    }, IDLE_FINISH_DELAY_MS);
  }

  /** 节流读取：到点或 force=true 时返回快照，否则 null。 */
  sample(
    sessionPath: string,
    force = false,
    now = Date.now(),
  ): TokenMeterSnapshotShape | null {
    const meter = this.meters.get(sessionPath);
    if (!meter) return null;
    if (
      !force &&
      meter.state === "running" &&
      now - meter.lastEmitAt < EMIT_INTERVAL_MS
    )
      return null;
    meter.lastEmitAt = now;
    return this.snapshot(sessionPath, now);
  }

  snapshot(
    sessionPath: string,
    now = Date.now(),
  ): TokenMeterSnapshotShape | null {
    const meter = this.meters.get(sessionPath);
    if (!meter) return null;
    let upTokens = 0,
      downTokens = 0,
      cacheRead = 0,
      cacheWrite = 0;
    let upEstimated = false,
      downEstimated = false;
    for (const req of meter.requests) {
      const inputReal = req.inputReal ?? 0;
      const input =
        req.inputReal != null
          ? inputReal + req.cacheRead + req.cacheWrite
          : req.inputEstimate;
      upTokens += input;
      upEstimated ||= req.inputReal == null;
      // Provider-reported final output, including an explicit zero, corrects estimates.
      const hasNewEstimate = req.endedAt == null && req.downEstimate > req.estimateAtUsage;
      const down = req.sawRealDown && req.downReal != null
        ? req.downReal + (hasNewEstimate ? req.downEstimate - req.estimateAtUsage : 0)
        : req.downEstimate;
      downTokens += down;
      downEstimated ||= !(req.sawRealDown && req.downReal != null) || hasNewEstimate;
      cacheRead += req.cacheRead;
      cacheWrite += req.cacheWrite;
    }
    // 首个 request 建立前：run 级 pending 估算也要显示上行
    if (meter.requests.length === 0 && meter.pendingInputEstimate > 0) {
      upTokens = meter.pendingInputEstimate;
      upEstimated = true;
    }
    const current = meter.requests.at(-1);
    const lastModel =
      [...meter.requests].reverse().find((r) => r.model)?.model ?? meter.model;
    const endedAt = meter.endedAt;
    return {
      state: meter.state,
      phase:
        current && !endedAt
          ? current.phase
          : meter.state === "aborted"
            ? "upload"
            : meter.state === 'running' ? 'upload' : "writing",
      runId: meter.runId,
      model: lastModel,
      startedAt: meter.startedAt,
      endedAt,
      elapsedMs: (endedAt ?? now) - meter.startedAt,
      requests: meter.requests.filter(
        (r) =>
          r.endedAt ||
          r.firstByteAt ||
          r.inputReal != null ||
          r.inputEstimate > 0,
      ).length,
      up: { tokens: upTokens, estimated: upEstimated },
      down: { tokens: downTokens, estimated: downEstimated },
      rate: endedAt ? meter.rate : this.currentRate(meter, now),
      cacheRead,
      cacheWrite,
      sampledAt: now,
      firstOutputAt: meter.requests.find(req => req.firstByteAt != null)?.firstByteAt ?? null,
      excludedStatusNotices: meter.requests.reduce((n,req)=>n+req.statusFilter.excluded,0),
      byModel: this.modelBreakdown(meter),
    };
  }

  private modelBreakdown(meter:MeterState) {
    const groups=new Map<string,{model:string;requests:number;input:number;output:number;cacheRead:number;cacheWrite:number;inputEstimated:boolean;outputEstimated:boolean}>();
    for(const req of meter.requests){
      const model=req.model||'未记录模型',group=groups.get(model)||{model,requests:0,input:0,output:0,cacheRead:0,cacheWrite:0,inputEstimated:false,outputEstimated:false};
      group.requests++;group.input+=req.inputReal!=null?req.inputReal+req.cacheRead+req.cacheWrite:req.inputEstimate;
      const afterUsage=req.endedAt==null?Math.max(0,req.downEstimate-req.estimateAtUsage):0;
      group.output+=req.sawRealDown&&req.downReal!=null?req.downReal+afterUsage:req.downEstimate;
      group.inputEstimated ||= req.inputReal==null;group.outputEstimated ||= !req.sawRealDown||afterUsage>0;
      group.cacheRead+=req.cacheRead;group.cacheWrite+=req.cacheWrite;groups.set(model,group);
    }
    return [...groups.values()];
  }

  private ensure(sessionPath: string, now: number): MeterState {
    let meter = this.meters.get(sessionPath);
    if (!meter || meter.state !== 'running')
      (this.startRun(sessionPath, now),
        (meter = this.meters.get(sessionPath)!));
    return meter;
  }

  private updateRate(meter: MeterState, now: number): void {
    const down = this.currentDown(meter);
    const last = meter.lastRateSample;
    if (last && now > last.at) {
      const dt = now - last.at;
      if (dt >= 400) {
        const instant = ((down - last.down) / dt) * 1000;
        meter.rate = last.rate > 0 ? last.rate * 0.6 + instant * 0.4 : instant;
        if (meter.rate < 0 || !Number.isFinite(meter.rate)) meter.rate = 0;
        meter.lastRateSample = { at: now, down, rate: meter.rate };
      }
    } else {
      meter.lastRateSample = { at: now, down, rate: meter.rate };
    }
  }

  private currentRate(meter: MeterState, now: number): number {
    const req = meter.requests.at(-1);
    if (!req || req.firstByteAt == null || req.lastOutputAt == null || req.phase === 'tool' || req.phase === 'processing' || now - req.lastOutputAt > 1200) return 0;
    return Math.round(meter.rate || req.downEstimate / Math.max(.4, (now - req.firstByteAt) / 1000));
  }

  private currentDown(meter: MeterState): number {
    const req = meter.requests.at(-1);
    if (!req) return 0;
    return req.downEstimate;
  }
}
