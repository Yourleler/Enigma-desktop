export interface RuntimeClock {
  kind: 'conversation' | 'goal' | 'conductor';
  startedAt: number | null;
  elapsedMs: number | null;
  state: 'running' | 'paused' | 'done' | 'stopped' | 'unknown';
}
export interface SessionTiming {
  sessionPath: string;
  createdAt: number | null;
  sampledAt: number;
  run: RuntimeClock | null;
  goal: RuntimeClock | null;
  conductor: RuntimeClock | null;
}
export function timeMillis(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}
export function elapsedClock(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '待核对';
  const total = Math.floor(Math.max(0, ms) / 1000), seconds = total % 60, minutes = Math.floor(total / 60) % 60, hours = Math.floor(total / 3600);
  return `${hours ? `${hours}:` : ''}${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
}
