import type { AudioWaveform } from './chat-types';
import type { JSONContent } from '@tiptap/core';
import { sessionScopedKey } from './session-slice';
import { notifyDraftCleared, notifyDraftSet } from './input-draft-sync';
import { HOME_DRAFT_KEY, type InputDraftQuote } from '../../../../shared/input-drafts';

export interface AttachedFile {
  fileId?: string;
  path: string;
  name: string;
  isDirectory?: boolean;
  /** 内联 base64 数据（粘贴图片时使用，跳过文件读取） */
  base64Data?: string;
  mimeType?: string;
  waveform?: AudioWaveform;
}

export interface DocContextFile {
  path: string;
  name: string;
}

export interface FloatingAnchorRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export interface QuotedSelection extends InputDraftQuote {
  selectionAnchorKind?: 'native' | 'codemirror';
  anchorRect?: FloatingAnchorRect;
}

export interface InputSlice {
  attachedFiles: AttachedFile[];
  /** 按 session path 存储的附件（权威源） */
  attachedFilesBySession: Record<string, AttachedFile[]>;
  /** 按稳定 session identity 存储，同步到本机恢复日志与服务。 */
  drafts: Record<string, string>;
  /** 输入框富文本草稿，与文本、引用一起保存。 */
  draftDocs: Record<string, JSONContent>;
  draftQuotes: Record<string, QuotedSelection[]>;
  /** 草稿持久化 hydrate 完成时间戳（0 = 未 hydrate）；InputArea 恢复 effect 依赖它重跑 */
  draftsHydratedAt: number;
  deskContextAttached: boolean;
  docContextAttached: boolean;
  inputFocusTrigger: number;
  /** Source of the most recent requestInputFocus() call; consumers gate 'restore' by surface. */
  inputFocusTriggerSource: 'gesture' | 'restore';
  quoteCandidate: QuotedSelection | null;
  quotedSelections: QuotedSelection[];
  /** @deprecated Use quotedSelections for committed quotes and quoteCandidate for transient selection UI. */
  quotedSelection: QuotedSelection | null;
  addAttachedFile: (file: AttachedFile) => void;
  removeAttachedFile: (index: number) => void;
  setAttachedFiles: (files: AttachedFile[]) => void;
  clearAttachedFiles: () => void;
  /** 清理指定 session 的附件；只有目标仍是当前 session 时才同步清空可见附件。 */
  clearAttachedFilesForSession: (sessionPath: string) => void;
  setDraft: (sessionPath: string, text: string, doc?: JSONContent | null, quotes?: QuotedSelection[]) => void;
  setDraftQuotes: (sessionPath: string, quotes: QuotedSelection[]) => void;
  /** Clear editor text/doc; quote cards are consumed separately from the sent snapshot. */
  clearDraft: (sessionPath: string) => void;
  setDeskContextAttached: (attached: boolean) => void;
  toggleDeskContext: () => void;
  setDocContextAttached: (attached: boolean) => void;
  toggleDocContext: () => void;
  requestInputFocus: (source?: 'gesture' | 'restore') => void;
  setQuoteCandidate: (sel: QuotedSelection) => void;
  clearQuoteCandidate: () => void;
  addQuotedSelection: (sel: QuotedSelection) => void;
  removeQuotedSelection: (index: number) => void;
  clearQuotedSelections: () => void;
  setQuotedSelections: (sels: QuotedSelection[]) => void;
  /** @deprecated Use addQuotedSelection or setQuoteCandidate. */
  setQuotedSelection: (sel: QuotedSelection) => void;
  /** @deprecated Use clearQuotedSelections and clearQuoteCandidate. */
  clearQuotedSelection: () => void;
}

export function currentInputDraftKey(state: { currentSessionPath?: string | null }): string {
  const path = state.currentSessionPath || HOME_DRAFT_KEY;
  return sessionScopedKey(state as any, path) || path;
}

function updateDraftQuotes(state: InputSlice, path: string, quotes: QuotedSelection[]): Partial<InputSlice> {
  const key = sessionScopedKey(state as any, path) || path;
  const draftQuotes = { ...state.draftQuotes, [key]: quotes };
  if (key !== path) delete draftQuotes[path];
  const text = state.drafts[key] ?? state.drafts[path] ?? '';
  const doc = state.draftDocs[key] ?? state.draftDocs[path] ?? null;
  notifyDraftSet(key, text, doc, quotes);
  return {
    draftQuotes,
    // Quote-only edits count as a local draft, including a pending removal.
    drafts: { ...state.drafts, [key]: text },
    ...(currentInputDraftKey(state as any) === key ? { quotedSelections: quotes, quotedSelection: quotes[0] ?? null } : {}),
  };
}

function syncCurrentSessionAttachments(state: InputSlice & { currentSessionPath?: string | null }, files: AttachedFile[]) {
  const patch: Partial<InputSlice> & { attachedFilesBySession?: Record<string, AttachedFile[]> } = {
    attachedFiles: files,
  };
  const currentSessionPath = state.currentSessionPath;
  if (currentSessionPath) {
    const key = sessionScopedKey(state as any, currentSessionPath) || currentSessionPath;
    patch.attachedFilesBySession = {
      ...state.attachedFilesBySession,
      [key]: files,
    };
    if (key !== currentSessionPath) delete patch.attachedFilesBySession[currentSessionPath];
  }
  return patch;
}

