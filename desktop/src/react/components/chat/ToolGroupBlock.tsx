/**
 * ToolGroupBlock — 工具调用时间线：分组摘要行（运行 N 条命令 · 调用 N 次工具 ›）
 * + 每个工具一行（图标 · 动词 · 目标 · 附注 · ±行数 ›），行可展开看命令 / diff / 参数 / 错误。
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
import { buildToolRow, makeTr, toolGroupSummary, type DiffLine } from './tool-row';

import type { ToolCall } from '../../stores/chat-types';

interface Props {
  tools: ToolCall[];
  collapsed: boolean;
  agentName?: string;
  sessionPath?: string;
  messageId?: string;
}

export const ToolGroupBlock = memo(function ToolGroupBlock({ tools: rawTools, collapsed: initialCollapsed, agentName = 'Enigma', sessionPath, messageId }: Props) {
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
  const isSingle = tools.length === 1;

  const _t = window.t ?? ((p: string) => p);
  const summaryText = allDone
    ? toolGroupSummary(tools, makeTr())
    : _t('toolGroup.running', { n: tools.filter(t => !t.done).length });
  const rows = tools.map((tool, i) => (
    <ToolIndicator key={tool.id || `${tool.name}-${i}`} tool={tool} agentName={agentName} />
  ));

  return (
    <div className={`${styles.toolGroup}${isSingle ? ` ${styles.toolGroupSingle}` : ''}`} data-search-reveal-pending={reveal&&collapsed||undefined}>
      {!isSingle && (
        <button
          type="button"
          className={`${styles.toolGroupSummary}${allDone ? ` ${styles.toolGroupSummaryClickable}` : ''}`}
          disabled={!allDone}
          aria-expanded={!collapsed}
          data-open={!collapsed || undefined}
          onClick={allDone ? toggle : undefined}
        >
          <span className={styles.toolGroupTitle}>{summaryText}</span>
          {allDone ? <AppIcon name="chevronRight" size={13} className={styles.toolGroupArrow}/> : <ActivityWave/>}
        </button>
      )}
      {isSingle ? (
        <div className={styles.toolGroupContent}>{rows}</div>
      ) : (
        <Collapse open={!collapsed} instant={!!reveal}>
          <div className={styles.toolGroupContent}>{rows}</div>
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

function DiffView({ lines }: { lines: DiffLine[] }) {
  return (
    <pre className={`${styles.toolCode} ${styles.toolDiff}`}>
      {lines.map((line, i) => (
        <span key={i} className={line.type === 'add' ? styles.toolDiffAdd : line.type === 'del' ? styles.toolDiffDel : undefined}>
          <span className={styles.toolDiffSign} aria-hidden="true">{line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}</span>
          {line.text || ' '}{'\n'}
        </span>
      ))}
    </pre>
  );
}

const ToolIndicator = memo(function ToolIndicator({ tool, agentName }: { tool: ToolCall; agentName: string }) {
  const [linkMenu, setLinkMenu] = useState<LinkContextMenuState | null>(null);
  const [open, setOpen] = useState(false);

  // session 工具指向另一个会话，把它的名字显示出来并支持点过去。两个 selector 各返回
  // 字符串或 null，引用稳定，不会让每个工具行都因为 sessions 变动而重渲染。
  const isSessionTool = tool.name === 'session';
  const sessionTargetName = useStore(s => (isSessionTool ? sessionToolTargetName(s, tool.args) : null));
  const sessionTargetPath = useStore(s => (isSessionTool ? sessionToolTargetPath(s, tool.args) : null));

  const rawDetail = extractToolDetail(tool.name, tool.args);
  const detail = sessionTargetName ? { ...rawDetail, text: sessionTargetName } : rawDetail;
  const status = tool.status || (tool.done ? (tool.success ? 'succeeded' : 'failed') : 'running');
  // 失败的工具要说失败：此前这里只传 done/running，失败的读文件会显示"翻完了 ✗"
  const label = getToolLabel(tool.name, phaseForStatus(status), agentName, tool.args);
  const presentation=toolPresentation(tool.name,label);
  const row = buildToolRow(tool, detail.text, detail.title || detail.href);
  const tr = makeTr();
  const verb = row.verbKey ? tr(row.verbKey, {}, row.verbFallback || '') : presentation.label;
  const icon = row.verbKey ? row.icon : presentation.icon;
  const approvalUnavailable=tool.details?.errorCode==='TOOL_APPROVAL_UNAVAILABLE'||tool.error?.includes('execution context cannot ask the user');
  const reviewerTimedOut=(tool.details?.confirmation as { reasonCode?: string } | undefined)?.reasonCode==='approval_review_failed';
  const errorText = tool.error ? (approvalUnavailable
    ? (reviewerTimedOut
      ? '自动审核模型超时没有给出结论，按规则转人工确认；但这次运行不能弹出审批，所以操作没有执行。'
      : '这次操作需要你确认，但当时的运行方式不能弹出审批，所以操作没有执行。')
    : tool.error) : '';
  const expandable = !!(row.command || row.diff || row.params || errorText);

  // 如果 args 里有 tag 类型信息（如 agent 名）
  const tag = tool.args?.agentId as string | undefined;
  const linkHandlers = sessionTargetPath ? {
    onClick: (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); void switchSession(sessionTargetPath); },
  } : detail.href ? {
    onClick: (e: React.MouseEvent) => handleDetailClick(e, detail),
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!detail.href) return;
      setLinkMenu({ href: detail.href, context: { origin: 'session', label: detail.text }, position: { x: e.clientX, y: e.clientY } });
    },
  } : null;

  const head = (
    <>
      <AppIcon name={icon} size={14} className={styles.toolIcon}/>
      <span className={`${styles.toolDesc}${status==='running'?' enigma-work-shimmer':''}`}>{verb}</span>
      {row.target && (
        <span className={`${styles.toolDetail}${linkHandlers ? ` ${styles.toolDetailLink}` : ''}`} title={row.targetTitle || row.target} {...linkHandlers}>
          {row.target}
        </span>
      )}
      {(row.added || row.removed) ? (
        <span className={styles.toolLines}>
          {!!row.added && <span className={styles.toolLinesAdd}>+{row.added}</span>}
          {!!row.removed && <span className={styles.toolLinesDel}>-{row.removed}</span>}
        </span>
      ) : null}
      {row.meta && <span className={styles.toolMeta} title={row.meta}>{row.meta}</span>}
      {errorText && !open && <span className={styles.toolError} title={errorText}>{errorText}</span>}
      {tag && <span className={styles.toolTag}>{tag}</span>}
      {status === 'running' ? <ActivityWave/> : status !== 'succeeded' ? (
        <span className={`${styles.toolStatus} ${status === 'failed' ? styles.toolStatusFailed : styles.toolStatusUnknown}`}
          title={status === 'unknown' ? '历史中没有这次操作的最终回执。请核对实际结果后再重试。' : undefined}
          data-tooltip={status === 'unknown' ? '历史中没有这次操作的最终回执。请核对实际结果后再重试。' : undefined}>
          {status === 'failed' ? '失败' : '结果未记录'}
        </span>
      ) : null}
      {expandable && <AppIcon name="chevronRight" size={12} className={styles.toolChevron}/>}
    </>
  );

  return (
    <div className={styles.toolRow} data-tool={tool.name} data-done={String(tool.done)} data-status={status} data-open={open || undefined}>
      {expandable ? (
        <button type="button" className={`${styles.toolIndicator} ${styles.toolIndicatorClickable}`} aria-expanded={open} onClick={() => setOpen(v => !v)}>
          {head}
        </button>
      ) : (
        <div className={styles.toolIndicator}>{head}</div>
      )}
      {expandable && (
        <Collapse open={open}>
          <div className={styles.toolRowDetail}>
            {row.command && (
              <div className={styles.toolSection}>
                <div className={styles.toolSectionLabel}>{tr('toolRow.command', {}, '命令')}</div>
                <pre className={styles.toolCode}>{row.command}</pre>
              </div>
            )}
            {row.diff && (
              <div className={styles.toolSection}>
                <div className={styles.toolSectionLabel}>
                  <span className={styles.toolSectionPath} title={row.diffPath}>{row.diffPath || row.target}</span>
                  <span className={styles.toolLines}>
                    {!!row.added && <span className={styles.toolLinesAdd}>+{row.added}</span>}
                    {!!row.removed && <span className={styles.toolLinesDel}>-{row.removed}</span>}
                  </span>
                </div>
                <DiffView lines={row.diff}/>
              </div>
            )}
            {row.params && (
              <div className={styles.toolSection}>
                <div className={styles.toolSectionLabel}>{tr('toolRow.params', {}, '参数')}</div>
                <pre className={styles.toolCode}>{row.params}</pre>
              </div>
            )}
            {errorText && (
              <div className={styles.toolSection}>
                <div className={styles.toolSectionLabel}>{tr('toolRow.error', {}, '错误')}</div>
                <pre className={`${styles.toolCode} ${styles.toolCodeError}`}>{errorText}</pre>
              </div>
            )}
          </div>
        </Collapse>
      )}
      {linkMenu && (
        <LinkContextMenu
          state={linkMenu}
          onClose={() => setLinkMenu(null)}
        />
      )}
    </div>
  );
});
