import { assertBoundaryPath } from './execution-boundary.js';
import { chmod, link, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createTwoFilesPatch } from 'diff';
import { git, runProcess } from './process.js';
import { ensureDir, hash, id, readJson, redact, safeId, storePath, writeJson } from './storage.js';
import type { Access, Check, Checkpoint, Evidence, FileVersion, ForkHandoff, Observation, OperationRecord, Repo, RepoSnapshot, WorkspaceConfig } from './types.js';
import { emitActivity, measured, type ActivitySink } from './telemetry.js';

const excluded = (path: string): boolean => path.split('/').some(part => ['.git', '.enigma-next', 'node_modules', '.venv', '__pycache__'].includes(part))
  || /(^|\/)(\.env(?:\..*)?|.*\.(?:pem|key))$/.test(path);
const inside = (root: string, path: string): boolean => path === root || (!relative(root, path).startsWith(`..${sep}`)
  && relative(root, path) !== '..' && !isAbsolute(relative(root, path)));
const errorCode = (err: unknown): string | undefined => err && typeof err === 'object' ? (err as NodeJS.ErrnoException).code : undefined;
const equalFiles = (a: Record<string, FileVersion>, b: Record<string, FileVersion>) => {
  const ordered = (files: Record<string, FileVersion>) => Object.entries(files).sort(([left], [right]) => left.localeCompare(right)).map(([file, value]) => [file, value.hash, value.mode]);
  return JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
};

function validateConfig(config: WorkspaceConfig): WorkspaceConfig {
  if (!config || config.schema !== 1 || !Array.isArray(config.repos) || !Array.isArray(config.checks)) throw new Error('Unsupported workspace configuration');
  const ids = new Set<string>();
  for (const repo of config.repos) {
    safeId(repo.id);
    if (ids.has(repo.id) || typeof repo.root !== 'string' || !isAbsolute(repo.root) || typeof repo.role !== 'string'
      || !['read', 'write'].includes(repo.access) || !Array.isArray(repo.dependsOn) || repo.dependsOn.some(id => typeof id !== 'string')) throw new Error('Invalid repository configuration');
    ids.add(repo.id);
  }
  for (const repo of config.repos) for (const dep of repo.dependsOn) if (!ids.has(dep) || dep === repo.id) throw new Error('Invalid repository dependency');
  for (let i = 0; i < config.repos.length; i++) for (let j = i + 1; j < config.repos.length; j++) {
    const a = config.repos[i]!, b = config.repos[j]!;
    if (inside(a.root, b.root) || inside(b.root, a.root)) throw new Error('Repository roots overlap');
  }
  const checks = new Set<string>();
  for (const check of config.checks) {
    safeId(check.id);
    if (checks.has(check.id) || !ids.has(check.repo) || !Array.isArray(check.argv) || !check.argv.length
      || check.argv.some(arg => typeof arg !== 'string' || arg.includes('\0'))
      || (check.timeoutMs !== undefined && (!Number.isInteger(check.timeoutMs) || check.timeoutMs < 1 || check.timeoutMs > 3_600_000))) throw new Error('Invalid acceptance configuration');
    checks.add(check.id);
  }
  return config;
}
async function acquireLock(path: string): Promise<string> {
  const token = id('lock'), temporary = `${path}.${token}.tmp`;
  try {
    await writeJson(temporary, { pid: process.pid, token, createdAt: new Date().toISOString() });
    // Publish a complete owner record atomically; a killed writer cannot leave an empty lock.
    await link(temporary, path);
    return token;
  } finally { await rm(temporary, { force: true }); }
}
async function releaseLock(path: string, token: string): Promise<void> {
  try { if ((await readJson<{ token?: string }>(path)).token === token) await rm(path); }
  catch (err) { if (errorCode(err) !== 'ENOENT') throw err; }
}

