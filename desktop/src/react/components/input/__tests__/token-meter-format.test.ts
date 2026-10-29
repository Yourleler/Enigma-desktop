import { describe, expect, it } from 'vitest';
import { formatTokenCount, formatElapsed } from '../token-meter-store';

describe('token meter formatters', () => {
  it('formats token counts compactly', () => {
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(999)).toBe('999');
    expect(formatTokenCount(1200)).toBe('1.2k');
    expect(formatTokenCount(12000)).toBe('12k');
    expect(formatTokenCount(1_500_000)).toBe('1.5M');
  });

  it('formats elapsed time', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(9400)).toBe('9s');
    expect(formatElapsed(65000)).toBe('1:05');
  });
});
