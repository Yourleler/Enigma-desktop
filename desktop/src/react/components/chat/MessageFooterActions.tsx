import { memo } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import styles from './Chat.module.css';

export interface MessageFooterAction {
  id: string;
  title: string;
  icon: ReactNode;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  active?: boolean;
  pressed?: boolean;
}

interface Props {
  timeText?: string | null;
  timestamp?: number;
  timeKind?: 'sent' | 'received' | 'receiving';
  leadingActions?: MessageFooterAction[];
  actions: MessageFooterAction[];
  align?: 'left' | 'right';
  visible?: boolean;
  timePersistent?: boolean;
  testId?: string;
}

export const MessageFooterActions = memo(function MessageFooterActions({
  timeText,
  timestamp,
  timeKind,
  leadingActions = [],
  actions,
  align = 'right',
  visible = false,
  timePersistent = false,
  testId,
}: Props) {
  if (!timeText && leadingActions.length === 0 && actions.length === 0) return null;

  return (
    <div
      className={[
        styles.messageFooterActions,
        align === 'left' ? styles.messageFooterActionsLeft : styles.messageFooterActionsRight,
        visible ? styles.messageFooterActionsVisible : '',
        timePersistent && timeText ? styles.messageFooterActionsTimePersistent : '',
      ].filter(Boolean).join(' ')}
      data-message-actions=""
      data-testid={testId}
    >
      {timeText && <time className={styles.messageFooterTime} dateTime={timestamp ? new Date(timestamp).toISOString() : undefined} title={timestamp ? new Date(timestamp).toLocaleString()+'（本地时区，消息记录时间）' : undefined}>
        <span className={styles.messageTimeShort}>{timeText}</span>
        <span className={styles.messageTimeFull}>{timeKind==='sent'?'发送于':timeKind==='receiving'?'开始接收':'收到于'} {timestamp ? new Date(timestamp).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}) : timeText}</span>
      </time>}
      {leadingActions.map(action => (
        <FooterActionButton key={action.id} action={action} />
      ))}
      {actions.map(action => (
        <FooterActionButton key={action.id} action={action} />
      ))}
    </div>
  );
});

function FooterActionButton({ action }: { action: MessageFooterAction }) {
  return (
    <button
      className={`${styles.messageFooterBtn}${action.active ? ` ${styles.messageFooterBtnActive}` : ''}`}
      onClick={action.onClick}
      title={action.title}
      aria-label={action.title}
      aria-pressed={typeof action.pressed === 'boolean' ? action.pressed : undefined}
      disabled={action.disabled}
    >
      {action.icon}
    </button>
  );
}

export function formatMessageTime(timestamp?: number): string | null {
  if (!timestamp || !Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
