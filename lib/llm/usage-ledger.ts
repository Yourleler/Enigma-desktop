import fs from "fs";
import path from "path";
import { atomicWriteSync } from "../../shared/safe-fs.ts";
import { normalizeLlmUsage } from "./usage-observer.ts";
import { DEFAULT_USAGE_RETENTION, MAX_USAGE_RETENTION, isUsageRetention } from '../../shared/usage-retention.ts';
import {
  attributionSessionId,
  attributionSessionPath,
  isUnknownUsageContext as isUnknownUsageContextValue,
  normalizeUsageContext,
} from "./usage-context.ts";

const STORAGE_VERSION = 1;

export function createUsageLedger({
  maxEntries = null,
  eventBus = null,
  logger = null,
  now = () => Date.now(),
  requestIdFactory = null,
  storagePath = null,
} = {}) {
  const saved = loadPersistedEntries({ storagePath, logger, now });
  maxEntries = maxEntries ?? saved.maxEntries ?? DEFAULT_USAGE_RETENTION;
  let entries = saved.entries.slice(-maxEntries);
  const pending = new Map();
  let sequence = 0;
  let revision = 0;

  const nextRequestId = () => {
    if (typeof requestIdFactory === "function") return String(requestIdFactory());
    sequence += 1;
    return `llm_${now().toString(36)}_${sequence.toString(36)}`;
  };

  const append = (entry) => {
    const normalizedEntry = normalizeEntry(entry, now);
    if (entryHasUnknownUsageContext(normalizedEntry)) {
      warn(logger, `unknown usage context for LLM request ${normalizedEntry.requestId}`);
    }
    entries.push(normalizedEntry);
    if (entries.length > maxEntries) entries.splice(0, entries.length - maxEntries);
    revision += 1;
    persistEntries({ storagePath, entries, maxEntries, logger });
    emit(eventBus, normalizedEntry);
    return normalizedEntry;
  };

  return {
    start(meta: Record<string, any> = {}) {
      const requestId = meta.requestId ? String(meta.requestId) : nextRequestId();
      const startedMs = now();
      const usageContext = normalizeUsageContext(meta.usageContext);
      const pendingEntry = {
        requestId,
        startedMs,
        startedAt: toIso(startedMs),
        timingSource: meta.timingSource === 'completion_only' ? 'completion_only' : 'request',
        source: usageContext.source,
        attribution: usageContext.attribution,
        metadata: isPlainObject(meta.metadata) ? { ...meta.metadata } : null,
        model: normalizeModel(meta.model),
        costRates: meta.costRates ?? null,
      };
      if (entryHasUnknownUsageContext(pendingEntry)) {
        warn(logger, `unknown usage context for LLM request ${requestId}`);
      }
      pending.set(requestId, pendingEntry);
      return { requestId, startedAt: pendingEntry.startedAt };
    },

    finish(requestId: any, result: Record<string, any> = {}) {
      const pendingEntry = pending.get(requestId);
      if (!pendingEntry) return null;
      pending.delete(requestId);
      const endedMs = now();
      const usage = normalizeUsage(result.usage, {
        costRates: result.costRates ?? pendingEntry.costRates,
        cacheSupport: result.cacheSupport,
      });
      return append({
        schemaVersion: 1,
        requestId,
        startedAt: pendingEntry.startedAt,
        endedAt: toIso(endedMs),
        durationMs: Math.max(0, endedMs - pendingEntry.startedMs),
        timingSource: pendingEntry.timingSource,
        status: usage ? "ok" : "usage_missing",
        source: pendingEntry.source,
        attribution: pendingEntry.attribution,
        metadata: pendingEntry.metadata,
        model: normalizeModel(result.model ?? pendingEntry.model),
        usage,
        rawUsageShape: rawUsageShape(result.usage),
        error: null,
      });
    },

    recordError(requestId: any, error: any, status = "error", result: Record<string, any> = {}) {
      const pendingEntry = pending.get(requestId);
      if (!pendingEntry) return null;
      pending.delete(requestId);
      const endedMs = now();
      const usage = normalizeUsage(result.usage, {
        costRates: result.costRates ?? pendingEntry.costRates,
        cacheSupport: result.cacheSupport,
      });
      return append({
        schemaVersion: 1,
        requestId,
        startedAt: pendingEntry.startedAt,
        endedAt: toIso(endedMs),
        durationMs: Math.max(0, endedMs - pendingEntry.startedMs),
        timingSource: pendingEntry.timingSource,
        status: status === "aborted" ? "aborted" : "error",
        source: pendingEntry.source,
        attribution: pendingEntry.attribution,
        metadata: pendingEntry.metadata,
        model: pendingEntry.model,
        usage,
        rawUsageShape: rawUsageShape(result.usage),
        error: normalizeError(error),
      });
    },

    record(meta: Record<string, any> = {}) {
      const request = this.start({...meta,timingSource:'completion_only'});
      return this.finish(request.requestId, {
        usage: meta.usage,
        model: meta.model,
        costRates: meta.costRates,
        cacheSupport: meta.cacheSupport,
      });
    },

    list(filter: Record<string, any> = {}) {
      const limit = normalizeLimit(filter.limit);
      const filtered = entries.filter(entry => matchesFilter(entry, filter));
      const limited = limit ? filtered.slice(Math.max(0, filtered.length - limit)) : filtered;
      return {
        entries: limited.map(clone),
        nextCursor: null,
      };
    },

    coverage() {
      return {retained:entries.length,maximum:maxEntries,atCapacity:entries.length>=maxEntries,
        oldestAt:entries[0]?.startedAt||null,newestAt:entries.at(-1)?.endedAt||null};
    },

    revision() { return revision; },

    setMaxEntries(value: number) {
      if (!isUsageRetention(value)) throw new RangeError('保留条数须为 100 至 100000 的整数');
      const retained = entries.slice(-value);
      // Commit the file first. A failed preference save must not discard memory.
      persistEntries({ storagePath, entries: retained, maxEntries: value, logger, strict: true });
      entries = retained;
      maxEntries = value;
      revision += 1;
      return this.coverage();
    },

    clear() {
      entries.length = 0;
      pending.clear();
      revision += 1;
      persistEntries({ storagePath, entries, maxEntries, logger });
    },
  };
}

