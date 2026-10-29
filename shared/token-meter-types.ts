/**
 * token-meter-types.ts — 实时 token 流速表前后端共享类型
 *
 * 实现位于 server/session-token-meter.ts；renderer 不能直接 import server 目录
 * （tsconfig / CSP 边界），因此在桌面侧保留一份同步的最小类型契约。
 */

export type TokenMeterPhase = "upload" | "thinking" | "writing" | "tool" | "processing";

export interface TokenSide {
  tokens: number;
  /** true=字符/上下文估算；provider 真值到达后翻转为 false。 */
  estimated: boolean;
}

export interface TokenMeterSnapshot {
  state: "running" | "done" | "aborted";
  phase: TokenMeterPhase;
  runId: number;
  model: string | null;
  startedAt: number;
  endedAt: number | null;
  elapsedMs: number;
  requests: number;
  up: TokenSide;
  down: TokenSide;
  /** 最近 1s 平滑后的下传速度，tokens/s。 */
  rate: number;
  cacheRead: number;
  cacheWrite: number;
  /** Server sample time, for detecting disconnected/stale telemetry. */
  sampledAt?: number;
  firstOutputAt?: number | null;
  excludedStatusNotices?: number;
  byModel?: Array<{model:string;requests:number;input:number;output:number;cacheRead:number;cacheWrite:number;inputEstimated:boolean;outputEstimated:boolean}>;
}
