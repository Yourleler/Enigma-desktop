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
      {message.turnUsage&&<details className={styles.usage}><summary aria-label="查看此轮用量">{message.turnUsage.totals.reportedRequests?`↑ ${message.turnUsage.totals.input.toLocaleString()} · ↓ ${message.turnUsage.totals.output.toLocaleString()} token`:'用量未报告'}</summary>
        <div>{message.turnUsage.models.map(row=><p key={row.key}>{row.label} · {row.requests} 次 · 输入 {row.input.toLocaleString()} · 输出 {row.output.toLocaleString()}</p>)}
        <p>消息记录用量，包含工具调用期间的模型请求；分支沿用不重复计费。</p>
        {!!message.turnUsage.totals.missingRequests&&<p>{message.turnUsage.totals.missingRequests} 次未保存用量，合计仅包括已记录部分。</p>}</div>
      </details>}
    </div>
  );
}
