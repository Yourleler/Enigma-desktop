import { readFile, realpath, lstat, readdir, writeFile, stat } from 'node:fs/promises';
import { join, relative, isAbsolute, extname, dirname } from 'node:path';
import type { Workspace } from './workspace.js';
import type { Observation } from './types.js';
import { ensureDir, hash, id, readJson, writeJson, redact, safeId } from './storage.js';

export interface ArtifactInput { title: string; kind: 'document' | 'code' | 'report' | 'screenshot' | 'trace' | 'package'; task?: string; entry?: string; repo?: string; file?: string; runtime?: string; evidence?: string[] }
export interface ArtifactRecord {
  schema: 1; id: string; title: string; kind: ArtifactInput['kind']; task?: string; entry?: string; createdAt: string;
  hash: string; bytes: number; extension: string; origin: { repo?: string; file?: string; runtime?: string; originalHash: string }; observation: Observation; evidence: string[];
}
export class Artifacts {
  constructor(readonly workspace: Workspace) {}
  private async directory() { return await ensureDir(join(this.workspace.data, 'artifacts')); }
  private async origin(input: ArtifactInput) {
    if (input.repo && input.file && !input.runtime) return await this.workspace.path(input.repo, input.file);
    if (!input.runtime || input.repo || input.file) throw new Error('Artifact needs one registered repo file or runtime path');
    const target = join(this.workspace.data, input.runtime), rel = relative(this.workspace.data, target);
    if (isAbsolute(rel) || rel.startsWith('..') || !['browser-runs', 'reviews', 'evidence', 'handoffs', 'packages', 'runs', 'delegations', 'merge-previews', 'recipe-runs', 'recipe-proposals'].includes(rel.split(/[\\/]/)[0]!)) throw new Error('Runtime artifact source is outside approved result directories');
    for (let cursor = target; cursor !== this.workspace.data; cursor = dirname(cursor)) if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Artifact source cannot traverse symlinks');
    const canonical = await realpath(target); if (relative(this.workspace.data, canonical).startsWith('..')) throw new Error('Artifact source escapes workspace'); return canonical;
  }
  async add(input: ArtifactInput) {
    if (!input.title?.trim() || input.title.length > 200 || !['document', 'code', 'report', 'screenshot', 'trace', 'package'].includes(input.kind) || (input.evidence?.length ?? 0) > 30) throw new Error('Invalid artifact input');
    if (input.task) safeId(input.task); if (input.entry) safeId(input.entry);
    return await this.workspace.exclusive(async () => {
      const source = await this.origin(input); if ((await stat(source)).size > 32_000_000) throw new Error('Artifact exceeds the 32 MB budget'); const original = await readFile(source);
      let content = original;
      if (['document', 'code', 'report'].includes(input.kind)) content = Buffer.from(redact(new TextDecoder('utf-8', { fatal: true }).decode(original), this.workspace.secrets));
      const directory = await this.directory(), digest = hash(content);
      await writeFile(join(await ensureDir(join(directory, 'blobs')), digest), content, { mode: 0o600, flag: 'wx' }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; });
      if (hash(await readFile(join(directory, 'blobs', digest))) !== digest) throw new Error('Existing artifact blob is corrupt');
      const record: ArtifactRecord = { schema: 1, id: id('artifact'), title: redact(input.title, this.workspace.secrets), kind: input.kind, task: input.task, entry: input.entry,
        hash: digest, bytes: content.length, extension: extname(source), origin: { repo: input.repo, file: input.file, runtime: input.runtime, originalHash: hash(original) },
        observation: await this.workspace.observe(), createdAt: new Date().toISOString(), evidence: input.evidence ?? [] };
      for (const evidence of record.evidence) await this.workspace.evidenceStatus(evidence);
      await writeJson(join(directory, `${record.id}.json`), record); return record;
    });
  }
  private async metadata(artifact: string, task?: string) {
    const record = await readJson<ArtifactRecord>(join(await this.directory(), `${safeId(artifact)}.json`));
    if (record.schema !== 1 || record.id !== artifact || !/^[a-f0-9]{64}$/.test(record.hash) || typeof record.title !== 'string'
      || !Number.isSafeInteger(record.bytes) || record.bytes < 0 || record.bytes > 32_000_000 || !Array.isArray(record.evidence)) throw new Error('Invalid artifact record');
    if (task && record.task && record.task !== task) throw new Error('Artifact belongs to another task');
    return record;
  }
  async read(artifact: string, task?: string) {
    const record = await this.metadata(artifact, task);
    const path = join(await this.directory(), 'blobs', record.hash), bytes = await readFile(path);
    if (hash(bytes) !== record.hash || bytes.length !== record.bytes) throw new Error('Artifact blob integrity mismatch');
    let sourceCurrent = false;
    try { const source = await this.origin({ ...record, ...record.origin }); sourceCurrent = hash(await readFile(source)) === record.origin.originalHash; } catch { /* Missing source leaves the immutable result available as historical. */ }
    const evidence = await Promise.all(record.evidence.map(async id => {
      try { const value = await this.workspace.evidenceStatus(id); return { id, current: value.valid }; }
      catch { return { id, current: false, issue: '验收依据不可读取，不能视为当前有效证据。' }; }
    }));
    return { record, path, sourceCurrent, evidence, note: 'Saved bytes are an immutable result version. Source/evidence freshness is checked independently; screenshots/traces may contain application secrets and remain local.' };
  }
  async list(task?: string) {
    return (await this.catalog(task)).items;
  }
  async catalog(task?: string) {
    const directory = await this.directory(), records = [], unavailable: { id?: string; title: string; reason: string }[] = [];
    for (const file of await readdir(directory)) if (file.endsWith('.json')) {
      let record: ArtifactRecord | undefined;
      try { record = await this.metadata(file.slice(0, -5), task); records.push(await this.read(record.id, task)); }
      catch (error) {
        if (String(error).includes('another task')) continue;
        unavailable.push(record ? { id: record.id, title: record.title, reason: (error as NodeJS.ErrnoException).code === 'ENOENT' ? '保存的文件已不在原位置，请从来源重新登记。' : '保存的文件无法读取或校验未通过，请核对原始来源。' }
          : { title: '有成果记录无法读取', reason: '记录信息不完整，无法确认其来源与所属任务。' });
      }
    }
    return { items: records.sort((a, b) => a.record.createdAt.localeCompare(b.record.createdAt)), unavailable };
  }
}
