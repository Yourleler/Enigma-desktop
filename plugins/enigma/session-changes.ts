import { PathGuard } from '../../lib/sandbox/path-guard.ts';
import { deriveSandboxPolicy } from '../../lib/sandbox/policy.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Workspace, ChangeReadings, runProcess, excludedSourcePath } from 'enigma-next';
import { hash } from 'enigma-next/storage';
import { SessionManager } from '../../lib/pi-sdk/index.ts';
import { nativeEngineeringPolicy, withNativeEngineeringExecution } from './execution-policy.ts';

export interface ChangeRepository {
  id: string;
  root: string;
  name: string;
  branch: string;
  files: number;
  added: number;
  removed: number;
  untracked: number;
  binary: number;
  conflicts: number;
  error?: string;
}
const included = (file: string) => !excludedSourcePath(file);
export function parseGitFileStatuses(output:string){
  const entries=output.split('\0'),files:Array<{path:string;status:string;previousPath?:string}>=[];
  for(let i=0;i<entries.length;i++){
    const entry=entries[i];if(!entry)continue;
    const state=entry.slice(0,2),file=entry.slice(3);
    const previousPath=/[RC]/.test(state)?entries[++i]:undefined;
    if(!file||!included(file))continue;
    const status=state.includes('U')||state==='AA'||state==='DD'?'conflict':state.includes('D')?'deleted':state.includes('R')?'renamed':state==='??'||/[AC]/.test(state)?'added':'modified';
    files.push({path:file,status,...(previousPath?{previousPath}:{})});
  }
  return files;
}
async function git(root: string, args: string[], signal?: AbortSignal) {
  const result = await runProcess(['git', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...args], root,
    { signal, internalGit: true, timeoutMs: 8000, limit: 2_000_000, env: { GIT_OPTIONAL_LOCKS: '0' } });
  if (result.status !== 'passed' || result.truncated) throw new Error(result.truncated ? '变更文件过多，未能完整统计' : '无法读取仓库状态');
  return result.output;
}
async function addedFile(root: string, file: string) {
  const target = path.resolve(root, file);
  if (!target.startsWith(root + path.sep)) return null;
  const stat = await fs.lstat(target);
  if (!stat.isFile() || stat.size > 512_000) return null;
  const bytes = await fs.readFile(target);
  if (bytes.includes(0)) return null;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0;
  } catch { return null; }
}
export async function summarizeRepository(root: string, id: string, signal?: AbortSignal): Promise<ChangeRepository> {
  const result: ChangeRepository = { id, root, name: path.basename(root), branch: '', files: 0, added: 0, removed: 0, untracked: 0, binary: 0, conflicts: 0 };
  try {
    const [status, branch] = await Promise.all([
      git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], signal),
      git(root, ['symbolic-ref', '--short', '-q', 'HEAD'], signal).catch(() => '分离 HEAD'),
    ]);
    result.branch = branch.trim();
    const entries = status.split('\0');
    const untracked: string[] = [], files = new Set<string>();
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry) continue;
      const state = entry.slice(0, 2), file = entry.slice(3);
      if (state.includes('R') || state.includes('C')) i++;
      if (!included(file)) continue;
      files.add(file);
      if (state === '??') untracked.push(file);
      if (state.includes('U') || state === 'AA' || state === 'DD') result.conflicts++;
    }
    result.files = files.size;
    result.untracked = untracked.length;
    const head = await git(root, ['rev-parse', '--verify', 'HEAD'], signal).catch(() => '');
    const added = head ? untracked : (await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], signal)).split('\0').filter(file => file && included(file));
    if (head) {
      const stats = await git(root, ['diff', '--numstat', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', 'HEAD', '--'], signal);
      for (const line of stats.split('\0')) {
        const match = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(line);
        if (!match || !included(match[3])) continue;
        if (match[1] === '-') result.binary++;
        else { result.added += Number(match[1]); result.removed += Number(match[2]); }
      }
    }
    if (added.length > 5000) throw new Error('新文件过多，未能完整统计');
    for (const file of new Set(added)) {
      signal?.throwIfAborted();
      const lines = await addedFile(root, file);
      if (lines === null) result.binary++;
      else result.added += lines;
    }
  } catch (error) { result.error = error instanceof Error ? error.message : '变更统计暂不可用'; }
  return result;
}

/** Read-only repository views also work for ordinary conversations. Source roots
 * are derived on the server; captures live in the profile, never in the source. */
export class SessionChanges {
  private pending = new Map<string, Promise<any>>();
  private engine: any;
  private host: any;
  constructor(engine: any, host: any) { this.engine = engine; this.host = host; }

