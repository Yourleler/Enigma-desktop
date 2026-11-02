// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuotedSelectionCard } from '../../components/input/QuotedSelectionCard';
import { useStore } from '../../stores';

describe('QuotedSelectionCard', () => {
  beforeEach(() => {
    useStore.getState().clearQuotedSelections();
  });

  afterEach(() => {
    cleanup();
    useStore.getState().clearQuotedSelections();
  });

  it('shows a quote icon and exposes the full source through keyboard focus', async () => {
    useStore.getState().setQuotedSelections([{
      text: '2026年秋天的某段文字',
      sourceTitle: 'Assistant message',
      sourceKind: 'chat',
      charCount: 12,
    }]);

    render(<QuotedSelectionCard />);

    const chipText = screen.getByText('2026年秋天的某段文字');
    const chip = chipText.closest('[tabindex]');
    const icon = chip?.querySelector('svg[data-icon="quote"]');

    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('fill')).toBe('none');
    expect(icon?.getAttribute('stroke')).toBe('currentColor');
    expect(chip?.querySelector('svg[data-icon="text-cursor"]')).toBeNull();
    fireEvent.focus(chip!);
    expect((await screen.findByRole('tooltip')).textContent).toContain('2026年秋天的某段文字');
    expect(screen.getByRole('button',{name:'移除引用 1'})).toBeTruthy();
  });
});
