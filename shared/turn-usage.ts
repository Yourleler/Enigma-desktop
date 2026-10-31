import type {UsageGroup, UsageTotals} from './usage-summary.ts';
export interface TurnUsage {
  startedAt: number | null;
  endedAt: number | null;
  totals: UsageTotals;
  models: UsageGroup[];
}
