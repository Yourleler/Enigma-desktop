/**
 * token-meter-store.ts — 前端实时 token 流速状态
 *
 * 服务端在模型执行期间通过 WS `token_meter` 推送快照（~7fps）：
 * 上传（请求输入，含缓存命中）与下传（流式输出）分开计数，
 * 估算值在 provider usage 真值到达后自动翻转。
 *
 * 状态按会话隔离；当前会话由 TokenMeterPill 订阅。
 */
import { create } from "zustand";
import type {
  TokenMeterPhase,
  TokenMeterSnapshot,
} from "../../../../../shared/token-meter-types";

type Meter = TokenMeterSnapshot;

interface TokenMeterStore {
  metersBySession: Record<string, Meter>;
  applyTokenMeter: (sessionPath: string, meter: Meter, connection?: string | null) => void;
  clearTokenMeter: (sessionPath: string) => void;
}

export const useTokenMeterStore = create<TokenMeterStore>(() => ({
  metersBySession: {},
  applyTokenMeter: (sessionPath, meter, connection) => {
    if (!['running','done','aborted'].includes(meter?.state) || !['upload','thinking','writing','tool','processing'].includes(meter?.phase) || !Number.isFinite(meter.startedAt) || !Number.isFinite(meter.up?.tokens) || !Number.isFinite(meter.down?.tokens)) return;
    const key = tokenMeterKey(connection, sessionPath);
    useTokenMeterStore.setState((state) => {
      const previous = state.metersBySession[key];
      if (previous && (previous.startedAt > meter.startedAt || previous.runId === meter.runId && (previous.sampledAt || 0) > (meter.sampledAt || 0))) return state;
      const meters = {...state.metersBySession, [key]: meter};
      const finished = Object.entries(meters).filter(([,value]) => value.state !== 'running').sort((a,b) => a[1].startedAt-b[1].startedAt);
      for (const [id] of finished.slice(0, Math.max(0, Object.keys(meters).length-128))) delete meters[id];
      return { metersBySession: meters };
    });
  },
  clearTokenMeter: (sessionPath) => {
    useTokenMeterStore.setState((state) => {
      if (!state.metersBySession[sessionPath]) return state;
      const next = { ...state.metersBySession };
      delete next[sessionPath];
      return { metersBySession: next };
    });
  },
}));

export function tokenMeterKey(connection: string | null | undefined, sessionPath: string) { return connection ? `${connection}::${sessionPath}` : sessionPath; }

export function selectTokenMeter(sessionPath: string | null): Meter | null {
  if (!sessionPath) return null;
  return useTokenMeterStore.getState().metersBySession[sessionPath] ?? null;
}

export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n < 1000) return String(n);
  if (n < 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  if (n < 1_000_000) return Math.round(n / 1000) + "k";
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

export const METER_PHASE_LABEL: Record<TokenMeterPhase, string> = {
  upload: "等待模型响应",
  thinking: "思考中",
  writing: "生成中",
  tool: "执行工具",
  processing: "后续处理中",
};
