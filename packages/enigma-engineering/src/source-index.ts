import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Workspace } from './workspace.js';
import { ensureDir, hash, readJson, writeJson, redact } from './storage.js';

export interface IndexedSource { repo: string; file: string; hash: string; bytes: number; language: 'Go' | 'Python' | 'TypeScript'; terms: string[] }
interface Index { schema: 1; configuration: string; sources: IndexedSource[] }
const language = (file: string): IndexedSource['language'] | undefined => file.endsWith('.go') ? 'Go' : file.endsWith('.py') ? 'Python' : /\.[cm]?[jt]sx?$/.test(file) ? 'TypeScript' : undefined;

/** Rebuildable lexical navigation index; it never promotes text matches to semantic facts. */
export class SourceIndex {
  constructor(readonly workspace: Workspace) {}
  async refresh(options: { signal?: AbortSignal; maxFiles?: number } = {}) {
    const directory = await ensureDir(join(this.workspace.data, 'source-index'));
    let previous: Index | undefined;
    try {
      const value = await readJson<Index>(join(directory, 'index.json'));
      if (value.schema === 1 && Array.isArray(value.sources) && value.sources.every(item => typeof item.file === 'string' && typeof item.hash === 'string' && Array.isArray(item.terms))) previous = value;
    } catch (error) { if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const configuration = hash(JSON.stringify(this.workspace.config.repos));
    const old = new Map(previous?.configuration === configuration ? previous.sources.map(item => [`${item.repo}:${item.file}`, item]) : []);
    const sources: IndexedSource[] = []; const diagnostics: string[] = []; let reused = 0, refreshed = 0, bytes = 0, truncated = false;
    const maximum = options.maxFiles ?? 10_000;
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > 50_000) throw new Error('Invalid source index budget');
    for (const repo of this.workspace.config.repos) for (const file of await this.workspace.files(repo.id)) {
      if (options.signal?.aborted) throw new Error('Source index refresh cancelled');
      const kind = language(file); if (!kind) continue;
      if (sources.length >= maximum) { truncated = true; continue; }
      const path = await this.workspace.path(repo.id, file), size = (await stat(path)).size;
      if (size > 512_000 || bytes + size > 64_000_000) { truncated = true; continue; }
      const content = await readFile(path); bytes += content.length; const digest = hash(content);
      const saved = old.get(`${repo.id}:${file}`);
      if (saved?.hash === digest) { sources.push({ ...saved, terms: saved.terms.map(term => redact(term, this.workspace.secrets)) }); reused++; }
      else {
        let text: string;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(content); }
        catch { diagnostics.push(`Invalid UTF-8 source omitted: ${repo.id}:${file}`); truncated = true; continue; }
        const terms = [...new Set(text.match(/[\p{L}_$][\p{L}\p{N}_$]{1,100}/gu) ?? [])].slice(0, 6000);
        sources.push({ repo: repo.id, file, hash: digest, bytes: size, language: kind, terms: terms.map(term => redact(term, this.workspace.secrets)) }); refreshed++;
      }
    }
    if (options.signal?.aborted) throw new Error('Source index refresh cancelled');
    const index: Index = { schema: 1, configuration, sources };
    await writeJson(join(directory, 'index.json'), index);
    return { sources, reused, refreshed, truncated, diagnostics };
  }
  async select(query: string, options: { language?: IndexedSource['language']; maxFiles?: number; signal?: AbortSignal } = {}) {
    const index = await this.refresh({ signal: options.signal });
    const terms = query.match(/[\p{L}_$][\p{L}\p{N}_$]{1,100}/gu) ?? [];
    const ranked = index.sources.filter(item => !options.language || item.language === options.language).map(item => ({ ...item,
      score: terms.reduce((score, term) => score + (item.terms.includes(term) ? 4 : 0) + (item.file.includes(term) ? 2 : 0), 0) }));
    ranked.sort((a, b) => b.score - a.score || Number(/test|spec/.test(a.file)) - Number(/test|spec/.test(b.file)) || `${a.repo}:${a.file}`.localeCompare(`${b.repo}:${b.file}`));
    const maximum = options.maxFiles ?? 160;
    return { files: ranked.slice(0, maximum), candidates: ranked, total: ranked.length, truncated: index.truncated || ranked.length > maximum, reused: index.reused, refreshed: index.refreshed, diagnostics: index.diagnostics };
  }
}
