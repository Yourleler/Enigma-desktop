import { readFile, stat } from 'node:fs/promises';
import { hash } from './storage.js';
import type { Workspace } from './workspace.js';
import type { Observation } from './types.js';
import { analyzeTypescript } from './typescript-reader.js';
import { analyzePython } from './python-reader.js';
import { declaredContracts } from './contracts.js';
import { analyzeGo } from './go-reader.js';

export interface SourceLocation {
  repo: string; file: string; line: number; endLine: number; hash: string; symbol: string; kind: string; snippet: string;
  truncated?: boolean;
}
export interface ReadingResult {
  query: string;
  symbols: SourceLocation[];
  references: (SourceLocation & { confidence: 'confirmed' | 'candidate'; reason: string; target?: SourceLocation; owner?: string })[];
  imports: { repo: string; file: string; line: number; module: string; target?: string; confidence: 'confirmed' | 'unresolved' }[];
  truncated: boolean;
  scannedFiles: number;
  supportedLanguages: string[];
  followQueries: string[];
  observation: Observation;
  sources: { repo: string; file: string; hash: string }[];
  incremental?: { reparsed: number; reused: number; reportedLanguages?: string[] };
  sourceIndex?: { refreshed: number; reused: number };
  diagnostics?: string[];
  limitation?: string;
  map?: { nodes: { id: string; source: SourceLocation; role: string }[]; edges: { from: string; to: string; kind: string; confidence: string }[] };
}
export async function repoGraph(workspace: Workspace): Promise<{
  repos: { id: string; role: string; package?: string }[];
  edges: { from: string; to: string; reason: string; confidence: 'confirmed' }[];
  order: string[]; cycles: string[]; affectedBy: Record<string, string[]>;
  sources: { repo: string; file: string; hash: string }[];
}> {
  const packages = new Map<string, string[]>();
  const manifests = new Map<string, Record<string, unknown>>();
  const goModules = new Map<string, string[]>(), goDependencies = new Map<string, string[]>();
  const repos = [];
  const sources = [];
  for (const repo of workspace.config.repos) {
    let manifest: Record<string, unknown> = {};
    try { const text = await readFile(await workspace.path(repo.id, 'package.json'), 'utf8'); manifest = JSON.parse(text); sources.push({ repo: repo.id, file: 'package.json', hash: hash(text) }); }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
    manifests.set(repo.id, manifest);
    try {
      const bytes = await readFile(await workspace.path(repo.id, 'go.mod')), text = bytes.toString('utf8');
      const module = /^module\s+"?([^\s"]+)/m.exec(text)?.[1];
      if (module) goModules.set(module, [...goModules.get(module) ?? [], repo.id]);
      goDependencies.set(repo.id, [...text.matchAll(/^\s*(?:require\s+)?([^\s()]+)\s+v\d[^\s]*/gm)].map(match => match[1]!));
      sources.push({ repo: repo.id, file: 'go.mod', hash: hash(bytes) });
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const name = typeof manifest.name === 'string' ? manifest.name : undefined;
    if (name) packages.set(name, [...packages.get(name) ?? [], repo.id]);
    repos.push({ id: repo.id, role: repo.role, package: name });
  }
  const edges: { from: string; to: string; reason: string; confidence: 'confirmed' }[] = [];
  for (const repo of workspace.config.repos) {
    for (const dep of repo.dependsOn) edges.push({ from: repo.id, to: dep, reason: 'workspace configuration', confidence: 'confirmed' });
    for (const name of goDependencies.get(repo.id) ?? []) {
      const targets = goModules.get(name);
      if (targets?.length === 1 && targets[0] !== repo.id) edges.push({ from: repo.id, to: targets[0]!, reason: `go.mod require: ${name}`, confidence: 'confirmed' });
    }
    const manifest = manifests.get(repo.id)!;
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      const deps = manifest[field];
      if (deps && typeof deps === 'object' && !Array.isArray(deps)) for (const name of Object.keys(deps)) {
        const targets = packages.get(name);
        if (targets?.length === 1 && targets[0] !== repo.id) edges.push({ from: repo.id, to: targets[0]!, reason: `package.json ${field}: ${name}`, confidence: 'confirmed' });
      }
    }
  }
  for (const contract of await declaredContracts(workspace)) for (const consumer of contract.consumers) if (consumer.repo !== contract.producer.repo) {
    edges.push({ from: consumer.repo, to: contract.producer.repo, reason: `declared contract: ${contract.id}`, confidence: 'confirmed' });
    sources.push(...contract.sources);
  }
  const pending = new Set(repos.map(x => x.id)), order: string[] = [];
  while (pending.size) {
    const ready = [...pending].filter(id => !edges.some(edge => edge.from === id && pending.has(edge.to)));
    if (!ready.length) break;
    for (const id of ready.sort()) { order.push(id); pending.delete(id); }
  }
  const affectedBy: Record<string, string[]> = Object.create(null);
  for (const repo of repos) {
    const affected = new Set<string>(); const frontier = [repo.id];
    while (frontier.length) {
      const current = frontier.shift()!;
      for (const edge of edges) if (edge.to === current && edge.from !== repo.id && !affected.has(edge.from)) {
        affected.add(edge.from); frontier.push(edge.from);
      }
    }
    affectedBy[repo.id] = [...affected].sort();
  }
  return { repos, edges, order, cycles: [...pending].sort(), affectedBy, sources };
}

