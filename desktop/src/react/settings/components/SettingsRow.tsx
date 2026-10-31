import React, {useId} from 'react';
import {ControlLabelContext} from '../../ui/control-label';
import styles from './settings-components.module.css';

type HintVariant = 'default' | 'warn';
type Layout = 'inline' | 'stacked';

interface SettingsRowProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  label: React.ReactNode;
  hint?: React.ReactNode;
  hintVariant?: HintVariant;
  control: React.ReactNode;
  layout?: Layout;
  className?: string;
}

export function SettingsRow({
  label,
  hint,
  hintVariant = 'default',
  control,
  layout = 'inline',
  className,
  ...rootProps
}: SettingsRowProps) {
  const id=useId(),labelId=`${id}-label`,descriptionId=hint?`${id}-hint`:undefined;
  const rootClass = [
    styles.row,
    layout === 'inline' ? styles.rowInline : styles.rowStacked,
    className,
  ].filter(Boolean).join(' ');

  const hintClass = [
    styles.rowHint,
    hintVariant === 'warn' && styles.rowHintWarn,
  ].filter(Boolean).join(' ');

  return (
    <div {...rootProps} className={rootClass}>
      <div className={styles.rowText}>
        <div id={labelId} className={styles.rowLabel}>{label}</div>
        {hint && <div id={descriptionId} className={hintClass}>{hint}</div>}
      </div>
      <ControlLabelContext.Provider value={{labelId,descriptionId}}><div className={styles.rowControl}>{control}</div></ControlLabelContext.Provider>
    </div>
  );
}
