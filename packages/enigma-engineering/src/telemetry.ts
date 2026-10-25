import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export interface ActivityEvent {
  kind: 'start' | 'end' | 'update' | 'fact';
  stage: string;
  id?: string;
  parent?: string;
  repo?: string;
  durationMs?: number;
  status?: string;
  detail?: string;
  reference?: string;
  fingerprint?: string;
  pid?: number;
  count?: number;
}
export type ActivitySink = (event: ActivityEvent) => void;
const context = new AsyncLocalStorage<{ sink: ActivitySink; parent?: string }>();

export function emitActivity(event: ActivityEvent, sink = context.getStore()?.sink): void {
  const scope = context.getStore();
  try { sink?.({ ...event, id: event.id ?? (event.kind === 'update' ? scope?.parent : undefined) }); } catch { /* Observation cannot change execution semantics. */ }
}

export async function measured<T>(stage: string, fields: Pick<ActivityEvent, 'repo' | 'detail'>, action: () => Promise<T>, sink = context.getStore()?.sink): Promise<T> {
  if (!sink) return await action();
  const id = randomUUID(), parent = context.getStore()?.parent, started = performance.now();
  emitActivity({ kind: 'start', stage, id, parent, ...fields }, sink);
  return await context.run({ sink, parent: id }, async () => {
    try {
      const result = await action();
      emitActivity({ kind: 'end', stage, id, parent, ...fields, status: 'completed', durationMs: performance.now() - started }, sink);
      return result;
    } catch (error) {
      emitActivity({ kind: 'end', stage, id, parent, ...fields, status: 'failed', durationMs: performance.now() - started }, sink);
      throw error;
    }
  });
}

export const telemetryChannel = 'enigma:activity';
export const telemetryStateChannel = 'enigma:observer-state';
