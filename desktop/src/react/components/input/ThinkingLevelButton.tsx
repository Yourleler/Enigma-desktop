import { useCallback, useMemo } from 'react';
import { hanaFetch } from '../../hooks/use-hana-fetch';
import { useI18n } from '../../hooks/use-i18n';
import { useStore } from '../../stores';
import { DEFAULT_THINKING_LEVELS, normalizeThinkingLevel, normalizeThinkingLevels, type ThinkingLevel } from '../../stores/model-slice';
import { SelectWidget, type SelectOption } from '@/ui';
import styles from './InputArea.module.css';

const THINKING_LEVEL_COPY: Record<ThinkingLevel, { label: string; description: string }> = {
  off: { label: 'Off', description: 'No reasoning' },
  auto: { label: 'Auto', description: 'Balanced reasoning' },
  low: { label: 'Light', description: 'Light reasoning' },
  medium: { label: 'Medium', description: 'Balanced reasoning' },
  high: { label: 'Deep', description: 'Deep reasoning' },
  xhigh: { label: 'Max', description: 'Maximum reasoning' },
  max: { label: 'Max', description: 'Maximum reasoning' },
};

export function ThinkingLevelButton({ level, onChange, availableLevels }: {
  level: ThinkingLevel;
  onChange: (level: ThinkingLevel) => void;
  availableLevels?: readonly ThinkingLevel[];
}) {
  const { t } = useI18n();
  const currentSessionPath = useStore(s => s.currentSessionPath);
  const pendingNewSession = useStore(s => s.pendingNewSession);
  const activeLevel = normalizeThinkingLevel(level);

  const normalizedAvailableLevels = useMemo(
    () => normalizeThinkingLevels(availableLevels) ?? DEFAULT_THINKING_LEVELS,
    [availableLevels],
  );

  const selectLevel = useCallback(async (next: ThinkingLevel) => {
    try {
      const useSessionThinking = !!currentSessionPath && !pendingNewSession;
      if (!useSessionThinking) {
        const res = await hanaFetch('/api/session-thinking-level', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ level: next }),
        });
        const data = await res.json();
        if (!res.ok || data?.ok === false) {
          throw new Error(data?.error || 'failed to save thinking level');
        }
        const normalized = normalizeThinkingLevel((data?.thinkingLevel || next) as ThinkingLevel);
        useStore.getState().setPendingNewSessionThinkingLevel(normalized);
        onChange(normalized);
        return;
      }
      const res = await hanaFetch('/api/session-thinking-level', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionPath: currentSessionPath, level: next }),
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || 'failed to save thinking level');
      }
      onChange(normalizeThinkingLevel((data?.thinkingLevel || next) as ThinkingLevel));
    } catch (err) {
      console.error('[thinking-level] save failed:', err);
    }
  }, [currentSessionPath, onChange, pendingNewSession]);

  const tLevel = (key: string, fallback: string) => {
    const v = t(key);
    return v !== key ? v : fallback;
  };

  const isOff = activeLevel === 'off';

  const options: SelectOption[] = normalizedAvailableLevels.map(lv => {
    const copy = THINKING_LEVEL_COPY[lv];
    return {
      value: lv,
      label: tLevel(`input.thinkingLevel.${lv}`, copy.label),
      description: tLevel(`input.thinkingDesc.${lv}`, copy.description),
    };
  });

  return (
    <SelectWidget
      ariaLabel={`推理强度：${tLevel(`input.thinkingLevel.${activeLevel}`, THINKING_LEVEL_COPY[activeLevel].label)}`}
      className={styles['thinking-selector']}
      options={options}
      value={activeLevel}
      onChange={(v) => selectLevel(v as ThinkingLevel)}
      align="end"
      placement="top"
      offset={4}
      popupMinWidth={180}
      triggerBare
      triggerClassName={`${styles['thinking-pill']}${isOff ? '' : ` ${styles.active}`}`}
      renderTrigger={() => (
        <span data-tooltip={`推理强度：${tLevel(`input.thinkingLevel.${activeLevel}`, THINKING_LEVEL_COPY[activeLevel].label)}`}>{tLevel(`input.thinkingLevel.${activeLevel}`, THINKING_LEVEL_COPY[activeLevel].label)}</span>
      )}
    />
  );
}
