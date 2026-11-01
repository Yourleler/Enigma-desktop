/**
 * ThinkingBlock — 可折叠的思考过程区块
 */

import { memo, useState, useCallback, useLayoutEffect } from 'react';
import {useSearchReveal} from './use-search-reveal';
import { Collapse } from '@/ui';
import styles from './Chat.module.css';

interface Props {
  content: string;
  sealed: boolean;
  sessionPath?: string;
  messageId?: string;
}

export const ThinkingBlock = memo(function ThinkingBlock({ content, sealed, sessionPath, messageId }: Props) {
  const t = window.t ?? ((p: string) => p);
  const [open, setOpen] = useState(false);
  const reveal=useSearchReveal(sessionPath,[messageId||''],content);
  useLayoutEffect(()=>{if(reveal)setOpen(true);},[reveal]);
  const toggle = useCallback(() => setOpen(v => !v), []);

  if(!content.trim())return sealed?null:<span className={styles.thinkingBlockSummary}>{t('thinking.active')}<span className={styles.thinkingDots}/></span>;
  return (
    <details className={styles.thinkingBlock} open={open} data-search-reveal-pending={reveal&&!open||undefined} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className={styles.thinkingBlockSummary} onClick={(e) => { e.preventDefault(); toggle(); }}>
        <span className={`${styles.thinkingBlockArrow}${open ? ` ${styles.thinkingBlockArrowOpen}` : ''}`}>›</span>
        {' '}{sealed ? t('thinking.done') : (
          <>{t('thinking.active')}<span className={styles.thinkingDots} /></>
        )}
      </summary>
      <Collapse open={open && !!content} instant={!!reveal}>
        <div className={styles.thinkingBlockBody}>{content}</div>
      </Collapse>
    </details>
  );
});