function loadPersistedEntries({ storagePath, logger, now }) {
  const empty = { entries: [], maxEntries: null };
  if (!storagePath) return empty;
  try {
    const raw = JSON.parse(fs.readFileSync(storagePath, "utf-8"));
    const rawEntries = Array.isArray(raw?.entries) ? raw.entries : [];
    const entries = rawEntries
      .map(entry => normalizeEntry(entry, now))
      .filter(entry => entry.requestId);
    return { entries, maxEntries: Number.isInteger(raw.maxEntries) && raw.maxEntries > 0 && raw.maxEntries <= MAX_USAGE_RETENTION ? raw.maxEntries : null };
  } catch (err) {
    if (err?.code === "ENOENT") return empty;
    warn(logger, `failed to read usage ledger storage ${storagePath}: ${err.message}`);
    return empty;
  }
}

function persistEntries({ storagePath, entries, maxEntries, logger, strict = false }) {
  if (!storagePath) return;
  try {
    fs.mkdirSync(path.dirname(storagePath), { recursive: true });
    atomicWriteSync(storagePath, `${JSON.stringify({
      version: STORAGE_VERSION,
      maxEntries,
      entries,
    }, null, 2)}\n`);
  } catch (err) {
    if (strict) throw err;
    warn(logger, `failed to write usage ledger storage ${storagePath}: ${err.message}`);
  }
}

