/**
 * ToolGroupBlock — 工具调用组，含展开/折叠
 */

import { memo, useState, useCallback, useRef, useLayoutEffect } from 'react';
import {useSearchReveal} from './use-search-reveal';
import { Collapse } from '@/ui';
import {AppIcon} from '../../ui/app-icons';
import {toolPresentation} from '../../utils/tool-presentation';
import {ActivityWave} from './RunActivity';
import styles from './Chat.module.css';
import { extractToolDetail } from '../../utils/message-parser';
import type { ToolDetail } from '../../utils/message-parser';
import { openInternalLink } from '../../utils/link-open';
import { isToolCallHiddenFromProcessUi } from '../../utils/tool-call-visibility';
import { getToolLabel, phaseForStatus, sessionToolTargetName, sessionToolTargetPath } from '../../utils/tool-label';
import { useStore } from '../../stores';
import { switchSession } from '../../stores/session-actions';
import { LinkContextMenu, type LinkContextMenuState } from '../shared/LinkContextMenu';

import type { ToolCall } from '../../stores/chat-types';

interface Props {
  tools: ToolCall[];
  collapsed: boolean;
  agentName?: string;
  sessionPath?: string;
  messageId?: string;
}

export const ToolGroupBlock = memo(function ToolGroupBlock({ tools: rawTools, collapsed: initialCollapsed, agentName = 'Hanako', sessionPath, messageId }: Props) {
  // 独立卡片或产物块承接状态的工具，不在工具组里重复显示。
  const tools = rawTools.filter(t => !isToolCallHiddenFromProcessUi(t));
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const previousCollapsed=useRef(initialCollapsed);
  const reveal=useSearchReveal(sessionPath,[messageId||'']);
  useLayoutEffect(() => {
    if(reveal)setCollapsed(false);
    else if(previousCollapsed.current!==initialCollapsed)setCollapsed(initialCollapsed);
    previousCollapsed.current=initialCollapsed;
  }, [initialCollapsed,reveal]);
  const toggle = useCallback(() => setCollapsed(v => !v), []);

  if (tools.length === 0) return null;

  const allDone = tools.every(t => t.status ? t.status !== 'running' : t.done);
  const failCount = tools.filter(t => t.status === 'failed' || (!t.status && t.done && !t.success)).length;
  const isSingle = tools.length === 1;

  // 摘要标题
  const _t = window.t ?? ((p: string) => p);
  let summaryText = '';
  if (allDone) {
    if (failCount > 0) {
      summaryText = _t('toolGroup.countWithFail', { total: tools.length, fail: failCount });
    } else {
      summaryText = _t('toolGroup.count', { n: tools.length });
    }
  } else {
    const running = tools.filter(t => !t.done).length;
    summaryText = _t('toolGroup.running', { n: running });
  }

  return (
    <div className={`${styles.toolGroup}${isSingle ? ` ${styles.toolGroupSingle}` : ''}`} data-search-reveal-pending={reveal&&collapsed||undefined}>
      {!isSingle && (
        <button
          type="button"
          className={`${styles.toolGroupSummary}${allDone ? ` ${styles.toolGroupSummaryClickable}` : ''}`}
          disabled={!allDone}
          aria-expanded={!collapsed}
          onClick={allDone ? toggle : undefined}
        >
          <span className={styles.toolGroupTitle}>{summaryText}</span>
          {allDone && <span className={styles.toolGroupArrow}>{collapsed ? '›' : '‹'}</span>}
          {!allDone && (
            <ActivityWave/>
          )}
        </button>
      )}
      {isSingle ? (
        <div className={styles.toolGroupContent}>
          {tools.map((tool, i) => (
            <ToolIndicator key={tool.id || `${tool.name}-${i}`} tool={tool} agentName={agentName} />
          ))}
        </div>
      ) : (
        <Collapse open={!collapsed} instant={!!reveal}>
          <div className={styles.toolGroupContent}>
            {tools.map((tool, i) => (
              <ToolIndicator key={tool.id || `${tool.name}-${i}`} tool={tool} agentName={agentName} />
            ))}
          </div>
        </Collapse>
      )}
    </div>
  );
});

