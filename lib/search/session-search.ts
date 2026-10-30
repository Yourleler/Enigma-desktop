import {
  normalizeSessionSearchText,
  tokenizeSessionSearchQuery,
} from "./session-search-tokenizer.ts";
import {literalSearchIndex,literalSearchTerms,matchCenteredSnippet,type HistorySearchOptions} from '../../shared/history-search.ts';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;

export function searchSessions(sessions, query, options: HistorySearchOptions&{ phase?: string; limit?: number;allResults?:boolean } = {}) {
  const phase = options.phase === "content" ? "content" : "title";
  const limit = normalizeLimit(options.limit);
  const normalizedQuery = normalizeSessionSearchText(query);
  if (!normalizedQuery) return [];

  const tokens = options.match&&options.match!=='smart'?[]:tokenizeSessionSearchQuery(normalizedQuery);
  const results = [];

  for (const session of Array.isArray(sessions) ? sessions : []) {
    const fieldText = phase === "content"
      ? session?.allMessagesText
      : [session?.title, session?.firstMessage].filter(Boolean).join(" ");
    const match = options.match&&options.match!=='smart'?matchLiteralText(String(fieldText||''),query,options,phase):scoreText(fieldText, normalizedQuery, tokens, phase);
    if (!match.matched) continue;

    results.push({
      sessionId:session.sessionId||null,projectId:session.projectId||null,archived:session.archived===true,workspaceMountId:session.workspaceMountId||null,workspaceLabel:session.workspaceLabel||null,
      path: session.path,
      title: session.title || null,
      firstMessage: session.firstMessage || "",
      modified: session.modified || null,
      messageCount: session.messageCount || 0,
      cwd: session.cwd || null,
      agentId: session.agentId || null,
      agentName: session.agentName || null,
      modelId: session.modelId || null,
      modelProvider: session.modelProvider || null,
      pinnedAt: session.pinnedAt || null,
      pinOrder: Number.isFinite(session.pinOrder) ? session.pinOrder : null,
      matchKind: phase,
      snippet: buildSnippet(fieldText, normalizedQuery, match.token),
      score: match.score,
      matchedTerms:match.token?[match.token]:[],
    });
    delete results.at(-1).allMessagesText;
  }

  return results
    .sort((a, b) => compareResults(a, b))
    .slice(0,options.allResults?undefined:limit);
}

function normalizeLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(n)));
}

function scoreText(text, normalizedQuery, tokens, phase) {
  const raw = String(text || "");
  const normalized = normalizeSessionSearchText(raw);
  if (!normalized) return { matched: false, score: 0, token: null };

  if (normalized.includes(normalizedQuery)) {
    return { matched: true, score: phase === "title" ? 1000 : 700, token: normalizedQuery };
  }

  let score = 0;
  let matchedToken = null;
  let matchedStrongTokens = 0;
  let matchedAnchorToken = false;
  const searchableTokens = tokens
    .filter((token) => token !== normalizedQuery)
    .filter(isSearchableToken);
  const anchorTokens = searchableTokens.filter(isAnchorToken);
  for (const token of searchableTokens) {
    if (!normalized.includes(token)) continue;

    matchedToken ||= token;
    matchedStrongTokens += 1;
    if (isAnchorToken(token)) matchedAnchorToken = true;
    score += scoreToken(token, phase);
  }

  if (score <= 0 || matchedStrongTokens <= 0) {
    return { matched: false, score: 0, token: null };
  }
  if (anchorTokens.length > 0 && !matchedAnchorToken) {
    return { matched: false, score: 0, token: null };
  }
  if (anchorTokens.length === 0 && searchableTokens.length > 1 && matchedStrongTokens < 2) {
    return { matched: false, score: 0, token: null };
  }

  return { matched: true, score, token: matchedToken };
}

export function isSearchableToken(token) {
  if (!token) return false;
  if (token.length >= 2 && /[\p{Script=Han}]/u.test(token)) return true;
  if (/^[a-z0-9_][a-z0-9_.-]*$/u.test(token)) return token.length >= 2;
  return token.length >= 3;
}

function isAnchorToken(token) {
  if (!token) return false;
  if (token.length >= 3) return true;
  return /[a-z0-9_]/u.test(token) && /[\p{Script=Han}]/u.test(token);
}

function scoreToken(token, phase) {
  const base = phase === "title" ? 120 : 80;
  const lengthBonus = Math.min(60, token.length * 8);
  return base + lengthBonus;
}

function compareResults(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  const aTime = timestampOf(a.modified);
  const bTime = timestampOf(b.modified);
  return bTime - aTime;
}

function timestampOf(value) {
  if (value instanceof Date) return value.getTime();
  const time = Date.parse(value || "");
  return Number.isNaN(time) ? 0 : time;
}

export function buildSnippet(text, normalizedQuery, token) {
  return matchCenteredSnippet(String(text||''),token||normalizedQuery);
}

export function matchLiteralText(text:string,query:string,options:HistorySearchOptions,phase='content'){
 const terms=literalSearchTerms(query,options),indices=terms.map(term=>literalSearchIndex(text,term,options.caseSensitive));
 const matched=!!terms.length&&indices.every(index=>index>=0);
 return {matched,score:matched?(phase==='title'?1000:700):0,token:matched?terms[indices.indexOf(Math.min(...indices))]:null};
}

function collapseWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