export class Workspace {
  pathPolicy?: (file: string, access: Access) => void;
  readonly data: string;
  config: WorkspaceConfig;
  readonly secrets: string[];
  private locked = false;
  activity?: ActivitySink;
  private constructor(readonly root: string, config: WorkspaceConfig) {
    this.data = join(root, '.enigma-next'); this.config = config;
    this.secrets = Object.entries(process.env).filter(([key]) => /KEY|TOKEN|SECRET|PASSWORD/.test(key))
      .map(([, value]) => value ?? '').filter(value => value.length >= 8);
  }
  static async open(root: string): Promise<Workspace> {
    const canonical = await realpath(root);
    const data = await ensureDir(join(canonical, '.enigma-next'));
    for (const dir of ['blobs', 'checkpoints', 'evidence', 'operations']) await ensureDir(join(data, dir));
    try {
      const origin = await readJson<{ state?: string }>(join(data, 'fork-origin.json'));
      if (origin.state === 'pending' || origin.state === 'failed') throw new Error('Code fork is incomplete; inspect fork-origin.json before using this workspace');
    } catch (err) { if (errorCode(err) !== 'ENOENT') throw err; }
    let config: WorkspaceConfig;
    try { config = await readJson<WorkspaceConfig>(join(data, 'workspace.json')); }
    catch (err) { if (errorCode(err) !== 'ENOENT') throw err; config = { schema: 1, repos: [], checks: [] }; }
    return new Workspace(canonical, validateConfig(config));
  }
  async reload(): Promise<void> {
    try { this.config = validateConfig(await readJson<WorkspaceConfig>(join(this.data, 'workspace.json'))); }
    catch (err) { if (errorCode(err) !== 'ENOENT') throw err; this.config = { schema: 1, repos: [], checks: [] }; }
  }
  async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    return await measured('workspace.operation', {}, () => this.runExclusive(fn), this.activity);
  }
  private async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.locked) throw new Error('Workspace operation already active');
    const path = join(this.data, 'operation.lock');
    let token: string;
    try { token = await acquireLock(path); }
    catch (err) { if (errorCode(err) === 'EEXIST') throw new Error('Workspace is busy or a previous operation was interrupted. Inspect operation.lock and operations before recovery.'); throw err; }
    this.locked = true;
    try {
      try { await lstat(join(this.data, 'recovery.lock')); throw new Error('Workspace recovery is active'); }
      catch (err) { if (errorCode(err) !== 'ENOENT') throw err; }
      // Reload under the lock so two CLI processes cannot overwrite each other's configuration.
      await this.reload();
      return await fn();
    } finally { this.locked = false; await releaseLock(path, token); }
  }
  private async persist(): Promise<void> { await writeJson(join(this.data, 'workspace.json'), validateConfig(this.config)); }
  async operations(): Promise<OperationRecord[]> {
    const names = (await readdir(join(this.data, 'operations'))).filter(name => name.endsWith('.json'));
    return await Promise.all(names.map(name => readJson<OperationRecord>(join(this.data, 'operations', name))));
  }
  async recover(): Promise<{ pending: OperationRecord[] }> {
    const recoveryPath = join(this.data, 'recovery.lock');
    let token: string;
    try { token = await acquireLock(recoveryPath); }
    catch (err) { if (errorCode(err) === 'EEXIST') throw new Error('Another recovery is active; inspect recovery.lock'); throw err; }
    try {
      const lockPath = join(this.data, 'operation.lock');
      let oldLock: string | undefined;
      try { oldLock = await readFile(lockPath, 'utf8'); } catch (err) { if (errorCode(err) !== 'ENOENT') throw err; }
      if (oldLock !== undefined) {
        let owner: { pid: number };
        try { owner = JSON.parse(oldLock); } catch { throw new Error('Lock metadata is incomplete; cannot determine whether its owner is active'); }
        if (!Number.isInteger(owner.pid) || owner.pid < 1) throw new Error('Invalid lock owner; inspect operation.lock');
        try { process.kill(owner.pid, 0); throw new Error('Workspace owner process is still active'); }
        catch (err) { if (errorCode(err) !== 'ESRCH') throw err; }
      }
      const pending = [];
      for (const record of await this.operations()) {
        if (record.status !== 'pending' && record.status !== 'unknown') continue;
        record.status = 'unknown';
        if (record.repo) record.after = await this.snapshotRepo(record.repo);
        if (record.scope === 'workspace') record.afterWorkspace = await Promise.all(this.config.repos.map(repo => this.snapshotRepo(repo.id)));
        await writeJson(storePath(this.data, 'operations', record.id), record);
        pending.push(record);
      }
      if (oldLock !== undefined) {
        if (await readFile(lockPath, 'utf8') !== oldLock) throw new Error('Lock changed during recovery');
        await rm(lockPath);
      }
      // Never replay unresolved operations. They remain blocked until the user
      // inspects their actual effects and explicitly acknowledges the record.
      return { pending };
    } finally { await releaseLock(recoveryPath, token); }
  }
  async acknowledgeOperation(operationId: string, observation: string): Promise<void> {
    if (!observation.trim()) throw new Error('Describe observed effects before acknowledging an operation');
    const path = storePath(this.data, 'operations', operationId);
    const record = await readJson<OperationRecord>(path);
    if (!['pending', 'unknown'].includes(record.status)) throw new Error('Operation is already resolved');
    if (record.repo) record.after = await this.snapshotRepo(record.repo);
    if (record.scope === 'workspace') record.afterWorkspace = await Promise.all(this.config.repos.map(repo => this.snapshotRepo(repo.id)));
    record.status = 'acknowledged'; record.observation = redact(observation, this.secrets);
    await writeJson(path, record);
  }
  private async requireResolvedOperations(repoId?: string): Promise<void> {
    const { BackgroundRuns } = await import('./background.js');
    const background = await new BackgroundRuns(this).unresolved();
    if (background.length) throw new Error(`Background command effects are unknown: ${background.join(', ')}. Inspect and reconcile them before mutation or verification.`);
    const unresolved = (await this.operations()).filter(record => ['pending', 'unknown'].includes(record.status)
      && (!repoId || record.scope === 'workspace' || record.repo === repoId || record.changes?.some(change => change.repo === repoId) || (!record.repo && !record.changes?.length)));
    if (unresolved.length) throw new Error(`Unknown operation effects require inspection and acknowledgement: ${unresolved.map(record => record.id).join(', ')}`);
  }
  repo(repoId: string): Repo {
    const repo = this.config.repos.find(x => x.id === repoId);
    if (!repo) throw new Error(`Unknown repository: ${repoId}`);
    return repo;
  }
  async addRepo(repoId: string, path: string, options: { role?: string; access?: Access; dependsOn?: string[] } = {}): Promise<Repo> {
    safeId(repoId);
    const root = await realpath(resolve(this.root, path));
    const gitRoot = await realpath((await git(root, ['rev-parse', '--show-toplevel'])).trim());
    if (root !== gitRoot) throw new Error('Register a repository root, not its subdirectory');
    if (this.config.repos.some(x => x.id === repoId || inside(x.root, root) || inside(root, x.root))) throw new Error('Repository identifier or root overlaps an existing repository');
    for (const dep of options.dependsOn ?? []) this.repo(dep);
    const repo: Repo = { id: repoId, root, role: options.role ?? '', access: options.access ?? 'write', dependsOn: options.dependsOn ?? [] };
    this.config.repos.push(repo);
    try { await this.persist(); } catch (err) { this.config.repos.pop(); throw err; }
    return repo;
  }
  async setDependencies(repoId: string, dependencies: string[]): Promise<void> {
    const repo = this.repo(repoId);
    for (const dep of dependencies) { if (dep === repoId) throw new Error('Repository cannot depend on itself'); this.repo(dep); }
    const previous = repo.dependsOn;
    repo.dependsOn = [...new Set(dependencies)];
    try { await this.persist(); } catch (err) { repo.dependsOn = previous; throw err; }
  }
  async addCheck(check: Check): Promise<void> {
    safeId(check.id); this.repo(check.repo);
    if (!check.argv.length || check.argv.some(x => typeof x !== 'string' || x.includes('\0'))) throw new Error('Invalid check command');
    if (this.config.checks.some(x => x.id === check.id)) throw new Error('Check already exists');
    this.config.checks.push(check);
    try { await this.persist(); } catch (err) { this.config.checks.pop(); throw err; }
  }
  async path(repoId: string, file: string, access: Access = 'read'): Promise<string> {
    const repo = this.repo(repoId);
    if (access === 'write' && repo.access !== 'write') throw new Error('Repository is read-only');
    const target = resolve(repo.root, file);
    this.pathPolicy?.(target, access);
    assertBoundaryPath(target, access);
    if (!inside(repo.root, target) || target === repo.root) throw new Error('Path must be a file within the repository');
    const rel = relative(repo.root, target).split(sep).join('/');
    if (excluded(rel)) throw new Error('Runtime, dependency, or credential path is excluded');
    for (let component = target; component !== repo.root; component = dirname(component)) {
      try { if ((await lstat(component)).isSymbolicLink()) throw new Error('Symbolic links are not supported by managed file operations'); }
      catch (err) { if (errorCode(err) !== 'ENOENT') throw err; }
    }
    let cursor = target;
    while (true) {
      try {
        const canonical = await realpath(cursor);
        if (!inside(repo.root, canonical)) throw new Error('Symlink escapes repository');
        // Mutation snapshots support regular files only. Do not follow even internal file symlinks.
        if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Symbolic links are not supported by managed file operations');
        break;
      } catch (err) {
        if (errorCode(err) !== 'ENOENT') throw err;
        const parent = dirname(cursor); if (parent === cursor) throw err; cursor = parent;
      }
    }
    return target;
  }
  async files(repoId: string): Promise<string[]> {
    const paths = (await git(this.repo(repoId).root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']))
      .split('\0').filter(Boolean).filter(file => !excluded(file));
    return [...new Set(paths)].sort();
  }
  async snapshotRepo(repoId: string, storeBlobs = true): Promise<RepoSnapshot> {
    return await measured('snapshot', { repo: repoId }, () => this.captureRepo(repoId, storeBlobs), this.activity);
  }
  private async captureRepo(repoId: string, storeBlobs = true, includeIgnored = true): Promise<RepoSnapshot> {
    const repo = this.repo(repoId); const files: Record<string, FileVersion> = Object.create(null);
    const names = await this.files(repoId);
    if (names.length > 50_000) throw new Error('Snapshot exceeds 50,000 files');
    let total = 0;
    for (const file of names) {
      const path = await this.path(repoId, file);
      let stat;
      try { stat = await lstat(path); } catch (err) { if (errorCode(err) === 'ENOENT') continue; throw err; }
      if (!stat.isFile()) throw new Error(`Snapshot requires a regular file: ${file}`);
      total += stat.size;
      if (total > 256 * 1024 * 1024) throw new Error('Repository snapshot exceeds 256 MiB');
      const content = await readFile(path); const digest = hash(content);
      const after = await lstat(path);
      if (stat.size !== after.size || stat.mtimeMs !== after.mtimeMs) throw new Error(`File changed during snapshot: ${file}`);
      if (storeBlobs) {
        const blob = join(this.data, 'blobs', digest);
        const temporary = `${blob}.${id('blob')}.tmp`;
        try {
          await writeFile(temporary, content, { mode: 0o600 });
          await rename(temporary, blob);
        } finally { await rm(temporary, { force: true }); }
      }
      files[file] = { hash: digest, mode: stat.mode & 0o777 };
    }
    const [metadata, ignoredFiles] = await Promise.all([
      git(repo.root, ['--no-optional-locks', 'status', '--porcelain=v2', '--branch', '--untracked-files=no', '-z']),
      includeIgnored ? git(repo.root, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory']) : Promise.resolve(''),
    ]);
    const headers = metadata.split('\0'), oid = headers.find(line => line.startsWith('# branch.oid '))?.slice(13), name = headers.find(line => line.startsWith('# branch.head '))?.slice(14);
    if (!oid || !name || name === '(unknown)' || oid !== '(initial)' && !/^[a-f0-9]{40,64}$/.test(oid)) throw new Error('Git branch metadata is unavailable');
    const head = oid === '(initial)' ? '' : oid, branch = name === '(detached)' ? '' : name;
    const ignored = ignoredFiles
      .split('\0').filter(Boolean).sort();
    return { repo: structuredClone(repo), head, branch, files, ignored };
  }
  async fingerprints(): Promise<Record<string, string>> {
    const output: Record<string, string> = {};
    for (const snapshot of await this.sourceSnapshots()) output[snapshot.repo.id] = hash(JSON.stringify({ head: snapshot.head, branch: snapshot.branch, files: snapshot.files }));
    return output;
  }
  private async sourceSnapshots(): Promise<Omit<RepoSnapshot, 'ignored'>[]> {
    const results: Omit<RepoSnapshot, 'ignored'>[] = [];
    for (let index = 0; index < this.config.repos.length; index += 4) {
      const snapshots = await Promise.all(this.config.repos.slice(index, index + 4).map(repo => measured('snapshot', { repo: repo.id }, () => this.captureRepo(repo.id, false, false), this.activity)));
      for (const { ignored: _, ...snapshot } of snapshots) results.push(snapshot);
    }
    return results;
  }
  async checkpoint(label: string, binding: { session?: string; entry?: string; references?: string[]; plan?: { id: string; revision: number } | null } = {}): Promise<Checkpoint> {
    const checkpoint: Checkpoint = { schema: 1, id: id('checkpoint'), label, createdAt: new Date().toISOString(),
      session: binding.session, entry: binding.entry, references: binding.references ?? [], repos: [] };
    if (binding.plan !== undefined) checkpoint.plan = binding.plan ?? undefined;
    else {
      try { checkpoint.plan = await readJson<{ id: string; revision: number }>(join(this.data, 'active-plan.json')); }
      catch (error) { if (errorCode(error) !== 'ENOENT') throw error; }
    }
    if (checkpoint.plan) {
      safeId(checkpoint.plan.id);
      if (!Number.isSafeInteger(checkpoint.plan.revision) || checkpoint.plan.revision < 1) throw new Error('Invalid checkpoint plan revision');
      await readJson(join(this.data, 'plans', `${checkpoint.plan.id}-${checkpoint.plan.revision}.json`));
    }
    for (const repo of this.config.repos) checkpoint.repos.push(await this.snapshotRepo(repo.id));
    for (const snapshot of checkpoint.repos) {
      const rechecked = await this.snapshotRepo(snapshot.repo.id);
      if (JSON.stringify(rechecked) !== JSON.stringify(snapshot)) throw new Error('Workspace changed while capturing the multi-repository checkpoint');
    }
    await writeJson(storePath(this.data, 'checkpoints', checkpoint.id), checkpoint);
    return checkpoint;
  }
  async loadCheckpoint(checkpointId: string): Promise<Checkpoint> {
    const checkpoint = await readJson<Checkpoint>(storePath(this.data, 'checkpoints', checkpointId));
    if (checkpoint.schema !== 1 || checkpoint.id !== checkpointId || !Array.isArray(checkpoint.repos)) throw new Error('Invalid checkpoint');
    if (checkpoint.plan) {
      safeId(checkpoint.plan.id);
      if (!Number.isSafeInteger(checkpoint.plan.revision) || checkpoint.plan.revision < 1) throw new Error('Invalid checkpoint plan revision');
      await readJson(join(this.data, 'plans', `${checkpoint.plan.id}-${checkpoint.plan.revision}.json`));
    }
    const seen = new Set<string>();
    for (const snapshot of checkpoint.repos) {
      if (!snapshot.repo || seen.has(snapshot.repo.id) || typeof snapshot.head !== 'string' || (snapshot.head !== '' && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(snapshot.head))
        || typeof snapshot.branch !== 'string' || (snapshot.ignored !== undefined && (!Array.isArray(snapshot.ignored) || snapshot.ignored.some(path => typeof path !== 'string')))) throw new Error('Invalid checkpoint repository metadata');
      seen.add(snapshot.repo.id);
      if (this.repo(snapshot.repo.id).root !== snapshot.repo.root) throw new Error('Checkpoint repository root changed');
      if (!snapshot.files || typeof snapshot.files !== 'object' || Array.isArray(snapshot.files)) throw new Error('Invalid snapshot files');
      for (const [path, file] of Object.entries(snapshot.files)) {
        await this.path(snapshot.repo.id, path);
        if (!file || !/^[a-f0-9]{64}$/.test(file.hash) || !Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777) throw new Error('Invalid snapshot blob or file mode');
      }
    }
    return checkpoint;
  }
  async checkpoints(): Promise<Checkpoint[]> {
    const names = (await readdir(join(this.data, 'checkpoints'))).filter(x => x.endsWith('.json'));
    const checkpoints = await Promise.all(names.map(x => readJson<Checkpoint>(join(this.data, 'checkpoints', x))));
    return checkpoints.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  private async readBlob(digest: string): Promise<Buffer> {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid snapshot blob');
    const bytes = await readFile(join(this.data, 'blobs', digest));
    if (hash(bytes) !== digest) throw new Error('Snapshot blob corrupted');
    return bytes;
  }
  async compare(leftId: string, rightId: string): Promise<{ repo: string; file: string; change: string; patch?: string }[]> {
    const left = await this.loadCheckpoint(leftId), right = await this.loadCheckpoint(rightId);
    const changes: { repo: string; file: string; change: string; patch?: string }[] = [];
    for (const repoId of new Set([...left.repos, ...right.repos].map(x => x.repo.id))) {
      const a = left.repos.find(x => x.repo.id === repoId)?.files ?? {};
      const b = right.repos.find(x => x.repo.id === repoId)?.files ?? {};
      for (const file of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (JSON.stringify(a[file]) !== JSON.stringify(b[file])) {
          const before = a[file] ? await this.readBlob(a[file]!.hash) : Buffer.alloc(0);
          const after = b[file] ? await this.readBlob(b[file]!.hash) : Buffer.alloc(0);
          const text = before.length + after.length <= 256_000 && !before.includes(0) && !after.includes(0);
          const patch = text ? redact(createTwoFilesPatch(`${repoId}/${file}`, `${repoId}/${file}`, before.toString('utf8'), after.toString('utf8')).slice(0, 48_000), this.secrets) : undefined;
          changes.push({ repo: repoId, file, change: !a[file] ? 'added' : !b[file] ? 'deleted' : 'modified', patch });
        }
      }
    }
    return changes;
  }
  async forkCheckpoint(checkpointId: string, destination: string, handoff?: ForkHandoff): Promise<Workspace> {
    await this.requireResolvedOperations();
    if (!this.config.repos.length) throw new Error('Register repositories before creating a code branch');
    const checkpoint = await this.loadCheckpoint(checkpointId);
    if (checkpoint.session && (!handoff || handoff.sourceSession !== checkpoint.session)) throw new Error('Session-bound code fork requires a host-resolved handoff');
    if (handoff && (!Array.isArray(handoff.requirements) || handoff.requirements.some(note => typeof note !== 'string')
      || !Number.isSafeInteger(handoff.requests) || handoff.requests < 0)) throw new Error('Invalid code fork handoff');
    const requested = resolve(this.root, destination);
    const target = join(await realpath(dirname(requested)), basename(requested));
    if (this.config.repos.some(repo => inside(repo.root, target))) throw new Error('Fork destination cannot be inside a source repository');
    const snapshots = [];
    for (const repo of this.config.repos) snapshots.push(checkpoint.repos.find(snapshot => snapshot.repo.id === repo.id) ?? await this.snapshotRepo(repo.id));
    let common = dirname(this.config.repos[0]!.root);
    while (!this.config.repos.every(repo => inside(common, repo.root))) {
      const parent = dirname(common);
      if (parent === common) throw new Error('Code fork requires repository roots on one filesystem volume');
      common = parent;
    }
    for (const snapshot of snapshots) for (const version of Object.values(snapshot.files)) {
      await this.readBlob(version.hash);
    }
    // mkdir without recursive refuses an existing destination, including symlinks.
    await mkdir(target);
    const fork = await Workspace.open(target);
    const operationId = id('fork'), operationPath = storePath(this.data, 'operations', operationId);
    const originPath = join(fork.data, 'fork-origin.json');
    const origin = { checkpoint: checkpoint.id, session: checkpoint.session, entry: checkpoint.entry, sourceWorkspace: this.root,
      createdAt: new Date().toISOString(), validation: 'unverified', destination: target };
    await writeJson(operationPath, { schema: 1, id: operationId, operation: 'code-fork', status: 'pending', destination: target });
    await writeJson(originPath, { ...origin, state: 'pending' });
    try {
    for (const snapshot of snapshots) {
      const original = this.repo(snapshot.repo.id);
      const repoRoot = join(fork.root, 'repos', relative(common, original.root));
      await mkdir(dirname(repoRoot), { recursive: true });
      if (snapshot.head) await git(original.root, ['worktree', 'add', '--detach', repoRoot, snapshot.head]);
      else { await mkdir(repoRoot); await git(repoRoot, ['init', '-b', 'main']); }
      fork.config.repos.push({ ...structuredClone(original), root: repoRoot });
      // Materialize the actual checkpoint, including its original dirty files.
      for (const file of await fork.files(original.id)) if (!snapshot.files[file]) {
        await rm(await fork.path(original.id, file), { force: true });
      }
      for (const [file, version] of Object.entries(snapshot.files)) {
        const content = await this.readBlob(version.hash);
        const path = await fork.path(original.id, file);
        await mkdir(dirname(path), { recursive: true }); await writeFile(path, content, { mode: version.mode });
        await chmod(path, version.mode);
      }
    }
    const relocate = (argument: string): string => isAbsolute(argument) && inside(common, argument)
      ? join(fork.root, 'repos', relative(common, argument)) : argument;
    fork.config.checks = this.config.checks.map(check => ({ ...check, argv: check.argv.map(relocate) }));
    await fork.persist();
    if (checkpoint.plan) {
      await ensureDir(join(fork.data, 'plans'));
      const plan = await readJson(join(this.data, 'plans', `${checkpoint.plan.id}-${checkpoint.plan.revision}.json`));
      await writeJson(join(fork.data, 'plans', `${checkpoint.plan.id}-${checkpoint.plan.revision}.json`), plan);
      await writeJson(join(fork.data, 'active-plan.json'), checkpoint.plan);
    }
    await writeJson(join(fork.data, 'fork-state.json'), { schema: 1, requirements: handoff?.requirements ?? [],
      requests: handoff?.requests ?? 0, corrections: 0, evidence: [], lastVerification: 'unverified' });
    await fork.exclusive(() => fork.checkpoint(`fork:${checkpoint.label}`));
    await writeJson(originPath, { ...origin, state: 'complete' });
    await writeJson(operationPath, { schema: 1, id: operationId, operation: 'code-fork', status: 'settled', destination: target });
    return fork;
    } catch (error) {
      await writeJson(originPath, { ...origin, state: 'failed', error: redact(String(error), this.secrets) });
      await writeJson(operationPath, { schema: 1, id: operationId, operation: 'code-fork', status: 'unknown', destination: target, error: redact(String(error), this.secrets) });
      throw new Error(`Incomplete code fork retained at ${target}; inspect its origin and operation record: ${error}`);
    }
  }
  async observe(): Promise<Observation> {
    return (await this.observeSources()).observation;
  }
  /** Source facts and their fingerprints come from the same bounded read. */
  async observeSources() {
    if (!this.locked) await this.reload();
    const snapshots = await this.sourceSnapshots(), fingerprints: Record<string, string> = {};
    for (const snapshot of snapshots) fingerprints[snapshot.repo.id] = hash(JSON.stringify({ head: snapshot.head, branch: snapshot.branch, files: snapshot.files }));
    const observation: Observation = { fingerprints, environment: this.environmentFingerprint(), configuration: await this.configurationFingerprint() };
    return { observation, snapshots };
  }
  private async configurationFingerprint(): Promise<string> {
    const dependencies: Record<string, string> = {};
    for (const file of ['services.json', 'browser-scenarios.json', 'recipes.json']) try { dependencies[file] = hash(await readFile(join(this.data, file))); }
    catch (error) { if (errorCode(error) !== 'ENOENT') throw error; }
    return hash(JSON.stringify({ workspace: this.config, dependencies }));
  }
  async evidence(kind: Evidence['kind'], data: unknown, observation?: Observation): Promise<Evidence> {
    const payload = data && typeof data === 'object' ? data as Record<string, unknown> : {};
    const current = await this.observe();
    const observed = observation ?? payload.observation as Observation | undefined ?? current;
    let validAtCapture = JSON.stringify(observed) === JSON.stringify(current);
    if (kind === 'reading' && Array.isArray(payload.sources)) for (const source of payload.sources) {
      const item = source as { repo: string; file: string; hash: string };
      try { if (hash(await readFile(await this.path(item.repo, item.file))) !== item.hash) validAtCapture = false; }
      catch { validAtCapture = false; }
    }
    const entry: Evidence = { id: id('evidence'), kind, createdAt: new Date().toISOString(), fingerprints: observed.fingerprints,
      environment: observed.environment, configuration: observed.configuration, validAtCapture,
      data: JSON.parse(redact(JSON.stringify(data), this.secrets)) };
    await writeJson(storePath(this.data, 'evidence', entry.id), entry); return entry;
  }
  async evidenceStatus(evidenceId: string): Promise<{ entry: Evidence; valid: boolean }> {
    if (!this.locked) await this.reload();
    const entry = await readJson<Evidence>(storePath(this.data, 'evidence', evidenceId));
    return { entry, valid: entry.validAtCapture === true && entry.configuration === await this.configurationFingerprint()
      && entry.environment === this.environmentFingerprint() && JSON.stringify(entry.fingerprints) === JSON.stringify(await this.fingerprints()) };
  }
  async reusableVerification(evidenceId: string): Promise<{ status: 'verified'; results: unknown[]; evidence: string } | undefined> {
    await this.requireResolvedOperations();
    const previous = await this.evidenceStatus(evidenceId);
    const data = previous.entry.data as { status?: string; results?: { check: string; status: string }[] };
    if (!previous.valid || previous.entry.kind !== 'check' || data.status !== 'verified' || !Array.isArray(data.results)
      || data.results.length !== this.config.checks.length || !this.config.checks.every(check => data.results?.some(result => result.check === check.id && result.status === 'passed'))) return undefined;
    return { status: 'verified', results: data.results, evidence: previous.entry.id };
  }
  private environmentFingerprint(): string {
    // Hash execution identity and environment without persisting credentials or values.
    return hash(JSON.stringify({ executable: process.execPath, version: process.version, platform: process.platform,
      arch: process.arch, env: Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b)) }));
  }
  async verify(signal?: AbortSignal): Promise<{ status: string; results: unknown[]; evidence: string }> {
    return await measured('verification', {}, () => this.runVerification(signal), this.activity);
  }
  private async runVerification(signal?: AbortSignal): Promise<{ status: string; results: unknown[]; evidence: string }> {
    await this.requireResolvedOperations();
    const observed = await this.observe(); const before = observed.fingerprints; const results = [];
    for (const check of this.config.checks) {
      const result = await runProcess(check.argv, this.repo(check.repo).root, { signal, timeoutMs: check.timeoutMs });
      results.push({ check: check.id, repo: check.repo, joint: check.joint ?? false, ...result, output: redact(result.output, this.secrets) });
      if (result.status === 'unknown' || result.cleanup === 'unknown') {
        const operationId = id('verification');
        await writeJson(storePath(this.data, 'operations', operationId), { schema: 1, id: operationId, repo: check.repo,
          operation: `check:${check.id}`, status: 'unknown', error: result.status });
        break;
      }
      if (signal?.aborted) break;
    }
    const after = await this.observe();
    const unchanged = JSON.stringify(observed) === JSON.stringify(after);
    let status = !results.length ? 'unverified' : !unchanged ? 'stale' : results.every(x => x.status === 'passed') && results.length === this.config.checks.length ? 'verified' : 'failed';
    const evidence = await this.evidence('check', { status, results, checkedFingerprints: before }, observed);
    if (status === 'verified' && !evidence.validAtCapture) {
      status = 'stale'; evidence.data = { status, results, checkedFingerprints: before };
      await writeJson(storePath(this.data, 'evidence', evidence.id), evidence);
    }
    if (status === 'verified') emitActivity({ kind: 'fact', stage: 'check.passed', reference: evidence.id, fingerprint: evidence.id, detail: 'Registered acceptance checks passed.' }, this.activity);
    return { status, results, evidence: evidence.id };
  }
  async mutate<T>(repoId: string, operation: string, action: () => Promise<T>): Promise<T> {
    this.repo(repoId); if (this.repo(repoId).access !== 'write') throw new Error('Repository is read-only');
    const scope = operation === 'command' ? 'workspace' : 'repository';
    await this.requireResolvedOperations(scope === 'workspace' ? undefined : repoId);
    const beforeWorkspace = scope === 'workspace' ? await Promise.all(this.config.repos.map(repo => this.snapshotRepo(repo.id))) : undefined;
    const before = beforeWorkspace?.find(snapshot => snapshot.repo.id === repoId) ?? await this.snapshotRepo(repoId);
    const opId = id('operation'); const path = storePath(this.data, 'operations', opId);
    const createdAt = new Date().toISOString();
    await writeJson(path, { schema: 1, id: opId, repo: repoId, operation, scope, status: 'pending', before, beforeWorkspace, createdAt });
    let result: T;
    try { result = await action(); }
    catch (error) {
      const afterWorkspace = scope === 'workspace' ? await Promise.all(this.config.repos.map(repo => this.snapshotRepo(repo.id))) : undefined;
      const after = afterWorkspace?.find(snapshot => snapshot.repo.id === repoId) ?? await this.snapshotRepo(repoId);
      await writeJson(path, { schema: 1, id: opId, repo: repoId, operation, scope, createdAt,
        status: JSON.stringify(beforeWorkspace ?? before) === JSON.stringify(afterWorkspace ?? after) ? 'failed' : 'unknown', before, beforeWorkspace,
        after, afterWorkspace, error: redact(String(error), this.secrets) }); throw error;
    }
    const afterWorkspace = scope === 'workspace' ? await Promise.all(this.config.repos.map(repo => this.snapshotRepo(repo.id))) : undefined;
    const after = afterWorkspace?.find(snapshot => snapshot.repo.id === repoId) ?? await this.snapshotRepo(repoId);
    const outcome = result && typeof result === 'object' ? result as Record<string, unknown> : {};
    await writeJson(path, { schema: 1, id: opId, repo: repoId, operation, scope, createdAt,
      status: outcome.status === 'unknown' || outcome.cleanup === 'unknown' ? 'unknown' : 'settled', before, after, beforeWorkspace, afterWorkspace });
    for (const snapshot of afterWorkspace ?? [after]) {
      const original = beforeWorkspace?.find(item => item.repo.id === snapshot.repo.id) ?? before;
      for (const file of new Set([...Object.keys(original.files), ...Object.keys(snapshot.files)])) if (JSON.stringify(original.files[file]) !== JSON.stringify(snapshot.files[file])) {
        emitActivity({ kind: 'fact', stage: 'source.changed', repo: snapshot.repo.id, reference: `${snapshot.repo.id}:${file}`,
          fingerprint: `${snapshot.repo.id}:${file}:${snapshot.files[file]?.hash ?? 'deleted'}`, detail: 'Managed operation observed a file change; authorship and correctness require verification.' }, this.activity);
      }
    }
    return result;
  }
  async restore(targetId: string, expectedId: string, options: { planFile?: string } = {}): Promise<Checkpoint> {
    await this.requireResolvedOperations();
    const target = await this.loadCheckpoint(targetId), expected = await this.loadCheckpoint(expectedId);
    const planFile = options.planFile ?? 'active-plan.json';
    if (!/^active-plan(?:-[a-zA-Z0-9._-]+)?\.json$/.test(planFile)) throw new Error('Invalid restore plan scope');
    const planPath = join(this.data, planFile);
    let previousPlan: { id: string; revision: number } | undefined;
    try { previousPlan = await readJson(planPath); }
    catch (error) { if (errorCode(error) !== 'ENOENT') throw error; }
    if (expected.repos.length !== this.config.repos.length) throw new Error('Expected checkpoint must describe the current repository set');
    const changes: { repo: string; file: string; path: string; before?: FileVersion; after?: FileVersion }[] = [];
    for (const repo of this.config.repos) {
      const a = target.repos.find(x => x.repo.id === repo.id), b = expected.repos.find(x => x.repo.id === repo.id);
      if (!b) throw new Error('Expected checkpoint repository set differs');
      const current = await this.snapshotRepo(repo.id);
      if (current.head !== b.head || current.branch !== b.branch || (a && (a.head !== b.head || a.branch !== b.branch))) throw new Error('Git HEAD or branch changed; restore code in a separate worktree');
      if (!equalFiles(current.files, b.files)) throw new Error(`External edits detected in ${repo.id}; capture or resolve them before restore`);
      // Repository registrations are current user policy. A context/code rewind
      // predating a registration leaves the newer repository untouched.
      if (!a) continue;
      for (const file of new Set([...Object.keys(a.files), ...Object.keys(b.files)])) {
        if (JSON.stringify(a.files[file]) !== JSON.stringify(b.files[file])) {
          if (!a.files[file] && a.ignored?.some(path => file === path || (path.endsWith('/') && file.startsWith(path)))) continue;
          if (!a.files[file] && !a.ignored && Object.keys({ ...a.files, ...b.files }).some(path => path.endsWith('.gitignore') && a.files[path]?.hash !== b.files[path]?.hash)) {
            throw new Error('Legacy checkpoint capture scope changed; use an independent code fork instead of deleting uncertain files');
          }
          const path = await this.path(repo.id, file, 'write');
          changes.push({ repo: repo.id, file, path, before: b.files[file], after: a.files[file] });
          if (a.files[file]) {
            await this.readBlob(a.files[file]!.hash);
          }
        }
      }
    }
    const opId = id('restore'), journal = storePath(this.data, 'operations', opId);
    await writeJson(journal, { schema: 1, id: opId, status: 'pending', targetId, expectedId, changes });
    const applied: typeof changes = [];
    const apply = async (change: typeof changes[number], version: FileVersion | undefined, expectedVersion: FileVersion | undefined, track = false) => {
      await this.path(change.repo, change.file, 'write');
      let current: Buffer | undefined;
      try { current = await readFile(change.path); } catch (error) { if (errorCode(error) !== 'ENOENT') throw error; }
      if ((current ? hash(current) : undefined) !== expectedVersion?.hash) throw new Error(`Concurrent edit detected before apply: ${change.repo}:${change.file}`);
      if (!version) { if (track) applied.push(change); await rm(change.path, { force: true }); return; }
      const bytes = await this.readBlob(version.hash);
      await mkdir(dirname(change.path), { recursive: true });
      const tmp = `${change.path}.${opId}.tmp`;
      try {
        await writeFile(tmp, bytes, { mode: version.mode });
        let latest: Buffer | undefined;
        try { latest = await readFile(change.path); } catch (error) { if (errorCode(error) !== 'ENOENT') throw error; }
        if ((latest ? hash(latest) : undefined) !== expectedVersion?.hash) throw new Error(`Concurrent edit detected before replacement: ${change.repo}:${change.file}`);
        if (track) applied.push(change);
        await rename(tmp, change.path); await chmod(change.path, version.mode);
      }
      finally { await rm(tmp, { force: true }); }
    };
    try {
      for (const change of changes) {
        // Recheck each path just before mutation; external edits after preflight are conflicts.
        let current: Buffer | undefined;
        try { current = await readFile(change.path); } catch (err) { if (errorCode(err) !== 'ENOENT') throw err; }
        if ((current ? hash(current) : undefined) !== change.before?.hash) throw new Error(`Concurrent edit detected in ${change.repo}:${change.file}`);
        await apply(change, change.after, change.before, true);
      }
      for (const snapshot of target.repos) {
        if (!equalFiles((await this.snapshotRepo(snapshot.repo.id)).files, snapshot.files)) throw new Error('Restored files do not match checkpoint');
      }
      if (target.plan) await writeJson(planPath, target.plan);
      else await rm(planPath, { force: true });
    } catch (error) {
      let rollbackError;
      try {
        for (const change of applied.reverse()) {
          let actual: Buffer | undefined;
          try { actual = await readFile(change.path); } catch (err) { if (errorCode(err) !== 'ENOENT') throw err; }
          if ((actual ? hash(actual) : undefined) === change.before?.hash) continue;
          if ((actual ? hash(actual) : undefined) !== change.after?.hash) throw new Error(`Concurrent edit during compensation: ${change.repo}:${change.file}`);
          await apply(change, change.before, change.after);
        }
        if (previousPlan) await writeJson(planPath, previousPlan);
        else await rm(planPath, { force: true });
      } catch (err) { rollbackError = String(err); }
      await writeJson(journal, { schema: 1, id: opId, status: rollbackError ? 'unknown' : 'rolled-back', targetId, expectedId,
        error: String(error), rollbackError });
      throw new Error(`Restore failed${rollbackError ? '; manual recovery required' : '; changes rolled back'}: ${error}`);
    }
    await writeJson(journal, { schema: 1, id: opId, status: 'settled', targetId, expectedId });
    return await this.checkpoint(`restored:${target.label}`, { references: target.references, plan: target.plan ?? null });
  }
}