// ── ToolIndicator ──

function handleDetailClick(e: React.MouseEvent, detail: ToolDetail) {
  e.preventDefault();
  e.stopPropagation();
  if (!detail.href) return;
  void openInternalLink(detail.href, { origin: 'session' });
}

const ToolIndicator = memo(function ToolIndicator({ tool, agentName }: { tool: ToolCall; agentName: string }) {
  const [linkMenu, setLinkMenu] = useState<LinkContextMenuState | null>(null);

  // session 工具指向另一个会话，把它的名字显示出来并支持点过去。两个 selector 各返回
  // 字符串或 null，引用稳定，不会让每个工具行都因为 sessions 变动而重渲染。
  const isSessionTool = tool.name === 'session';
  const sessionTargetName = useStore(s => (isSessionTool ? sessionToolTargetName(s, tool.args) : null));
  const sessionTargetPath = useStore(s => (isSessionTool ? sessionToolTargetPath(s, tool.args) : null));

  const rawDetail = extractToolDetail(tool.name, tool.args);
  const detail = sessionTargetName ? { ...rawDetail, text: sessionTargetName } : rawDetail;
  const detailTitle = detail.title || detail.href;
  const status = tool.status || (tool.done ? (tool.success ? 'succeeded' : 'failed') : 'running');
  // 失败的工具要说失败：此前这里只传 done/running，失败的读文件会显示"翻完了 ✗"
  const label = getToolLabel(tool.name, phaseForStatus(status), agentName, tool.args);

  const presentation=toolPresentation(tool.name,label);
  const approvalUnavailable=tool.details?.errorCode==='TOOL_APPROVAL_UNAVAILABLE'||tool.error?.includes('execution context cannot ask the user');

  // 如果 args 里有 tag 类型信息（如 agent 名）
  const tag = tool.args?.agentId as string | undefined;

  return (
    <>
      <div className={styles.toolIndicator} data-tool={tool.name} data-done={String(tool.done)} data-status={status}>
        <AppIcon name={presentation.icon} size={15}/><span className={`${styles.toolDesc}${status==='running'?' enigma-work-shimmer':''}`}>{presentation.label}</span>
        {detail.text && (
          sessionTargetPath ? (
            <span
              className={`${styles.toolDetail} ${styles.toolDetailLink}`}
              title={detailTitle || detail.text}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void switchSession(sessionTargetPath);
              }}
            >
              {detail.text}
            </span>
          ) : detail.href ? (
            <span
              className={`${styles.toolDetail} ${styles.toolDetailLink}`}
              title={detailTitle}
              onClick={(e) => handleDetailClick(e, detail)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!detail.href) return;
                setLinkMenu({
                  href: detail.href,
                  context: { origin: 'session', label: detail.text },
                  position: { x: e.clientX, y: e.clientY },
                });
              }}
            >
              {detail.text}
            </span>
          ) : (
            <span className={styles.toolDetail} title={detailTitle}>{detail.text}</span>
          )
        )}
        {tool.error && (
          <span className={styles.toolDetail} title={tool.error}>{approvalUnavailable?'这次操作需要确认，原执行模式未能弹出审批。操作没有执行。':tool.error}</span>
        )}
        {tag && <span className={styles.toolTag}>{tag}</span>}
        {status !== 'running' ? (
          <span className={`${styles.toolStatus} ${status === 'succeeded' ? styles.toolStatusDone : status === 'failed' ? styles.toolStatusFailed : styles.toolStatusUnknown}`}
            title={status === 'unknown' ? '历史中没有这次操作的最终回执。请核对实际结果后再重试。' : undefined}
            data-tooltip={status === 'unknown' ? '历史中没有这次操作的最终回执。请核对实际结果后再重试。' : undefined}>
            {status === 'succeeded' ? <AppIcon name="check" size={14}/> : status === 'failed' ? '失败' : '结果未记录'}
          </span>
        ) : (
          <ActivityWave/>
        )}
      </div>
      {linkMenu && (
        <LinkContextMenu
          state={linkMenu}
          onClose={() => setLinkMenu(null)}
        />
      )}
    </>
  );
});
