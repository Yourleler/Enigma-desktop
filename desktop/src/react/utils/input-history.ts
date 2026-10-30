import type { JSONContent } from '@tiptap/core';
import type { ChatListItem, ChatMessage } from '../stores/chat-types';

export interface InputHistoryEntry { id: string; message: ChatMessage }

export function inputHistoryEntries(items: ChatListItem[] = []): InputHistoryEntry[] {
  return items.flatMap(item => item.type === 'message' && item.data.role === 'user' && !item.data.origin
    && !item.data.sendStatus ? [{ id: item.data.sourceEntryId || item.data.id, message: item.data }] : []);
}

/** Rebuild visible input only; never replay hidden prompts or tool output. */
export function inputHistoryDocument(message: ChatMessage): JSONContent {
  const attachments = message.attachments || [];
  const used = new Set<number>();
  const badge = (index: number): JSONContent => {
    const file = attachments[index];
    used.add(index);
    return { type: 'fileBadge', attrs: { fileId: file.fileId || null, path: file.path, name: file.name,
      isDirectory: file.isDir, mimeType: file.mimeType || null, inlineAttachment: true } };
  };
  const content: JSONContent[] = (message.text || '').split('\n').map(line => {
    const nodes: JSONContent[] = [];
    let cursor = 0;
    for (const match of line.matchAll(/\[(?:图片|文件) (\d+)\]/g)) {
      const index = Number(match[1]) - 1;
      if (!attachments[index]) continue;
      if (match.index! > cursor) nodes.push({ type: 'text', text: line.slice(cursor, match.index) });
      nodes.push(badge(index)); cursor = match.index! + match[0].length;
    }
    if (cursor < line.length) nodes.push({ type: 'text', text: line.slice(cursor) });
    return { type: 'paragraph', content: nodes };
  });
  const remaining = attachments.flatMap((_file,index) => used.has(index) ? [] : [badge(index)]);
  const skills = (message.skills || []).map(name => ({ type: 'skillBadge', attrs: { name } }));
  if (remaining.length || skills.length) content.push({ type: 'paragraph', content: [...remaining, ...skills] });
  return { type: 'doc', content };
}

/** The null cursor is the saved draft, always newer than sent inputs. */
export function moveInputHistory(entries: InputHistoryEntry[], selected: string | null, direction: -1 | 1): string | null {
  const found = selected === null ? entries.length : entries.findIndex(entry => entry.id === selected);
  const index = found < 0 ? entries.length : found;
  const next = Math.min(entries.length, Math.max(0, index + direction));
  return entries[next]?.id ?? null;
}

export function inputHistoryDirection(event: {key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; isComposing?: boolean}): -1 | 1 | null {
  if ((!event.metaKey && !event.ctrlKey) || event.altKey || event.isComposing) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 1 : -1;
  return key === 'y' && !event.shiftKey ? 1 : null;
}
