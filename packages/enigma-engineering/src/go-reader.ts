import { readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isAbsolute, join, relative, sep } from 'node:path';
import { LanguageServer } from './language-server.js';
import { SourceIndex } from './source-index.js';
import { hash, id, ensureDir } from './storage.js';
import type { Workspace } from './workspace.js';
import type { ReadingResult, SourceLocation } from './reading.js';

interface Position { line: number; character: number }
interface Range { start: Position; end: Position }
interface Location { uri: string; range: Range }
interface Symbol { name: string; kind: number; range: Range; selectionRange: Range; children?: Symbol[] }
interface CallItem extends Location { name: string; selectionRange: Range }
interface GoUnit { repo: string; file: string; uri: string; text: string; hash: string }
const uriKey = (uri: string) => {
  const normalized = uri.startsWith('file:') ? pathToFileURL(fileURLToPath(uri)).href : uri;
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};

export async function analyzeGo(workspace: Workspace, query: string, options: { repo?: string; maxFiles: number; signal?: AbortSignal }) {
  const symbols: SourceLocation[] = [], references: ReadingResult['references'] = [], imports: ReadingResult['imports'] = [];
  const sources: ReadingResult['sources'] = [], diagnostics: string[] = [];
  const indexed = await new SourceIndex(workspace).select(query, { language: 'Go', maxFiles: options.maxFiles, signal: options.signal });
  diagnostics.push(...indexed.diagnostics);
  let truncated = indexed.truncated;
  if (!indexed.files.length) return { symbols, references, imports, sources, diagnostics, truncated, scannedFiles: 0, incremental: { reparsed: 0, reused: 0 }, limitation: '' };
  const units = new Map<string, GoUnit>();
  const initial = indexed.files.filter(item => item.score > 0);
  for (const item of initial) {
    const path = await workspace.path(item.repo, item.file), bytes = await readFile(path), uri = pathToFileURL(path).href;
    units.set(uriKey(uri), { ...item, hash: hash(bytes), uri, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) });
    sources.push({ repo: item.repo, file: item.file, hash: hash(bytes) });
  }
  const location = (uri: string, range: Range, name: string, kind: string): SourceLocation | undefined => {
    const unit = units.get(uriKey(uri)); if (!unit || !range?.start || !range.end) return undefined;
    const line = range.start.line + 1, endLine = Math.min(range.end.line + 1, line + 100), lines = unit.text.split('\n');
    if (line < 1 || line > lines.length) return undefined;
    return { repo: unit.repo, file: unit.file, hash: unit.hash, line, endLine, symbol: name, kind,
      snippet: lines.slice(line - 1, endLine).join('\n').slice(0, 12000), truncated: range.end.line + 1 > endLine };
  };
  const addUnit = async (uri: string) => {
    if (units.has(uriKey(uri))) return;
    if (!uri.startsWith('file:') || units.size >= options.maxFiles) { truncated = true; return; }
    const path = fileURLToPath(uri);
    for (const repo of workspace.config.repos) {
      const file = relative(repo.root, path).split(sep).join('/');
      if (!file || file.startsWith('../') || isAbsolute(file) || !file.endsWith('.go')) continue;
      const entry = indexed.candidates.find(item => item.repo === repo.id && item.file === file);
      // Only indexed registered source is eligible for navigation; module cache locations remain external.
      if (!entry) return;
      const bytes = await readFile(await workspace.path(repo.id, file));
      units.set(uriKey(uri), { repo: repo.id, file, uri, hash: hash(bytes), text: bytes.toString('utf8') }); sources.push({ repo: repo.id, file, hash: hash(bytes) }); return;
    }
  };
  const modules: string[] = []; let goVersion = '1.18';
  for (const repo of workspace.config.repos) try {
    const path = await workspace.path(repo.id, 'go.mod'), bytes = await readFile(path);
    const version = /^go\s+(\d+\.\d+(?:\.\d+)?)/m.exec(bytes.toString())?.[1];
    if (version && version.localeCompare(goVersion, undefined, { numeric: true }) > 0) goVersion = version;
    modules.push(repo.root); sources.push({ repo: repo.id, file: 'go.mod', hash: hash(bytes) });
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const workfile = join(await ensureDir(join(workspace.data, 'source-index')), `${id('gopls')}.work`);
  if (modules.length) await writeFile(workfile, `go ${goVersion}\nuse (\n${modules.map(path => JSON.stringify(path)).join('\n')}\n)\n`, { mode: 0o600 });
  const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(), 60_000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
  const server = new LanguageServer([process.env.ENIGMA_GOPLS ?? 'gopls', 'serve'], workspace.root,
    { directoryFilters: ['-**/node_modules', '-**/.git', '-**/.enigma-next'], analyses: {}, staticcheck: false }, { signal, env: { GOWORK: modules.length ? workfile : 'off' }, activity: workspace.activity });
  const optional = async <T>(method: string, params: unknown): Promise<T | null> => {
    try { return await server.request<T | null>(method, params); }
    catch (error) { if (signal.aborted) throw error; diagnostics.push(`${method}: ${String(error)}`); return null; }
  };
  let requests = 0;
  try {
    await server.request('initialize', { processId: process.pid, rootUri: null,
      workspaceFolders: workspace.config.repos.filter(repo => indexed.candidates.some(file => file.repo === repo.id)).map(repo => ({ uri: pathToFileURL(repo.root).href, name: repo.id })),
      capabilities: { workspace: { configuration: true, workspaceFolders: true }, general: { positionEncodings: ['utf-16'] },
        textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true }, definition: {}, references: {}, implementation: {}, callHierarchy: {} } } });
    server.notify('initialized', {});
    for (const unit of units.values()) server.notify('textDocument/didOpen', { textDocument: { uri: unit.uri, languageId: 'go', version: 1, text: unit.text } });
    const targets: { unit: GoUnit; symbol: Symbol }[] = [], term = query.split('.').at(-1)!;
    for (const unit of units.values()) {
      if (options.repo && unit.repo !== options.repo || !unit.text.includes(term)) continue;
      if (++requests > 40) { truncated = true; break; }
      const declarations = await server.request<Symbol[] | null>('textDocument/documentSymbol', { textDocument: { uri: unit.uri } });
      const visit = (declaration: Symbol) => {
        if (declaration.name.replace(/\(.*$/, '').split('.').at(-1)?.trim() === term) { const found = location(unit.uri, declaration.range, declaration.name, `go-symbol-${declaration.kind}`); if (found) { symbols.push(found); targets.push({ unit, symbol: declaration }); } }
        declaration.children?.forEach(visit);
      };
      declarations?.forEach(visit);
    }
    for (const { unit, symbol } of targets.slice(0, 8)) {
      const params = { textDocument: { uri: unit.uri }, position: symbol.selectionRange.start };
      const target = location(unit.uri, symbol.range, symbol.name, 'definition')!;
      const refs = await server.request<Location[] | null>('textDocument/references', { ...params, context: { includeDeclaration: false } });
      for (const ref of refs ?? []) {
        await addUnit(ref.uri); const found = location(ref.uri, ref.range, symbol.name, 'source-reference');
        if (found) references.push({ ...found, confidence: 'confirmed', target, reason: 'gopls static symbol reference; runtime dispatch is not verified.' });
        else diagnostics.push('A Go reference lies outside the selected registered source budget.');
      }
      const implementations = [5, 6, 11, 23].includes(symbol.kind) ? await optional<Location[]>('textDocument/implementation', params) : null;
      for (const implementation of implementations ?? []) {
        await addUnit(implementation.uri); const found = location(implementation.uri, implementation.range, symbol.name, 'implementation');
        if (found) references.push({ ...found, confidence: 'confirmed', target, reason: 'gopls static implementation relation.' });
      }
      const hierarchy = [6, 12].includes(symbol.kind) ? await optional<CallItem[]>('textDocument/prepareCallHierarchy', params) : null;
      for (const item of hierarchy ?? []) {
        const incoming = await server.request<{ from: CallItem; fromRanges: Range[] }[] | null>('callHierarchy/incomingCalls', { item });
        for (const call of incoming ?? []) for (const range of call.fromRanges) {
          await addUnit(call.from.uri); const found = location(call.from.uri, range, symbol.name, 'call-site');
          if (found) references.push({ ...found, confidence: 'confirmed', target, owner: call.from.name, reason: 'gopls static incoming call; dynamic calls may be absent.' });
        }
        const outgoing = await server.request<{ to: CallItem; fromRanges: Range[] }[] | null>('callHierarchy/outgoingCalls', { item });
        for (const call of outgoing ?? []) {
          await addUnit(call.to.uri); const destination = location(call.to.uri, call.to.range, call.to.name, 'definition');
          for (const range of call.fromRanges) { const found = location(item.uri, range, call.to.name, 'outgoing-call');
            if (found && destination) references.push({ ...found, target: destination, owner: item.name, confidence: 'confirmed', reason: 'gopls static outgoing call; dynamic calls may be absent.' }); }
        }
      }
    }
    if (targets.length > 8) truncated = true;
    diagnostics.push(...server.diagnostics);
  } catch (error) {
    if (options.signal?.aborted) throw new Error('Go source reading cancelled');
    diagnostics.push(`Go semantic reading unavailable or incomplete: ${String(error)}`);
  } finally { clearTimeout(timer); await server.close(); await rm(workfile, { force: true }); await rm(`${workfile}.sum`, { force: true }); }
  const unique = new Map(references.map(reference => [`${reference.repo}:${reference.file}:${reference.line}:${reference.kind}:${reference.target?.repo}:${reference.target?.line}`, reference]));
  return { symbols, references: [...unique.values()], imports, sources, diagnostics: [...new Set(diagnostics)], truncated, scannedFiles: units.size,
    incremental: { reparsed: 0, reused: 0 },
    sourceIndex: { refreshed: indexed.refreshed, reused: indexed.reused },
    limitation: 'Go uses gopls static definitions, references, implementations and calls. External declarations, missing modules, build-tag variants and dynamic calls are not complete. Network dependency downloads are disabled. Go AST/cache internals are not reported; source-index reuse is lexical.' };
}