export const createInputSlice = (
  set: (partial: Partial<InputSlice> | ((s: InputSlice) => Partial<InputSlice>)) => void
): InputSlice => ({
  attachedFiles: [],
  attachedFilesBySession: {},
  drafts: {},
  draftDocs: {},
  draftQuotes: {},
  draftsHydratedAt: 0,
  deskContextAttached: false,
  docContextAttached: false,
  inputFocusTrigger: 0,
  inputFocusTriggerSource: 'gesture',
  quoteCandidate: null,
  quotedSelections: [],
  quotedSelection: null,
  addAttachedFile: (file) =>
    set((s) => syncCurrentSessionAttachments(s as InputSlice & { currentSessionPath?: string | null }, [...s.attachedFiles, file])),
  removeAttachedFile: (index) =>
    set((s) => syncCurrentSessionAttachments(
      s as InputSlice & { currentSessionPath?: string | null },
      s.attachedFiles.filter((_, i) => i !== index),
    )),
  setAttachedFiles: (files) =>
    set((s) => syncCurrentSessionAttachments(s as InputSlice & { currentSessionPath?: string | null }, files)),
  clearAttachedFiles: () =>
    set((s) => syncCurrentSessionAttachments(s as InputSlice & { currentSessionPath?: string | null }, [])),
  clearAttachedFilesForSession: (sessionPath) =>
    set((s) => {
      const state = s as InputSlice & { currentSessionPath?: string | null };
      const key = sessionScopedKey(state as any, sessionPath) || sessionPath;
      const attachedFilesBySession = { ...s.attachedFilesBySession };
      delete attachedFilesBySession[key];
      delete attachedFilesBySession[sessionPath];
      return {
        attachedFilesBySession,
        ...(state.currentSessionPath === sessionPath ? { attachedFiles: [] } : {}),
      };
    }),
  setDraft: (sessionPath, text, doc, quotes) =>
    set((s) => {
      const key = sessionScopedKey(s as any, sessionPath) || sessionPath;
      const prevText = Object.prototype.hasOwnProperty.call(s.drafts, key)
        ? s.drafts[key]
        : Object.prototype.hasOwnProperty.call(s.drafts, sessionPath)
          ? s.drafts[sessionPath]
          : undefined;
      const prevDoc = Object.prototype.hasOwnProperty.call(s.draftDocs, key)
        ? s.draftDocs[key]
        : Object.prototype.hasOwnProperty.call(s.draftDocs, sessionPath)
          ? s.draftDocs[sessionPath]
          : undefined;
      const nextDoc = doc ?? null;
      const sameText = prevText === text;
      const sameDoc = nextDoc
        ? !!prevDoc && JSON.stringify(prevDoc) === JSON.stringify(nextDoc)
        : prevDoc === undefined;
      // 内容未变则保持 drafts/draftDocs 引用不变，避免 InputArea 订阅方空转，
      // 也让「恢复走 emitUpdate」时不会 update→setDraft→effect 死循环。
      const nextQuotes = quotes ?? s.draftQuotes[key] ?? s.draftQuotes[sessionPath] ?? [];
      if (sameText && sameDoc && prevText !== undefined && (quotes === undefined || quotes === s.draftQuotes[key])) {
        return {};
      }
      const drafts = { ...s.drafts, [key]: text };
      const draftDocs = { ...s.draftDocs };
      if (doc) draftDocs[key] = doc;
      else delete draftDocs[key];
      if (key !== sessionPath) delete drafts[sessionPath];
      if (key !== sessionPath) delete draftDocs[sessionPath];
      notifyDraftSet(key, text, doc ?? null, nextQuotes);
      const draftQuotes = { ...s.draftQuotes, [key]: nextQuotes };
      if (key !== sessionPath) delete draftQuotes[sessionPath];
      return { drafts, draftDocs, draftQuotes };
    }),
  setDraftQuotes: (path, quotes) => set(s => updateDraftQuotes(s, path, quotes)),
  clearDraft: (sessionPath) =>
    set((s) => {
      const key = sessionScopedKey(s as any, sessionPath) || sessionPath;
      const rest = { ...s.drafts };
      const draftDocs = { ...s.draftDocs };
      delete rest[key];
      delete rest[sessionPath];
      delete draftDocs[key];
      delete draftDocs[sessionPath];
      const quotes = s.draftQuotes[key] ?? s.draftQuotes[sessionPath] ?? [];
      if (quotes.length) { rest[key] = ''; notifyDraftSet(key, '', null, quotes); }
      else notifyDraftCleared(key);
      return { drafts: rest, draftDocs };
    }),
  setDeskContextAttached: (attached) => set({ deskContextAttached: attached }),
  toggleDeskContext: () =>
    set((s) => ({ deskContextAttached: !s.deskContextAttached })),
  setDocContextAttached: (attached) => set({ docContextAttached: attached }),
  toggleDocContext: () =>
    set((s) => ({ docContextAttached: !s.docContextAttached })),
  requestInputFocus: (source = 'gesture') =>
    set((s) => ({ inputFocusTrigger: s.inputFocusTrigger + 1, inputFocusTriggerSource: source })),
  setQuoteCandidate: (sel) => set({ quoteCandidate: sel }),
  clearQuoteCandidate: () => set({ quoteCandidate: null }),
  addQuotedSelection: (sel) =>
    set(s => updateDraftQuotes(s, currentInputDraftKey(s as any), [...s.quotedSelections, sel])),
  removeQuotedSelection: (index) =>
    set(s => updateDraftQuotes(s, currentInputDraftKey(s as any), s.quotedSelections.filter((_, i) => i !== index))),
  clearQuotedSelections: () => set(s => updateDraftQuotes(s, currentInputDraftKey(s as any), [])),
  setQuotedSelections: (sels) => set(s => updateDraftQuotes(s, currentInputDraftKey(s as any), sels)),
  setQuotedSelection: (sel) => set(s => updateDraftQuotes(s, currentInputDraftKey(s as any), [sel])),
  clearQuotedSelection: () => set(s => ({ ...updateDraftQuotes(s, currentInputDraftKey(s as any), []), quoteCandidate: null })),
});
