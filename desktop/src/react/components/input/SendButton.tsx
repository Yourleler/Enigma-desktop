import { useI18n } from '../../hooks/use-i18n';
import styles from './InputArea.module.css';

export function SendButton({ isStreaming, hasInput, disabled, onSend, onSteer, onStop }: {
  isStreaming: boolean;
  hasInput: boolean;
  disabled: boolean;
  onSend: () => void;
  onSteer: () => void;
  onStop: () => void;
}) {
  const { t } = useI18n();

  // 三态：发送 / 插话 / 停止
  const mode = isStreaming ? (hasInput ? 'steer' : 'stop') : 'send';

  return (
    <button
      className={`${styles['send-btn']}${mode === 'steer' ? ` ${styles['is-steer']}` : mode === 'stop' ? ` ${styles['is-streaming']}` : ''}`}
      disabled={disabled}
      aria-label={t(mode === 'send' ? 'chat.send' : mode === 'steer' ? 'chat.steer' : 'chat.stop')}
      data-tooltip={disabled ? '请先输入消息或添加附件，并确认模型可用' : mode === 'steer' ? '将补充要求交给正在运行的助手' : mode === 'stop' ? '停止生成，保留已完成的回复和修改' : '发送消息 · Enter 发送，Shift + Enter 换行'}
      onClick={mode === 'steer' ? onSteer : mode === 'stop' ? onStop : onSend}
    >
      {mode === 'send' && (
        <span className={styles['send-label']}>
          <svg className={styles['send-enter-icon']} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 19V5m-6 6 6-6 6 6" />
          </svg>
          <span>{t('chat.send')}</span>
        </span>
      )}
      {mode === 'steer' && (
        <span className={styles['send-label']}>
          <svg className={styles['send-enter-icon']} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span>{t('chat.steer')}</span>
        </span>
      )}
      {mode === 'stop' && (
        <span className={styles['send-label']}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
          <span>{t('chat.stop')}</span>
        </span>
      )}
    </button>
  );
}
