import { readFile, mkdir, writeFile, readdir, lstat } from 'node:fs/promises';
import { join, dirname, relative, resolve, sep, isAbsolute } from 'node:path';
import { createTwoFilesPatch } from 'diff';
import { Workspace, excluded } from './workspace.js';
import { git, runProcess } from './process.js';
import { hash, id, safeId, ensureDir, writeJson, readJson, redact } from './storage.js';
import { TaskReadingStore, type TaskReading } from './task-reading.js';
import type { Repo } from './types.js';
import { readGitBlobs } from './git-blobs.js';
import {emitActivity,measured} from './telemetry.js';

export interface ChangeReadingInput {
  kind: 'working' | 'staged' | 'unstaged' | 'commit' | 'merge-request';
  goal: string; task: string; base?: Record<string, string>; target?: Record<string, string>; url?: string;
}
interface FileContent { hash: string; mode: string; content?: string; omitted?: string }
export interface ChangeFile {
  repo: string; file: string; change: string; before?: FileContent; after?: FileContent; patch?: string;
  patchTruncated?: boolean;
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
    // Explicit empty base is used when inspecting a repository's first commit.
    if(value==='')return '';
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
        const match = /^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/.exec(item); if (!match || match[3] !== '0') throw new Error(`Unmerged index in ${repo.id}`);
        return { file: match[4]!, mode: match[1]!, oid: match[2]! };
      }) : revision ? (await git(repo.root, ['ls-tree', '-r', '-z', revision])).split('\0').filter(Boolean).map(item => {
        const match = /^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/.exec(item); if (!match) throw new Error('Invalid Git tree');
        return { file: match[4]!, mode: match[1]!, oid: match[3]! };
      }) : [];
    if (entries.length > 50000) throw new Error('Change source exceeds the file budget');
    const blobs = working ? undefined : readGitBlobs(repo.root, entries.filter(entry => !excluded(entry.file) && ['100644','100755'].includes(entry.mode)).map(entry => entry.oid), {signal});
    let total = 0;
    try {
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
        const next = await blobs!.next();
        if(next.done || next.value.oid !== entry.oid)throw new Error('Git blob sequence does not match source tree');
        if(!next.value.bytes) { files[entry.file] = { hash: entry.oid, mode: entry.mode, omitted: 'File exceeds reading budget' }; gaps.push(`${repo.id}:${entry.file}: reading budget`); continue; }
        bytes = next.value.bytes;
      }
      total += bytes.length;
      const digest = hash(bytes);
      let content: string | undefined, omitted: string | undefined;
      if (bytes.includes(0) || bytes.length > 512000 || total > 64000000) omitted = 'Binary or source reading budget exceeded';
      else { try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { omitted = 'Non-UTF8 source'; } }
      if (omitted) gaps.push(`${repo.id}:${entry.file}: ${omitted}`);
      files[entry.file] = { hash: digest, mode: entry.mode, content, omitted };
    }
    if(blobs && !(await blobs.next()).done)throw new Error('Unexpected Git blobs after source tree');
    } finally { await blobs?.return(undefined); }
    return files;
  }
  async capture(input: ChangeReadingInput, signal?: AbortSignal) {
    if (!input.goal?.trim() || input.goal.length > 4000 || !['working', 'staged', 'unstaged', 'commit', 'merge-request'].includes(input.kind)) throw new Error('Provide a change source and goal');
    safeId(input.task);
    if (input.kind === 'merge-request' && (!input.url || !input.base || !input.target)) throw new Error('MR reading needs its URL and exact per-repository base/target revisions');
    return measured('reading.capture',{detail:'正在冻结变更来源与源码版本'},()=>this.workspace.exclusive(async () => {
      const observation = await this.workspace.observe(), recordId = id('change-reading'), gaps: string[] = [], changes: ChangeFile[] = [];
      const repositories: ChangeReading['repositories'] = [], trees: { repo: Repo; files: Record<string, FileContent> }[] = [];
      for (const repo of this.workspace.config.repos) {
        emitActivity({kind:'update',stage:'reading.capture',repo:repo.id,detail:`正在读取 ${repo.id} 的前后版本`},this.workspace.activity);
        const base = await this.revision(repo, input.base?.[repo.id], input.kind === 'commit' ? 'HEAD^' : 'HEAD');
        const target = input.kind === 'commit' || input.kind === 'merge-request' ? await this.revision(repo, input.target?.[repo.id], 'HEAD') : undefined;
        const before = await this.tree(repo, input.kind==='unstaged'?undefined:base, false, gaps, signal), after = await this.tree(repo, target, (input.kind === 'working'||input.kind==='unstaged'), gaps, signal);
        repositories.push({ id: repo.id, base:input.kind==='unstaged'?'index':base, target: target ?? (input.kind === 'staged' ? 'index' : 'working') }); trees.push({ repo, files: after });
        for (const file of new Set([...Object.keys(before), ...Object.keys(after)])) {
          const a = before[file], b = after[file];
          if (a?.content !== undefined && b?.content !== undefined ? a.content === b.content && a.mode === b.mode : a?.hash === b?.hash && a?.mode === b?.mode) continue;
          const text = (!a || a.content !== undefined) && (!b || b.content !== undefined);
          const fullPatch = text ? createTwoFilesPatch(`${repo.id}/${file}`, `${repo.id}/${file}`, a?.content ?? '', b?.content ?? '') : undefined;
          const patchTruncated=fullPatch!==undefined&&fullPatch.length>120000;
          if(patchTruncated)gaps.push(`${repo.id}:${file}: 差异预览超过显示上限；保存的前后完整文本仍可用于重新生成。`);
          changes.push({ repo: repo.id, file, change: !a ? 'added' : !b ? 'deleted' : 'modified', before: a, after: b, patch:fullPatch?.slice(0,120000),...(patchTruncated?{patchTruncated:true}:{}) });
        }
      }
      signal?.throwIfAborted();
      const sourceRoot = join(await this.directory(), recordId, 'source'); await mkdir(sourceRoot, { recursive: true });
      const frozen = await Workspace.open(sourceRoot);frozen.activity=this.workspace.activity;
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
        if (Object.keys(current.files).length !== Object.keys(tree.files).length || Object.entries(tree.files).some(([file, value]) => current.files[file]?.hash !== value.hash||current.files[file]?.mode!==(parseInt(value.mode,8)&0o777))) targetMatchesWorkspace = false;
      }
      const version = hash(JSON.stringify({ repositories, trees: trees.map(tree => ({ repo: tree.repo.id, files: tree.files })), checks: this.workspace.config.checks }));
      const record: ChangeReading = { schema: 1, id: recordId, createdAt: new Date().toISOString(), input, version, repositories, changes,
        status: 'captured', gaps: [...new Set(gaps)], sourceRoot, observation, targetMatchesWorkspace };
      const final = await this.workspace.observe();
      if (JSON.stringify(final) !== JSON.stringify(observation)) throw new Error('Workspace changed during change capture; retry with the current version');
      await writeJson(await this.path(record.id), JSON.parse(redact(JSON.stringify(record), this.workspace.secrets)));
      await writeJson(join(await this.directory(), `latest-${safeId(input.task)}.json`), { id: record.id }); return record;
    }),this.workspace.activity);
  }
  async build(input: ChangeReadingInput, options: { signal?: AbortSignal; explain?: (report: TaskReading, changes: ChangeFile[]) => Promise<Parameters<TaskReadingStore['annotate']>[2]> } = {}) {
    const record = await this.capture(input, options.signal);
    try {
      record.status = 'reading'; await writeJson(await this.path(record.id), record);
      const frozen = await Workspace.open(record.sourceRoot);frozen.activity=this.workspace.activity;const store = new TaskReadingStore(frozen);
      const report = await measured('reading.analyze',{detail:`分析 ${record.changes.length} 个变更文件的源码关系`},()=>store.build({ goal: input.goal, task: input.task, expectedRepos: [...new Set(record.changes.map(file => file.repo))],
        changes: record.changes.map(({ before: _before, after: _after, ...change }) => change), maxQueries: 20 }, options.signal),this.workspace.activity);
      record.reading=report;
      record.reading = options.explain && report.nodes.length ? await measured('reading.explain',{detail:'根据已冻结的源码节点生成讲解'},async()=>store.annotate(report.id, report.revision, await options.explain!(report, record.changes), input.task),this.workspace.activity) : report;
      record.gaps.push(...record.reading.gaps); record.status = 'ready';
    } catch (error) { record.status = 'failed'; record.error = redact(String(error), this.workspace.secrets); }
    await writeJson(await this.path(record.id), record); return record;
  }
  async open(recordId: string, task: string) {
    const record = await readJson<ChangeReading>(await this.path(recordId));
    if (record.schema !== 1 || record.input.task !== task) throw new Error('Change reading belongs to another task');
    const observation=await this.workspace.observe();
    const sourceMatchesWorkspace=record.targetMatchesWorkspace&&JSON.stringify(observation.fingerprints)===JSON.stringify(record.observation.fingerprints);
    const configurationMatches=observation.configuration===record.observation.configuration,environmentMatches=observation.environment===record.observation.environment;
    return { record, matchesWorkspace:sourceMatchesWorkspace&&configurationMatches&&environmentMatches, sourceMatchesWorkspace,configurationMatches,environmentMatches, immutable: true };
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
