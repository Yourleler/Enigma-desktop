/**
 * tool-row — 把一次工具调用整理成「动词 + 目标 + 附注 + 详情」，供工具时间线渲染。
 * 只读 ToolCall 已有字段（args / error / status），不依赖额外协议。
 */
import type { ToolCall } from '../../stores/chat-types';
import type { AppIconName } from '../../ui/app-icons';

export type ToolKind = 'command' | 'read' | 'edit' | 'search' | 'call';

export interface DiffLine { type: 'add' | 'del' | 'ctx'; text: string }

export interface ToolRowModel {
  kind: ToolKind;
  icon: AppIconName;
  /** 动词 i18n key 与中文兜底；为空表示沿用工具自身文案 */
  verbKey?: string;
  verbFallback?: string;
  /** 目标：命令首行 / 文件名 / MCP 工具名 */
  target: string;
  targetTitle?: string;
  /** 次要附注：所在目录、MCP server、行号范围等 */
  meta?: string;
  /** 编辑类增删行 */
  added?: number;
  removed?: number;
  /** 详情 */
  command?: string;
  diff?: DiffLine[];
  diffPath?: string;
  params?: string;
}

const COMMAND_TOOLS = new Set(['bash', 'exec_command', 'terminal']);
const READ_TOOLS = new Set(['read', 'ls', 'web_fetch']);
const EDIT_TOOLS = new Set(['edit', 'edit-diff', 'write']);
const SEARCH_TOOLS = new Set(['grep', 'glob', 'find', 'web_search', 'search_memory']);

export function toolKind(name: string): ToolKind {
  if (COMMAND_TOOLS.has(name)) return 'command';
  if (READ_TOOLS.has(name)) return 'read';
  if (EDIT_TOOLS.has(name)) return 'edit';
  if (SEARCH_TOOLS.has(name)) return 'search';
  return 'call';
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const baseName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
const dirName = (p: string) => {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/);
  if (parts.length < 2) return '';
  const dir = parts.slice(0, -1).join('/');
  return dir.length > 40 ? '…' + dir.slice(-39) : dir;
};

function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** 行级 LCS diff；过大时退化成整段删除 + 整段新增。 */
export function lineDiff(oldText: string, newText: string): DiffLine[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  if (a.length * b.length > 250_000) {
    return [...a.map(text => ({ type: 'del' as const, text })), ...b.map(text => ({ type: 'add' as const, text }))];
  }
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: 'ctx', text: a[i] }); i += 1; j += 1; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: a[i] }); i += 1; }
    else { out.push({ type: 'add', text: b[j] }); j += 1; }
  }
  while (i < n) out.push({ type: 'del', text: a[i++] });
  while (j < m) out.push({ type: 'add', text: b[j++] });
  return out;
}

function editPairs(args: Record<string, unknown>): Array<{ oldText: string; newText: string }> {
  if (Array.isArray(args.edits)) {
    return args.edits
      .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
      .map(e => ({ oldText: str(e.oldText ?? e.old_string), newText: str(e.newText ?? e.new_string) }));
  }
  const oldText = str(args.oldText ?? args.old_string);
  const newText = str(args.newText ?? args.new_string);
  return oldText || newText ? [{ oldText, newText }] : [];
}

