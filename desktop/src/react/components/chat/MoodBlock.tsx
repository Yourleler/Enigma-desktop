/**
 * MoodBlock — 可折叠的 MOOD/PULSE/REFLECT 区块
 */

import { memo, useState, useCallback, useId } from 'react';
import { Collapse } from '@/ui';
import { moodLabel } from '../../utils/message-parser';
import styles from './Chat.module.css';

interface Props {
  yuan: string;
  text: string;
}

export const MoodBlock = memo(function MoodBlock({ yuan, text }: Props) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen(v => !v), []);
  const id = useId();

  return (
    <div className={styles.moodWrapper} data-yuan={yuan}>
      <button type="button" className={styles.moodSummary} aria-expanded={open} aria-controls={id} data-tooltip={`${open?'收起':'展开'}${yuan==='enigma'?'工作说明':'助手说明'}`} onClick={toggle}>
        <span className={`${styles.moodArrow}${open ? ` ${styles.moodArrowOpen}` : ''}`}>›</span>
        {' '}{moodLabel(yuan)}
      </button>
      <Collapse open={open}>
        <div id={id} className={styles.moodBlock}>{text}</div>
      </Collapse>
    </div>
  );
});