function normalizeEntry(entry, now) {
  const usageContext = normalizeUsageContext({
    source: entry.source,
    attribution: entry.attribution,
  });
  const startedAt = typeof entry.startedAt === "string" ? entry.startedAt : toIso(now());
  const endedAt = entry.endedAt === null || typeof entry.endedAt === "string" ? entry.endedAt : toIso(now());
  return {
    schemaVersion: 1,
    requestId: String(entry.requestId || ""),
    startedAt,
    endedAt,
    durationMs: numberOrNull(entry.durationMs),
    timingSource: entry.timingSource === 'request' || entry.timingSource === 'completion_only' ? entry.timingSource : 'unknown',
    status: normalizeStatus(entry.status),
    source: usageContext.source,
    attribution: usageContext.attribution,
    metadata: isPlainObject(entry.metadata) ? { ...entry.metadata } : null,
    model: normalizeModel(entry.model),
    usage: entry.usage ?? null,
    rawUsageShape: typeof entry.rawUsageShape === "string" ? entry.rawUsageShape : null,
    error: entry.error ?? null,
  };
}

function normalizeUsage(usage, options) {
  if (!usage) return null;
  if (usage.input && usage.output && usage.cache && Object.prototype.hasOwnProperty.call(usage, "totalTokens")) {
    return usage;
  }
  return normalizeLlmUsage(usage, options);
}

function normalizeModel(model: Record<string, any> = {}) {
  return {
    provider: textOrNull(model?.provider),
    modelId: textOrNull(model?.modelId ?? model?.id),
    api: textOrNull(model?.api),
  };
}

function normalizeError(error) {
  if (!error) return { name: null, message: null };
  return {
    name: typeof error.name === "string" ? error.name : null,
    message: typeof error.message === "string" ? error.message : String(error),
  };
}

function normalizeStatus(status) {
  if (status === "ok" || status === "error" || status === "aborted" || status === "usage_missing") {
    return status;
  }
  return "usage_missing";
}

function rawUsageShape(usage) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  return Object.keys(usage).sort().join(",");
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function matchesFilter(entry, filter) {
  if (filter.since && entry.endedAt && entry.endedAt < filter.since) return false;
  if (filter.until && entry.startedAt && entry.startedAt > filter.until) return false;
  if (filter.status && entry.status !== filter.status) return false;
  if (filter.attributionKind && entry.attribution?.kind !== filter.attributionKind) return false;
  if (filter.sessionId && attributionSessionId(entry.attribution) !== filter.sessionId) return false;
  if (filter.sessionPath && attributionSessionPath(entry.attribution) !== filter.sessionPath) return false;
  if (filter.childSessionId && entry.attribution?.childSessionId !== filter.childSessionId) return false;
  if (filter.childSessionPath && entry.attribution?.childSessionPath !== filter.childSessionPath) return false;
  if (filter.agentId && entry.attribution?.agentId !== filter.agentId) return false;
  if (filter.subsystem && entry.source?.subsystem !== filter.subsystem) return false;
  if (filter.operation && entry.source?.operation !== filter.operation) return false;
  if (filter.modelId && entry.model?.modelId !== filter.modelId) return false;
  if (filter.provider && entry.model?.provider !== filter.provider) return false;
  return true;
}

function normalizeLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function emit(eventBus, entry) {
  if (!eventBus || typeof eventBus.emit !== "function") return;
  try {
    eventBus.emit({ type: "llm_usage", entry }, attributionSessionPath(entry.attribution));
  } catch {
    // Usage observation must not break the model request path.
  }
}

function warn(logger, message) {
  try {
    logger?.warn?.(message);
  } catch {
    // Diagnostics should never affect request accounting.
  }
}

function entryHasUnknownUsageContext(entry) {
  return isUnknownUsageContextValue({
    source: entry.source,
    attribution: entry.attribution,
  });
}

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function toIso(ms) {
  return new Date(ms).toISOString();
}

function textOrNull(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
