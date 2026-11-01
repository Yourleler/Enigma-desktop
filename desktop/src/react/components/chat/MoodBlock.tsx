/**
 * MoodBlock — 可折叠的 MOOD/PULSE/REFLECT 区块
 */

import { memo, useState, useCallback, useId, useLayoutEffect } from 'react';
import {useSearchReveal} from './use-search-reveal';
import { Collapse } from '@/ui';
import { moodLabel } from '../../utils/message-parser';
import styles from './Chat.module.css';

interface Props {
  yuan: string;
  text: string;
  sessionPath?: string;
  messageId?: string;
}

export const MoodBlock = memo(function MoodBlock({ yuan, text, sessionPath, messageId }: Props) {
  const [open, setOpen] = useState(false);
  const reveal=useSearchReveal(sessionPath,[messageId||''],text);
  useLayoutEffect(()=>{if(reveal)setOpen(true);},[reveal]);
  const toggle = useCallback(() => setOpen(v => !v), []);
  const id = useId();

  return (
    <div className={styles.moodWrapper} data-yuan={yuan} data-search-reveal-pending={reveal&&!open||undefined}>
      <button type="button" className={styles.moodSummary} aria-expanded={open} aria-controls={id} data-tooltip={`${open?'收起':'展开'}${yuan==='enigma'?'工作说明':'助手说明'}`} onClick={toggle}>
        <span className={`${styles.moodArrow}${open ? ` ${styles.moodArrowOpen}` : ''}`}>›</span>
        {' '}{moodLabel(yuan)}
      </button>
      <Collapse open={open} instant={!!reveal}>
        <div id={id} className={styles.moodBlock}>{text}</div>
      </Collapse>
    </div>
  );
});