  async repositories(sessionPath: string) {
    const binding = await this.host.binding(sessionPath);
    if (binding) {
      const workspace = await Workspace.open(binding.root);
      return workspace.config.repos.map(repo => ({ ...repo }));
    }
    const manifest = this.engine.getSessionManifest?.(this.engine.getSessionIdForPath?.(sessionPath));
    const cwd = manifest?.workspaceScope?.primaryCwd
      || this.engine.getSessionByPath?.(sessionPath)?.sessionManager?.getCwd?.()
      || SessionManager.open(sessionPath, path.dirname(sessionPath)).getCwd();
    if (!cwd) return [];
    const root = await git(cwd, ['rev-parse', '--show-toplevel']).catch(() => '');
    if (!root.trim()) return [];
    return [{ id: 'main', root: await fs.realpath(root.trim()), role: '当前对话仓库', access: 'read' as const, dependsOn: [] }];
  }

  async source(sessionPath: string, repoId: string, file: string) {
    const repos = await this.repositories(sessionPath), repo = repos.find(item => item.id === repoId);
    if (!repo || !file || excludedSourcePath(file)) throw new Error('源码不在当前项目可读范围内');
    const root = await fs.realpath(repo.root), target = await fs.realpath(path.resolve(root, file));
    if (!target.startsWith(root + path.sep)) throw new Error('源码路径超出当前仓库');
    const policy = deriveSandboxPolicy({ cwd: root, workspace: root, hanakoHome: this.engine.hanakoHome, agentDir: path.dirname(path.dirname(sessionPath)), mode: 'standard' });
    const access = new PathGuard(policy).check(target, 'read');
    if (!access.allowed) throw new Error('当前权限不允许读取此文件');
    const stat = await fs.stat(target);
    if (!stat.isFile() || stat.size > 512000) throw new Error('源码文件过大或不是普通文本文件');
    const bytes = await fs.readFile(target);
    if (bytes.includes(0)) throw new Error('该文件是二进制内容');
    const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { content, file, version: hash(bytes), readAt: new Date().toISOString() };
  }

  async summary(sessionPath: string, signal?: AbortSignal) {
    signal = signal ? AbortSignal.any([signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000);
    const repos = await this.repositories(sessionPath);
    // Avoid unbounded process fan-out for workspaces with many repositories.
    const repositories: ChangeRepository[] = [];
    for (const repo of repos) repositories.push(await summarizeRepository(repo.root, repo.id, signal));
    return { repositories, at: new Date().toISOString(), git: repos.length > 0 };
  }

  async fileStatuses(sessionPath:string,signal?:AbortSignal){
    const repos=await this.repositories(sessionPath),repositories=[];
    for(const repo of repos){
      try{repositories.push({id:repo.id,root:repo.root,files:parseGitFileStatuses(await git(repo.root,['status','--porcelain=v1','-z','--untracked-files=all'],signal))});}
      catch(error){signal?.throwIfAborted();repositories.push({id:repo.id,root:repo.root,files:[],error:error instanceof Error?error.message:'文件状态暂不可用'});}
    }
    return {repositories,git:repos.length>0};
  }

  async read(sessionPath: string, kind: 'working' | 'staged' | 'commit', signal?: AbortSignal, revisions?:{base?:Record<string,string>;target?:Record<string,string>}) {
    const key = `${sessionPath}:${kind}:${JSON.stringify(revisions)}`;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const task = this.capture(sessionPath, kind, signal,revisions);
    this.pending.set(key, task);
    try { return await task; } finally { if (this.pending.get(key) === task) this.pending.delete(key); }
  }

  private async capture(sessionPath: string, kind: 'working' | 'staged' | 'commit', signal?: AbortSignal,revisions?:{base?:Record<string,string>;target?:Record<string,string>}) {
    const repos = await this.repositories(sessionPath);
    if (!repos.length) throw new Error('当前文件夹不是 Git 仓库，暂无版本差异');
    const root = path.join(this.engine.hanakoHome, 'plugin-data', 'enigma', 'change-previews', hash(`${sessionPath}:${kind}:${JSON.stringify(repos)}`));
    await fs.mkdir(root, { recursive: true });
    const workspace = await Workspace.open(root);
    if (!workspace.config.repos.length) {
      await workspace.exclusive(async () => {
        for (const repo of repos) await workspace.addRepo(repo.id, repo.root, { access: 'read', role: repo.role });
        for (const repo of repos) await workspace.setDependencies(repo.id, repo.dependsOn);
      });
    }
    nativeEngineeringPolicy(this.engine, workspace, sessionPath);
    return withNativeEngineeringExecution(this.engine, workspace, sessionPath, async () => {
      const readings = new ChangeReadings(workspace);
      const record = await readings.build({ kind,...revisions,task: 'sidebar', goal: '核对当前代码变更、调用关系与影响范围' }, { signal });
      const checked = await readings.latest('sidebar');
      // Recheck assigned roots before exposing a completed asynchronous result.
      if (JSON.stringify(repos) !== JSON.stringify(await this.repositories(sessionPath))) throw new Error('对话工作区已变化，请重新打开变更');
      return { changeReadingRoot:root, changeReading: checked || { record, matchesWorkspace: false }, repositories: repos.map(({ id, root }) => ({ id, root })) };
    });
  }
}
