import { readFile, mkdir, writeFile, readdir, lstat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname, relative, resolve, sep, isAbsolute } from 'node:path';
import { createTwoFilesPatch } from 'diff';
import { Workspace, excluded } from './workspace.js';
import { git, runProcess } from './process.js';
import { hash, id, safeId, ensureDir, writeJson, readJson, redact } from './storage.js';
import { TaskReadingStore, type TaskReading } from './task-reading.js';
import type { Repo } from './types.js';
import { guardedArgv } from './execution-boundary.js';
const exec = promisify(execFile);

export interface ChangeReadingInput {
  kind: 'working' | 'staged' | 'commit' | 'merge-request';
  goal: string; task: string; base?: Record<string, string>; target?: Record<string, string>; url?: string;
}
interface FileContent { hash: string; mode: string; content?: string; omitted?: string }
export interface ChangeFile {
  repo: string; file: string; change: string; before?: FileContent; after?: FileContent; patch?: string;
}
export interface ChangeReading {
  schema: 1; id: string; createdAt: string; input: ChangeReadingInput; version: string;
  repositories: { id: string; base: string; target: string }[];
  changes: ChangeFile[]; reading?: TaskReading; status: 'captured' | 'reading' | 'ready' | 'failed';
  error?: string; gaps: string[]; sourceRoot: string; observation: Awaited<ReturnType<Workspace['observe']>>;
  targetMatchesWorkspace: boolean;
}

