import type { ChatMessage } from '../../stores/chat-types';
import { elapsedClock, timeMillis } from '../../../../../shared/session-timing';
import styles from './TurnTiming.module.css';

const formatTime = (at: number) => new Date(at).toLocaleString('zh-CN', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

/** A turn's transcript record, independent of the replaceable live run meter. */
export function TurnTiming({ message, input }: { message: ChatMessage; input?: ChatMessage | null }) {
  // A missing hidden input must never borrow the preceding visible user's time.
  const matchesInput = input && (!message.turnInputEntryId || message.turnInputEntryId === input.sourceEntryId);
  const startedAt = timeMillis(message.turnStartedAt) ?? (matchesInput ? timeMillis(input.timestamp) : null);
  const endedAt = timeMillis(message.timestamp);
  const elapsed = startedAt && endedAt && endedAt >= startedAt ? endedAt - startedAt : null;
  return (
    <div className={styles.record} data-testid="turn-timing" aria-label="本轮时间"
      title="从本轮输入到最后一条回复的时间跨度，包含等待和工具执行。每轮独立保留；停止或出错也不表示任务已完成。">
      <span>本轮历时 <strong>{elapsed === null ? '未记录' : elapsedClock(elapsed)}</strong></span>
      <span>开始 <time dateTime={startedAt ? new Date(startedAt).toISOString() : undefined}>{startedAt ? formatTime(startedAt) : '未记录'}</time></span>
      <span>最后回复 <time dateTime={endedAt ? new Date(endedAt).toISOString() : undefined}>{endedAt ? formatTime(endedAt) : '未记录'}</time></span>
    </div>
  );
}