export async function traceCode(workspace: Workspace, query: string, options: { repo?: string; maxFiles?: number; maxResults?: number; signal?: AbortSignal } = {}): Promise<ReadingResult> {
  const term = query.trim();
  if (!term || term.length > 160) throw new Error('Provide a symbol, interface, or short source query');
  const maxFiles = options.maxFiles ?? 160, maxResults = options.maxResults ?? 60;
  if (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > 1000) throw new Error('Invalid source reading budget');
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 1000) throw new Error('Invalid source result budget');
  const observation = await workspace.observe();
  if (options.signal?.aborted) throw new Error('Source reading cancelled');
  const fileCounts = await Promise.all(workspace.config.repos.map(repo => workspace.files(repo.id)));
  const pythonCount = fileCounts.flat().filter(file => file.endsWith('.py')).length;
  const typescriptCount = fileCounts.flat().filter(file => /\.[cm]?[jt]sx?$/.test(file)).length;
  const goCount = fileCounts.flat().filter(file => file.endsWith('.go')).length;
  const total = Math.max(1, pythonCount + typescriptCount + goCount);
  const goBudget = Math.min(goCount, Math.ceil(maxFiles * goCount / total));
  const go = goCount ? await analyzeGo(workspace, term, { repo: options.repo, maxFiles: goBudget, signal: options.signal }) : undefined;
  const remaining = Math.max(0, maxFiles - (go?.scannedFiles ?? 0));
  const pythonBudget = Math.min(pythonCount, Math.ceil(remaining * pythonCount / Math.max(1, pythonCount + typescriptCount)));
  const python = await analyzePython(workspace, term, { repo: options.repo, maxFiles: pythonBudget, signal: options.signal });
  if (options.signal?.aborted) throw new Error('Source reading cancelled');
  const typescript = await analyzeTypescript(workspace, term, { repo: options.repo, maxFiles: Math.max(0, remaining - python.scannedFiles), signal: options.signal });
  if (options.signal?.aborted) throw new Error('Source reading cancelled');
  const semantic = { symbols: [...typescript.symbols, ...python.symbols, ...go?.symbols ?? []], references: [...typescript.references, ...python.references, ...go?.references ?? []],
    imports: [...typescript.imports, ...python.imports, ...go?.imports ?? []], sources: [...typescript.sources, ...python.sources, ...go?.sources ?? []], scannedFiles: typescript.scannedFiles + python.scannedFiles + (go?.scannedFiles ?? 0),
    truncated: typescript.truncated || python.truncated || !!go?.truncated, diagnostics: [...typescript.diagnostics, ...python.diagnostics, ...go?.diagnostics ?? []],
    incremental: { reparsed: typescript.incremental.reparsed + python.incremental.reparsed, reused: typescript.incremental.reused + python.incremental.reused, reportedLanguages: ['TypeScript', 'JavaScript', 'Python'] },
    limitation: `${typescript.limitation} ${python.limitation} ${go?.limitation ?? ''}` };
  const nodes = new Map<string, { id: string; source: SourceLocation; role: string }>();
  const edges: { from: string; to: string; kind: string; confidence: string }[] = [];
  const add = (source: SourceLocation, role: string): string => {
    const id = `${source.repo}:${source.file}:${source.line}:${source.symbol}:${source.hash.slice(0, 12)}`;
    if (!nodes.has(id)) nodes.set(id, { id, source, role }); return id;
  };
  for (const symbol of semantic.symbols) add(symbol, 'definition');
  for (const reference of semantic.references) {
    const from = add(reference, reference.kind);
    if (reference.target) edges.push({ from, to: add(reference.target, 'definition'), kind: reference.kind, confidence: reference.confidence });
  }
  const visibleNodes = [...nodes.values()].slice(0, maxResults * 2);
  const visibleIds = new Set(visibleNodes.map(node => node.id));
  return { query: term, observation, supportedLanguages: ['TypeScript', 'JavaScript', 'Python', 'Go'], symbols: semantic.symbols.slice(0, maxResults),
    references: semantic.references.slice(0, Math.max(0, maxResults - semantic.symbols.length)), imports: semantic.imports.slice(0, maxResults * 2),
    sources: semantic.sources, scannedFiles: semantic.scannedFiles, incremental: semantic.incremental, sourceIndex: go?.sourceIndex, diagnostics: semantic.diagnostics,
    limitation: semantic.limitation, truncated: semantic.truncated || semantic.imports.length > maxResults * 2 || semantic.symbols.length + semantic.references.length > maxResults,
    followQueries: [...new Set(semantic.references.map(reference => reference.owner).filter((owner): owner is string => !!owner && owner !== query))].slice(0, 12),
    map: { nodes: visibleNodes, edges: edges.filter(edge => visibleIds.has(edge.from) && visibleIds.has(edge.to)).slice(0, maxResults) } };
}

export async function readSource(workspace: Workspace, repo: string, file: string, start = 1, end = start + 120): Promise<SourceLocation> {
  if (!Number.isInteger(start) || start < 1 || !Number.isInteger(end) || end < start || end - start > 400) throw new Error('Read at most 401 lines with valid line numbers');
  const path = await workspace.path(repo, file);
  if ((await stat(path)).size > 8_000_000) throw new Error('Source read exceeds the 8 MB file limit');
  const bytes = await readFile(path);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = text.split('\n');
  if (start > lines.length) throw new Error('Start line is outside the file');
  const selected = lines.slice(start - 1, end).join('\n');
  const snippet = selected.slice(0, 48_000);
  return { repo, file, line: start, endLine: Math.min(end, start + snippet.split('\n').length - 1), hash: hash(bytes), symbol: '', kind: 'source',
    snippet, truncated: selected.length > snippet.length };
}
