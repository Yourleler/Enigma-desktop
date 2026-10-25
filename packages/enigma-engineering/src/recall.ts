import { hash } from './storage.js';
export interface Difficulty { kind: 'repeated-error' | 'repeated-reading'; signature: string; query: string; count: number }
/** Per-run bounded control, independent of memory/provider/UI implementations. */
export class RecallGate {
  private failures = new Map<string, number>(); private reads = new Map<string, number>();
  private delivered = new Set<string>(); private rounds = 0; private lastAt = 0;
  reset(): void { this.failures.clear(); this.reads.clear(); this.delivered.clear(); this.rounds = 0; this.lastAt = 0; }
  observe(kind: Difficulty['kind'], reference: string, versionOrError: string, query: string): Difficulty | undefined {
    const map = kind === 'repeated-error' ? this.failures : this.reads;
    const signature = hash(`${kind}:${reference}:${versionOrError}`), count = (map.get(signature) ?? 0) + 1;
    map.set(signature, count); if (map.size > 200) map.delete(map.keys().next().value!);
    return count >= 3 && query.trim() ? { kind, signature, query: query.slice(0, 500), count } : undefined;
  }
  admit(signal: Difficulty, now = Date.now()): boolean {
    if (this.delivered.has(signal.signature) || this.rounds >= 2 || now - this.lastAt < 30000) return false;
    this.delivered.add(signal.signature); this.rounds++; this.lastAt = now; return true;
  }
}
