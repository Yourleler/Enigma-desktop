/**
 * InputDraftsStore — 输入框草稿落盘（{HANA_HOME}/input-drafts.v1.json）
 *
 * 独立于 preferences.json：草稿是高频写入的用户内容，不混进配置。
 * build-to-delete：删除本文件 + shared/input-drafts.ts + server/routes/input-drafts.ts
 * 及 engine 上的四个委托方法，即可整块移除该功能。
 */
import fs from "fs";
import path from "path";
import { atomicWriteSync } from "../shared/safe-fs.ts";
import {
  INPUT_DRAFT_SURFACES,
  HOME_DRAFT_KEY,
  INPUT_DRAFT_MAX_SESSIONS_PER_SURFACE,
  normalizeInputDraftEntry,
  normalizeInputDraftsFile,
  upsertSurfaceSessionDrafts,
} from "../shared/input-drafts.ts";
import { createModuleLogger } from "../lib/debug-log.ts";

const log = createModuleLogger("input-drafts");

export class InputDraftsStore {
  declare _path: string;
  declare _cache: any;
  declare _stamp: string;

  constructor({ hanakoHome }) {
    if (!hanakoHome) throw new Error("InputDraftsStore requires hanakoHome");
    this._path = path.join(hanakoHome, "input-drafts.v1.json");
    this._cache = null;
    this._stamp = '';
  }

  _fileStamp() {
    try { const stat = fs.statSync(this._path); return `${stat.ino}:${stat.mtimeMs}:${stat.size}`; }
    catch { return "missing"; }
  }

  _load() {
    const stamp = this._fileStamp();
    if (this._cache && this._stamp === stamp) return this._cache;
    let raw = null;
    if (fs.existsSync(this._path)) {
      try {
        raw = JSON.parse(fs.readFileSync(this._path, "utf8"));
      } catch (err) {
        // 损坏文件重命名留证后从空重建，不静默覆盖证据，不阻塞启动
        const quarantine = `${this._path}.corrupt-${Date.now()}`;
        try {
          fs.renameSync(this._path, quarantine);
          log.error(`input drafts file corrupt, moved aside to ${path.basename(quarantine)}: ${err?.message || err}`);
        } catch (renameErr) {
          log.error(`input drafts file corrupt and quarantine failed: ${renameErr?.message || renameErr}`);
        }
        raw = null;
      }
    }
    this._cache = normalizeInputDraftsFile(raw);
    this._stamp = this._fileStamp();
    return this._cache;
  }

  _save(next = this._cache) {
    fs.mkdirSync(path.dirname(this._path), { recursive: true });
    atomicWriteSync(this._path, JSON.stringify(next));
    this._cache = next;
    this._stamp = this._fileStamp();
  }

  /** surface 必须已由调用方（route）归一化 */
  getAll(surface) {
    const data = this._load();
    const bucket = data.surfaces[surface];
    return { protocol: 2, capabilities: { quotes: true }, home: bucket?.home || null, sessions: { ...(bucket?.sessions || {}) }, revisions: { ...(bucket?.revisions || {}) } };
  }

  _set(surface, key, rawEntry) {
    const data = this._load(), bucket = data.surfaces[surface];
    const current = key === HOME_DRAFT_KEY ? bucket.home : bucket.sessions[key] || null;
    const revision = bucket.revisions[key] || 0;
    if (rawEntry.expectedRevision !== undefined && rawEntry.expectedRevision !== revision) {
      return { conflict: true, revision, entry: current };
    }
    // An older renderer cannot see quote cards. Do not let it erase them while
    // saving what appears to be an empty or text-only composer.
    if (current?.quotes?.length && rawEntry.quotes === undefined) {
      return { conflict: true, revision, entry: current };
    }
    const entry = normalizeInputDraftEntry(rawEntry);
    if (key !== HOME_DRAFT_KEY && entry && !bucket.sessions[key] && Object.keys(bucket.sessions).length >= INPUT_DRAFT_MAX_SESSIONS_PER_SURFACE) {
      throw new Error("Draft storage is full; existing drafts have been preserved");
    }
    const nextRevision = Object.values(bucket.revisions).reduce<number>((max, value) => Math.max(max, Number(value)), data.sequence) + 1;
    const nextBucket = { ...bucket, revisions: { ...bucket.revisions, [key]: nextRevision } };
    if (key === HOME_DRAFT_KEY) nextBucket.home = entry;
    else nextBucket.sessions = upsertSurfaceSessionDrafts(bucket.sessions, key, entry);
    this._save({ ...data, sequence: nextRevision, surfaces: { ...data.surfaces, [surface]: nextBucket } });
    return { ok: true, revision: nextRevision, entry };
  }

  setHome(surface, rawEntry) { return this._set(surface, HOME_DRAFT_KEY, rawEntry); }
  setSession(surface, sessionId, rawEntry) { return this._set(surface, sessionId, rawEntry); }

  /** session 永久删除时清掉所有 surface 下的草稿 */
  deleteSession(sessionId) {
    if (typeof sessionId !== "string" || !sessionId.trim()) return;
    const data = this._load(), surfaces = { ...data.surfaces };
    let sequence = data.sequence, changed = false;
    for (const surface of INPUT_DRAFT_SURFACES) {
      const bucket = data.surfaces[surface];
      if (bucket.sessions[sessionId]) {
        surfaces[surface] = { ...bucket, sessions: upsertSurfaceSessionDrafts(bucket.sessions, sessionId, null), revisions: { ...bucket.revisions, [sessionId]: ++sequence } };
        changed = true;
      }
    }
    if (changed) this._save({ ...data, sequence, surfaces });
  }
}