/** One immutable source version is shared by the complete diff and semantic reading. */
export class ChangeReadings {
  constructor(readonly workspace: Workspace) {}
  private async directory() { return ensureDir(join(this.workspace.data, 'change-readings')); }
  private async path(record: string) { return join(await this.directory(), `${safeId(record)}.json`); }
  private async revision(repo: Repo, value: string | undefined, fallback: string) {
    const ref = value || fallback;
    if (ref.length > 160 || ref.startsWith('-') || ref.includes('\0')) throw new Error('Invalid Git revision');
    const result = await runProcess(['git', 'rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], repo.root, { internalGit: true, timeoutMs: 5000 });
    if (result.status !== 'passed') {
      if (!value && ['HEAD', 'HEAD^'].includes(fallback)) return '';
      throw new Error(`Cannot resolve ${repo.id} revision ${ref}`);
    }
    const oid = result.output.trim(); if (!/^[a-f0-9]{40,64}$/.test(oid)) throw new Error('Invalid Git object identity'); return oid;
  }
  private async tree(repo: Repo, revision: string | undefined, working: boolean, gaps: string[], signal?: AbortSignal) {
    const files: Record<string, FileContent> = Object.create(null);
    const entries = working ? (await this.workspace.files(repo.id)).map(file => ({ file, mode: '100644', oid: '' }))
      : revision === undefined ? (await git(repo.root, ['ls-files', '--stage', '-z'])).split('\0').filter(Boolean).map(item => {
        const match = /^(\d+) ([a-f0-9]+) (\d)\t(.+)$/.exec(item); if (!match || match[3] !== '0') throw new Error(`Unmerged index in ${repo.id}`);
        return { file: match[4]!, mode: match[1]!, oid: match[2]! };
      }) : revision ? (await git(repo.root, ['ls-tree', '-r', '-z', revision])).split('\0').filter(Boolean).map(item => {
        const match = /^(\d+) (\w+) ([a-f0-9]+)\t(.+)$/.exec(item); if (!match) throw new Error('Invalid Git tree');
        return { file: match[4]!, mode: match[1]!, oid: match[3]! };
      }) : [];
    if (entries.length > 50000) throw new Error('Change source exceeds the file budget');
    let total = 0;
    for (const entry of entries) {
      signal?.throwIfAborted(); if (excluded(entry.file)) continue;
      const path = await this.workspace.path(repo.id, entry.file);
      if (!working && !['100644', '100755'].includes(entry.mode)) { files[entry.file] = { hash: entry.oid, mode: entry.mode, omitted: 'Nonregular Git object; retained in diff metadata only' }; continue; }
      let bytes: Buffer;
      if (working) {
        try {
          const stat = await lstat(path); if (!stat.isFile()) throw new Error('Change reading requires regular source files');
          entry.mode = stat.mode & 0o111 ? '100755' : '100644'; bytes = await readFile(path);
        } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
      } else {
        const argv = guardedArgv(['git', 'cat-file', 'blob', entry.oid], true);
        try { bytes = (await exec(argv[0]!, argv.slice(1), { cwd: repo.root, signal, timeout: 5000, maxBuffer: 512000, encoding: 'buffer' })).stdout; }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') { files[entry.file] = { hash: entry.oid, mode: entry.mode, omitted: 'File exceeds reading budget' }; gaps.push(`${repo.id}:${entry.file}: reading budget`); continue; }
          throw error;
        }
      }
      total += bytes.length;
      const digest = hash(bytes);
      let content: string | undefined, omitted: string | undefined;
      if (bytes.includes(0) || bytes.length > 512000 || total > 64000000) omitted = 'Binary or source reading budget exceeded';
      else { try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { omitted = 'Non-UTF8 source'; } }
      if (omitted) gaps.push(`${repo.id}:${entry.file}: ${omitted}`);
      files[entry.file] = { hash: digest, mode: entry.mode, content, omitted };
    }
    return files;
  }
  async capture(input: ChangeReadingInput, signal?: AbortSignal) {
    if (!input.goal?.trim() || input.goal.length > 4000 || !['working', 'staged', 'commit', 'merge-request'].includes(input.kind)) throw new Error('Provide a change source and goal');
    safeId(input.task);
    if (input.kind === 'merge-request' && (!input.url || !input.base || !input.target)) throw new Error('MR reading needs its URL and exact per-repository base/target revisions');
    return this.workspace.exclusive(async () => {
      const observation = await this.workspace.observe(), recordId = id('change-reading'), gaps: string[] = [], changes: ChangeFile[] = [];
      const repositories: ChangeReading['repositories'] = [], trees: { repo: Repo; files: Record<string, FileContent> }[] = [];
      for (const repo of this.workspace.config.repos) {
        const base = await this.revision(repo, input.base?.[repo.id], input.kind === 'commit' ? 'HEAD^' : 'HEAD');
        const target = input.kind === 'commit' || input.kind === 'merge-request' ? await this.revision(repo, input.target?.[repo.id], 'HEAD') : undefined;
        const before = await this.tree(repo, base, false, gaps, signal), after = await this.tree(repo, target, input.kind === 'working', gaps, signal);
        repositories.push({ id: repo.id, base, target: target ?? (input.kind === 'staged' ? 'index' : 'working') }); trees.push({ repo, files: after });
        for (const file of new Set([...Object.keys(before), ...Object.keys(after)])) {
          const a = before[file], b = after[file];
          if (a?.content !== undefined && b?.content !== undefined ? a.content === b.content && a.mode === b.mode : a?.hash === b?.hash && a?.mode === b?.mode) continue;
          const text = (!a || a.content !== undefined) && (!b || b.content !== undefined);
          const patch = text ? createTwoFilesPatch(`${repo.id}/${file}`, `${repo.id}/${file}`, a?.content ?? '', b?.content ?? '').slice(0, 120000) : undefined;
          changes.push({ repo: repo.id, file, change: !a ? 'added' : !b ? 'deleted' : 'modified', before: a, after: b, patch });
        }
      }
      signal?.throwIfAborted();
      const sourceRoot = join(await this.directory(), recordId, 'source'); await mkdir(sourceRoot, { recursive: true });
      const frozen = await Workspace.open(sourceRoot);
      let common = this.workspace.config.repos[0]?.root ?? this.workspace.root;
      while (!this.workspace.config.repos.every(repo => { const r = relative(common, repo.root); return r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r); })) common = dirname(common);
      for (const tree of trees) {
        const repoRoot = join(sourceRoot, 'repos', relative(common, tree.repo.root) || tree.repo.id); await mkdir(repoRoot, { recursive: true });
        await git(repoRoot, ['init', '-q']);
        await frozen.addRepo(tree.repo.id, repoRoot, { access: 'read', role: tree.repo.role });
        for (const [file, value] of Object.entries(tree.files)) if (value.content !== undefined) {
          const target = resolve(repoRoot, file); if (!target.startsWith(repoRoot + sep)) throw new Error('Frozen source path escapes repository');
          await mkdir(dirname(target), { recursive: true }); await writeFile(target, value.content, { mode: value.mode === '100755' ? 0o755 : 0o644 });
        }
      }
      for (const repo of this.workspace.config.repos) await frozen.setDependencies(repo.id, repo.dependsOn);
      for (const check of this.workspace.config.checks) await frozen.addCheck(check);
      let targetMatchesWorkspace = true;
      for (const tree of trees) {
        const current = await this.workspace.snapshotRepo(tree.repo.id, false);
        if (Object.keys(current.files).length !== Object.keys(tree.files).length || Object.entries(tree.files).some(([file, value]) => current.files[file]?.hash !== value.hash)) targetMatchesWorkspace = false;
      }
      const version = hash(JSON.stringify({ repositories, trees: trees.map(tree => ({ repo: tree.repo.id, files: tree.files })), checks: this.workspace.config.checks }));
      const record: ChangeReading = { schema: 1, id: recordId, createdAt: new Date().toISOString(), input, version, repositories, changes,
        status: 'captured', gaps: [...new Set(gaps)], sourceRoot, observation, targetMatchesWorkspace };
      const final = await this.workspace.observe();
      if (JSON.stringify(final) !== JSON.stringify(observation)) throw new Error('Workspace changed during change capture; retry with the current version');
      await writeJson(await this.path(record.id), JSON.parse(redact(JSON.stringify(record), this.workspace.secrets)));
      await writeJson(join(await this.directory(), `latest-${safeId(input.task)}.json`), { id: record.id }); return record;
    });
  }
  async build(input: ChangeReadingInput, options: { signal?: AbortSignal; explain?: (report: TaskReading, changes: ChangeFile[]) => Promise<Parameters<TaskReadingStore['annotate']>[2]> } = {}) {
    const record = await this.capture(input, options.signal);
    try {
      record.status = 'reading'; await writeJson(await this.path(record.id), record);
      const frozen = await Workspace.open(record.sourceRoot), store = new TaskReadingStore(frozen);
      const report = await store.build({ goal: input.goal, task: input.task, expectedRepos: [...new Set(record.changes.map(file => file.repo))],
        changes: record.changes.map(({ before: _before, after: _after, ...change }) => change), maxQueries: 20 }, options.signal);
      record.reading=report;
      record.reading = options.explain && report.nodes.length ? await store.annotate(report.id, report.revision, await options.explain(report, record.changes), input.task) : report;
      record.gaps.push(...record.reading.gaps); record.status = 'ready';
    } catch (error) { record.status = 'failed'; record.error = redact(String(error), this.workspace.secrets); }
    await writeJson(await this.path(record.id), record); return record;
  }
  async open(recordId: string, task: string) {
    const record = await readJson<ChangeReading>(await this.path(recordId));
    if (record.schema !== 1 || record.input.task !== task) throw new Error('Change reading belongs to another task');
    const matchesWorkspace = record.targetMatchesWorkspace && JSON.stringify(await this.workspace.observe()) === JSON.stringify(record.observation);
    return { record, matchesWorkspace, immutable: true };
  }
  async latest(task: string) {
    try { const pointer = await readJson<{ id: string }>(join(await this.directory(), `latest-${safeId(task)}.json`)); return this.open(pointer.id, task); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  async list(task: string) {
    const records: ChangeReading[] = [];
    for (const file of await readdir(await this.directory())) if (file.startsWith('change-reading-') && file.endsWith('.json')) {
      const record = await readJson<ChangeReading>(join(await this.directory(), file)); if (record.input.task === task) records.push(record);
    }
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30).map(({ reading: _reading, changes: _changes, ...record }) => record);
  }
}
