import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import type { Workspace } from './workspace.js';
import { hash, ensureDir, readJson, writeJson, redact } from './storage.js';
import { traceCode, readSource, type ReadingResult } from './reading.js';
import { runProcess } from './process.js';

const implementation = Promise.all(['reading-store.js', 'reading.js', 'typescript-reader.js', 'python-reader.js', 'go-reader.js', 'language-server.js', 'source-index.js', 'schema-reading.js', 'contracts.js', 'workspace.js', 'storage.js', 'task-reading.js', 'project-context.js', '../../package.json']
  .map(async file => ({ file, hash: hash(await readFile(new URL(file, import.meta.url))) }))).then(files => hash(JSON.stringify({ files, typescript: ts.version, node: process.version })));

/** Atomic publication leaves the last usable reading intact while analysis runs or fails. */
export class ReadingStore {
  constructor(readonly workspace: Workspace) {}
  private directory(query: string, repo?: string): string { return join(this.workspace.data, 'readings', hash(JSON.stringify({ query: query.trim(), repo: repo ?? null }))); }
  async readerVersion(signal?: AbortSignal) {
    const hasGo = (await Promise.all(this.workspace.config.repos.map(repo => this.workspace.files(repo.id)))).some(files => files.some(file => file.endsWith('.go')));
    const tools = hasGo ? await Promise.all([
      runProcess([process.env.ENIGMA_GOPLS ?? 'gopls', 'version'], this.workspace.root, { signal, timeoutMs: 5000 }),
      runProcess(['go', 'version'], this.workspace.root, { signal, timeoutMs: 5000, env: { ...process.env, GOTOOLCHAIN: 'local' } }),
      runProcess(['go', 'env', '-json', 'GOFLAGS', 'GOOS', 'GOARCH', 'GOPATH'], this.workspace.root, { signal, timeoutMs: 5000, env: { ...process.env, GOTOOLCHAIN: 'local', GOWORK: 'off', CGO_ENABLED: '0', GOENV: 'off', GOFLAGS: '-mod=readonly' } }),
    ]) : [];
    if (signal?.aborted) throw new Error('Source reading cancelled');
    return hash(JSON.stringify({ implementation: await implementation, tools: tools.map(tool => ({ status: tool.status, output: tool.output })) }));
  }
  async update(query: string, options: { repo?: string; maxFiles?: number; signal?: AbortSignal } = {}) {
    const directory = await ensureDir(this.directory(query, options.repo));
    await writeJson(join(directory, 'state.json'), { status: 'running', startedAt: new Date().toISOString() });
    try {
      if (options.signal?.aborted) throw new Error('Source reading cancelled');
      const reader = await this.readerVersion(options.signal);
      try {
        const previous = await readJson<{ reader?: string; budget?: number; evidence: string; reading: ReadingResult }>(join(directory, 'current.json'));
        const checked = await this.workspace.evidenceStatus(previous.evidence);
        if (previous.reader === reader && previous.reading.query === query.trim() && previous.budget === (options.maxFiles ?? 160) && checked.valid && checked.entry.kind === 'reading') {
          if (hash(JSON.stringify(previous.reading)) !== hash(JSON.stringify(checked.entry.data))) throw new Error('Published reading does not match its source evidence');
          if (options.signal?.aborted) throw new Error('Source reading cancelled');
          await writeJson(join(directory, 'state.json'), { status: 'published', evidence: previous.evidence, reused: true });
          return { ...previous.reading, evidence: previous.evidence, reused: true,queryRepo:options.repo };
        }
      } catch (error) { if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const reading = await traceCode(this.workspace, query, options);
      const evidence = await this.workspace.evidence('reading', reading);
      if (!evidence.validAtCapture) throw new Error('Reading source changed during analysis; previous publication retained');
      const artifact = { schema: 1, publishedAt: new Date().toISOString(), reader, budget: options.maxFiles ?? 160, evidence: evidence.id, reading };
      await writeJson(join(directory, 'current.json'), JSON.parse(redact(JSON.stringify(artifact), this.workspace.secrets)));
      await writeJson(join(directory, 'state.json'), { status: 'published', evidence: evidence.id });
      return { ...reading, evidence: evidence.id,queryRepo:options.repo };
    } catch (error) {
      await writeJson(join(directory, 'state.json'), { status: options.signal?.aborted ? 'cancelled' : 'failed', error: redact(String(error), this.workspace.secrets) }); throw error;
    }
  }
  async open(query: string, options: { repo?: string; node?: string } = {}) {
    const directory = this.directory(query, options.repo);
    const artifact = await readJson<{ schema: number; reader?: string; publishedAt: string; evidence: string; reading: ReadingResult }>(join(directory, 'current.json'));
    if (artifact.schema !== 1 || artifact.reading.query !== query.trim()) throw new Error('Invalid reading artifact');
    const state = await readJson<{ status: string; error?: string }>(join(directory, 'state.json')).catch(()=>({status:'unknown'}));
    let validity:Awaited<ReturnType<Workspace['evidenceStatus']>>|undefined;const issues:string[]=[];
    try{validity=await this.workspace.evidenceStatus(artifact.evidence);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;issues.push('原阅读证据暂不可读取，仅保留历史结果。');}
    if (validity&&hash(JSON.stringify(artifact.reading)) !== hash(JSON.stringify(validity.entry.data))) throw new Error('Published reading does not match its source evidence');
    const readerCurrent = artifact.reader === await this.readerVersion(), current = !!validity?.valid && readerCurrent;
    if (!options.node) return { ...artifact,queryRepo:options.repo, state, current, readerCurrent, sourceCurrent: !!validity?.valid,issues, note: 'Published source facts retain their source and reader version. Read actual code and revalidate if current is false.' };
    const node = artifact.reading.map?.nodes.find(node => node.id === options.node); if (!node) throw new Error('Reading map node was not published');
    let source:Awaited<ReturnType<typeof readSource>>|null=null;
    try{source=await readSource(this.workspace, node.source.repo, node.source.file, node.source.line, Math.min(node.source.endLine, node.source.line + 300));}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'&&(error as Error).message!=='Start line is outside the file')throw error;issues.push('当前文件已移除或原行号已不存在，保存的片段仍可查看。');}
    return { source, matchesPublishedSource: source?.hash === node.source.hash, published: node, state, current, readerCurrent,issues,query:query.trim(),queryRepo:options.repo };
  }
}