function stringify(value: unknown): string {
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

export function buildToolRow(tool: ToolCall, fallbackTarget: string, fallbackTitle?: string): ToolRowModel {
  const args = (tool.args || {}) as Record<string, unknown>;
  const kind = toolKind(tool.name);

  if (kind === 'command') {
    const command = str(args.command) || str(args.cmd);
    const first = command.split('\n').find(l => l.trim()) || '';
    return {
      kind, icon: 'command', verbKey: 'toolRow.run', verbFallback: '运行',
      target: first.trim() || fallbackTarget, targetTitle: command || fallbackTitle,
      ...(command ? { command } : {}),
    };
  }

  if (kind === 'edit') {
    const path = str(args.file_path) || str(args.path);
    const resultDiff = str(tool.details?.diff);
    let diff: DiffLine[];
    if (resultDiff) {
      // edit 工具回执里的 diff：每行 `+12 text` / `-12 text` / ` 12 text`，省略段为 `   ...`
      diff = resultDiff.split('\n').map((line): DiffLine => {
        const m = /^([+\- ])\s*\d*\s?(.*)$/.exec(line);
        if (!m) return { type: 'ctx', text: line };
        return { type: m[1] === '+' ? 'add' : m[1] === '-' ? 'del' : 'ctx', text: m[2] === '...' ? '⋯' : m[2] };
      });
    } else if (tool.name === 'write') {
      diff = splitLines(str(args.content)).map(text => ({ type: 'add' as const, text }));
    } else {
      diff = [];
      for (const pair of editPairs(args)) {
        if (diff.length) diff.push({ type: 'ctx', text: '⋯' });
        diff.push(...lineDiff(pair.oldText, pair.newText));
      }
    }
    const added = diff.filter(l => l.type === 'add').length;
    const removed = diff.filter(l => l.type === 'del').length;
    return {
      kind, icon: 'pencil',
      verbKey: tool.name === 'write' ? 'toolRow.write' : 'toolRow.edit',
      verbFallback: tool.name === 'write' ? '写入' : '编辑',
      target: path ? baseName(path) : fallbackTarget, targetTitle: path || fallbackTitle,
      meta: path ? dirName(path) : undefined,
      ...(diff.length ? { diff, diffPath: path, added, removed } : {}),
    };
  }

  if (kind === 'read') {
    if (tool.name === 'web_fetch') {
      return { kind, icon: 'link', verbKey: 'toolRow.fetch', verbFallback: '访问', target: fallbackTarget, targetTitle: str(args.url) || fallbackTitle };
    }
    const path = str(args.file_path) || str(args.path);
    const offset = Number(args.offset), limit = Number(args.limit);
    const range = Number.isFinite(offset) && offset > 0
      ? `L${offset}${Number.isFinite(limit) && limit > 0 ? `–${offset + limit - 1}` : '+'}`
      : '';
    return {
      kind, icon: tool.name === 'ls' ? 'project' : 'read',
      verbKey: tool.name === 'ls' ? 'toolRow.list' : 'toolRow.read',
      verbFallback: tool.name === 'ls' ? '查看' : '读取',
      target: path ? baseName(path) : fallbackTarget, targetTitle: path || fallbackTitle,
      meta: [range, path ? dirName(path) : ''].filter(Boolean).join(' · ') || undefined,
    };
  }

  if (kind === 'search') {
    const query = str(args.pattern) || str(args.query);
    const where = str(args.path);
    return {
      kind, icon: 'search', verbKey: 'toolRow.search', verbFallback: '搜索',
      target: query || fallbackTarget, targetTitle: query || fallbackTitle,
      meta: where ? baseName(where) : undefined,
    };
  }

  // MCP / 插件 / 其它内置工具
  if (tool.name === 'mcp_call') {
    const inner = args.arguments;
    return {
      kind, icon: 'tool', verbKey: 'toolRow.call', verbFallback: '调用',
      target: str(args.tool) || fallbackTarget || 'mcp_call', meta: str(args.server) || undefined,
      ...(inner && typeof inner === 'object' && Object.keys(inner).length ? { params: stringify(inner) } : {}),
    };
  }
  const isMcp = tool.name.startsWith('mcp_');
  const keys = Object.keys(args);
  return {
    kind, icon: isMcp ? 'tool' : 'activity',
    ...(isMcp ? { verbKey: 'toolRow.call', verbFallback: '调用' } : {}),
    target: isMcp ? tool.name.replace(/^mcp_/, '') : fallbackTarget,
    meta: isMcp ? fallbackTarget || undefined : undefined,
    targetTitle: fallbackTitle,
    ...(keys.length > 1 || (isMcp && keys.length) ? { params: stringify(args) } : {}),
  };
}

export interface ToolGroupCounts { command: number; read: number; edit: number; search: number; call: number; failed: number }

export function countToolKinds(tools: ToolCall[]): ToolGroupCounts {
  const counts: ToolGroupCounts = { command: 0, read: 0, edit: 0, search: 0, call: 0, failed: 0 };
  for (const tool of tools) {
    counts[toolKind(tool.name)] += 1;
    if (tool.status === 'failed' || (!tool.status && tool.done && !tool.success)) counts.failed += 1;
  }
  return counts;
}

type Tr = (key: string, vars: Record<string, string | number>, fallback: string) => string;

export function toolGroupSummary(tools: ToolCall[], tr: Tr): string {
  const c = countToolKinds(tools);
  const parts: string[] = [];
  if (c.command) parts.push(tr('toolGroup.kind.command', { n: c.command }, '运行 {n} 条命令'));
  if (c.read) parts.push(tr('toolGroup.kind.read', { n: c.read }, '读取 {n} 个文件'));
  if (c.edit) parts.push(tr('toolGroup.kind.edit', { n: c.edit }, '编辑 {n} 个文件'));
  if (c.search) parts.push(tr('toolGroup.kind.search', { n: c.search }, '搜索 {n} 次'));
  if (c.call) parts.push(tr('toolGroup.kind.call', { n: c.call }, '调用 {n} 次工具'));
  if (c.failed) parts.push(tr('toolGroup.kind.failed', { n: c.failed }, '{n} 个失败'));
  return parts.join(' · ');
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 1000) return '';
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function makeTr(): Tr {
  return (key, vars, fallback) => {
    const value = window.t?.(key, vars);
    if (typeof value === 'string' && value && value !== key) return value;
    return fallback.replace(/\{(\w+)\}/g, (_m, k) => String(vars[k] ?? ''));
  };
}
