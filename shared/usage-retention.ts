export const DEFAULT_USAGE_RETENTION = 5_000;
export const MIN_USAGE_RETENTION = 100;
export const MAX_USAGE_RETENTION = 100_000;
export function isUsageRetention(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
    && value >= MIN_USAGE_RETENTION && value <= MAX_USAGE_RETENTION;
}
