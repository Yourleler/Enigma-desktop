import { chmod, lstat, mkdir, readFile,readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Workspace } from './workspace.js';
import { ensureDir, hash, id, redact, safeId, writeJson } from './storage.js';
import type { FileVersion, Observation, Repo } from './types.js';
import { PlanStore, type TaskPlan } from './planning.js';
import { ProjectContext, type ProjectResource } from './project-context.js';
import { readResourceCapture } from './resource-fetch.js';
import { Artifacts, type ArtifactRecord } from './artifacts.js';
import { MemoryStore, type MemoryAccess } from './memory.js';
import { exportHandoff, type HandoffInput } from './handoff.js';
import { ServiceManager, type ServiceInput } from './services.js';
import { BrowserValidation, type BrowserScenario } from './browser-validation.js';
import { RecipeStore, type Recipe } from './recipes.js';
import { runProcess } from './process.js';
import { BackgroundRuns } from './background.js';

export interface TaskPackageInput {
  goal: string; source: HandoffInput['source']; notes: HandoffInput['notes']; checkpoint?: string; task?: string;
  resources?: string[]; artifacts?: string[]; evidence?: string[]; memories?: string[]; memoryAccess?: MemoryAccess; plan?: TaskPlan | null;
}
export interface TaskPackageManifest {
  schema: 1; id: string; createdAt: string; goal: string; source: HandoffInput['source']; sourceWorkspace: string; checkpoint: string; task?: string;
  notes: HandoffInput['notes']; observation: Observation;
  environment: { node: string; executable: string; platform: string; arch: string };
  repos: { repo: Repo; directory: string; head: string; branch: string; files: Record<string, FileVersion> }[];
  runtime: { checks: Workspace['config']['checks']; services: ServiceInput[]; browser: BrowserScenario[]; recipes: Recipe[] };
  plan?: TaskPlan; materials: { resource: ProjectResource; blob: string; current: boolean | null; capture?: string }[];
  artifacts: { record: ArtifactRecord; blob: string }[]; evidence: { id: string; blob: string; currentAtExport: boolean }[];
  memories: { id: string; blob: string }[]; blobs: Record<string, number>; bytes: number;
  unresolved: string[]; note: string;
}
export interface PackageRestoreOptions {
  writeRepos?: string[]; mapping?: Record<string, string>; activateRuntime?: boolean; checks?: string[]; includePlan?: boolean; preparePi?: boolean; task?: string; signal?: AbortSignal;
  expectedManifest?: string;
}
const inside = (root: string, file: string) => { const rel = relative(root, file); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`); };
const safeRelative = (file: string) => {
  if (typeof file !== 'string' || !file || isAbsolute(file) || /[\\\0]/.test(file) || file.split('/').some(part => !part || ['.', '..', '.git', '.enigma-next'].includes(part)) || /^[A-Za-z]:/.test(file)) throw new Error('Invalid package file path');
  return file;
};
const digest = (value: unknown) => hash(JSON.stringify(value));

export async function relocatePackageArgument(argument: string, manifest: TaskPackageManifest, workspace: Workspace, mapping: Record<string, string> = {}) {
  if (argument === manifest.environment.executable) return process.execPath;
  let physical = argument;
  if (isAbsolute(argument)) {
    let existing = argument;
    while (true) try { physical = join(await realpath(existing), relative(existing, argument)); break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; const parent = dirname(existing); if (parent === existing) break; existing = parent; }
  }
  if (physical === manifest.sourceWorkspace) return workspace.root;
  for (const item of [...manifest.repos].sort((a, b) => b.repo.root.length - a.repo.root.length)) {
    const normalized = argument.replaceAll('\\', '/'), sourceRoot = item.repo.root.replaceAll('\\', '/'), target = workspace.repo(mapping[item.repo.id] ?? item.repo.id).root;
    if (normalized === sourceRoot || normalized.startsWith(sourceRoot + '/')) return join(target, ...normalized.slice(sourceRoot.length).split('/').filter(Boolean));
    if (isAbsolute(physical) && inside(item.repo.root, physical)) return join(target, relative(item.repo.root, physical));
    if (argument.includes(item.repo.root)) throw new Error('Embedded source paths cannot be automatically relocated; revise the runtime recipe');
  }
  if (argument.includes(manifest.sourceWorkspace)) throw new Error('Embedded source workspace paths cannot be automatically relocated');
  return argument;
}

/** Portable task data and exact code bytes. It never imports native history or historical success. */
export class TaskPackages {
  constructor(readonly workspace: Workspace) {}
  async list(task?:string) {
    const directory=join(this.workspace.data,'packages');let names:string[];try{names=await readdir(directory);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {items:[],truncated:false};throw error;}
    const items=[];
    for(const name of names)try{
      safeId(name);const root=join(directory,name),statePath=join(root,'state.json');if((await lstat(statePath)).size>10000)continue;const state=JSON.parse(await readFile(statePath,'utf8'));if(state.task&&state.task!==task)continue;
      if(state.status!=='complete'){items.push({id:name,directory:root,status:state.status==='failed'?'failed':'preparing',createdAt:state.createdAt||'',goal:'尚未完成的任务包'});continue;}
      const manifestPath=join(root,'manifest.json');if((await lstat(manifestPath)).size>16000000)continue;const envelope=JSON.parse(await readFile(manifestPath,'utf8')),manifest=envelope.manifest;if(manifest?.task&&manifest.task!==task)continue;
      if(manifest?.schema!==1||manifest.id!==name||digest(manifest)!==envelope.hash||typeof manifest.goal!=='string'||!Array.isArray(manifest.repos))throw new Error('Invalid package manifest');
      items.push({id:name,directory:root,status:'complete',createdAt:manifest.createdAt,goal:manifest.goal,repos:manifest.repos.length,bytes:manifest.bytes});
    }catch{items.push({id:name,directory:join(directory,name),status:'unavailable',goal:'任务包暂不可读取',createdAt:''});}
    items.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
    return {items:items.slice(0,50),truncated:items.length>50};
  }
  async export(input: TaskPackageInput, options: { directory?: string; signal?: AbortSignal } = {}) {
    if (!input.goal?.trim() || input.goal.length > 4000 || !input.source?.agent || !Array.isArray(input.notes) || input.notes.length > 100
      || input.notes.reduce((total, note) => total + (typeof note.text === 'string' ? note.text.length : 1000000), 0) > 48000) throw new Error('Invalid task package context');
    for (const note of input.notes) if (!['user', 'assistant', 'source'].includes(note.role) || !['background', 'requirement', 'decision', 'observation'].includes(note.kind) || !note.reference) throw new Error('Package context needs source roles');
    for (const selected of [input.resources, input.artifacts, input.evidence, input.memories]) if (selected && (!Array.isArray(selected) || selected.length > 30)) throw new Error('Task package selection budget exceeded');
    if (input.task) safeId(input.task);
    const packageId = id('package');
    const directory = options.directory ? resolve(options.directory) : join(await ensureDir(join(this.workspace.data, 'packages')), packageId);
    await realpath(dirname(directory));
    if (this.workspace.config.repos.some(repo => inside(repo.root, directory)) && !inside(this.workspace.data, directory)) throw new Error('Task package output cannot be inside source code');
    await mkdir(directory, { mode: 0o700 }); await mkdir(join(directory, 'blobs'), { mode: 0o700 });
    await writeJson(join(directory, 'state.json'), { status: 'preparing', id: packageId,task:input.task,createdAt:new Date().toISOString() });
    try {
      const manifest = await this.workspace.exclusive(async () => {
        options.signal?.throwIfAborted();
        if (!this.workspace.config.repos.length) throw new Error('Register repositories before packaging a task');
        const unresolved = (await this.workspace.operations()).filter(op => ['pending', 'unknown'].includes(op.status)).map(op => op.id);
        unresolved.push(...await new BackgroundRuns(this.workspace).unresolved());
        const selectedPlan = input.plan === undefined ? await new PlanStore(this.workspace).current() : input.plan;
        const checkpoint = input.checkpoint ? await this.workspace.loadCheckpoint(input.checkpoint) : await this.workspace.checkpoint('task package', { session: input.source.session, entry: input.source.entry, plan: selectedPlan ? { id: selectedPlan.id, revision: selectedPlan.revision } : null });
        if (checkpoint.repos.length !== this.workspace.config.repos.length) throw new Error('Package checkpoint must cover the current repository set');
        const observation = await this.workspace.observe();
        let common = dirname(this.workspace.config.repos[0]!.root);
        while (!this.workspace.config.repos.every(repo => inside(common, repo.root))) { const parent = dirname(common); if (parent === common) throw new Error('Package repositories require a common filesystem volume'); common = parent; }
        const manifest: TaskPackageManifest = { schema: 1, id: packageId, goal: input.goal, source: input.source, sourceWorkspace: this.workspace.root, task: input.task,
          checkpoint: checkpoint.id, createdAt: new Date().toISOString(), notes: input.notes, observation,
          environment: { node: process.version, executable: process.execPath, platform: process.platform, arch: process.arch },
          repos: [], runtime: { checks: structuredClone(this.workspace.config.checks), services: (await new ServiceManager(this.workspace).list()).map(item => item.service), browser: await new BrowserValidation(this.workspace).list(), recipes: await new RecipeStore(this.workspace).list() },
          plan: selectedPlan ?? undefined, materials: [], artifacts: [], evidence: [], memories: [], blobs: Object.create(null), bytes: 0, unresolved,
          note: 'Code and selected task data are a portable snapshot. Source HEAD/environment and evidence are provenance; target permissions, runtime activation and fresh acceptance are separate. No background process, native history or preference is activated.' };
        if (input.plan === undefined && checkpoint.plan) manifest.plan = await new PlanStore(this.workspace).load(checkpoint.plan.id, checkpoint.plan.revision);
        const blob = async (bytes: Buffer, code = false) => {
          options.signal?.throwIfAborted();
          if (bytes.length > 32000000) throw new Error('A task package file exceeds 32 MB');
          if (code && (this.workspace.secrets.some(secret => bytes.includes(Buffer.from(secret))) || redact(bytes.toString(), this.workspace.secrets) !== bytes.toString())) throw new Error('Package code contains a credential; move it to environment configuration before export');
          const key = hash(bytes);
          if (manifest.blobs[key] === undefined) {
            manifest.bytes += bytes.length; if (manifest.bytes > 128000000 || Object.keys(manifest.blobs).length >= 20000) throw new Error('Task package exceeds the 128 MB / 20,000 blob budget');
            await writeFile(join(directory, 'blobs', key), bytes, { mode: 0o600, flag: 'wx' }); manifest.blobs[key] = bytes.length;
          }
          return key;
        };
        const jsonBlob = async (value: unknown) => await blob(Buffer.from(redact(JSON.stringify(value), this.workspace.secrets)));
        for (const repo of this.workspace.config.repos) {
          const snapshot = checkpoint.repos.find(item => item.repo.id === repo.id)!;
          if (!snapshot) throw new Error('Package repository is absent from the checkpoint');
          const folder = safeRelative(relative(common, repo.root).split(sep).join('/'));
          for (const [file, version] of Object.entries(snapshot.files)) {
            safeRelative(file); const content = await readFile(join(this.workspace.data, 'blobs', version.hash));
            if (hash(content) !== version.hash) throw new Error('Source checkpoint blob is corrupt'); await blob(content, true);
          }
          manifest.repos.push({ repo: structuredClone(repo), directory: folder, head: snapshot.head, branch: snapshot.branch, files: snapshot.files });
        }
        const project = new ProjectContext(this.workspace);
        for (const resourceId of input.resources ?? []) {
          const material = await project.read(resourceId, { task: input.task });
          const capture = material.resource.source.kind === 'imported' && material.resource.source.capture ? await jsonBlob(await readResourceCapture(this.workspace, material.resource.source.capture.raw)) : undefined;
          manifest.materials.push({ resource: material.resource, current: material.current, blob: await blob(Buffer.from(material.content)), capture });
        }
        const artifacts = new Artifacts(this.workspace);
        for (const artifactId of input.artifacts ?? []) { const artifact = await artifacts.read(artifactId, input.task); manifest.artifacts.push({ record: artifact.record, blob: await blob(await readFile(artifact.path)) }); }
        for (const evidenceId of input.evidence ?? []) { const evidence = await this.workspace.evidenceStatus(evidenceId); manifest.evidence.push({ id: evidenceId, blob: await jsonBlob(evidence.entry), currentAtExport: evidence.valid }); }
        if (input.memories?.length) {
          const memory = await MemoryStore.open(this.workspace);
          for (const memoryId of input.memories) { const value = await memory.read(memoryId, input.memoryAccess); if (value.freshness !== 'current') throw new Error('Selected package memory is stale'); manifest.memories.push({ id: memoryId, blob: await jsonBlob(value) }); }
        }
        if (digest(observation) !== digest(await this.workspace.observe())) throw new Error('Workspace changed while capturing package materials');
        return JSON.parse(redact(JSON.stringify(manifest), this.workspace.secrets)) as TaskPackageManifest;
      });
      await writeJson(join(directory, 'manifest.json'), { manifest, hash: digest(manifest) });
      await writeJson(join(directory, 'state.json'), { status: 'complete', id: packageId,task:input.task,createdAt:manifest.createdAt });
      return { manifest, directory,manifestHash:digest(manifest) };
    } catch (error) { await writeJson(join(directory, 'state.json'), { status: 'failed', id: packageId,task:input.task,createdAt:new Date().toISOString(), error: redact(String(error), this.workspace.secrets) }); throw error; }
  }
  static async inspect(directory: string) {
    const requested = resolve(directory); if ((await lstat(requested)).isSymbolicLink()) throw new Error('Task package directory cannot be a symlink');
    const root = await realpath(requested);
    const read = async (file: string, maximum: number) => {
      const path = join(root, file);
      for (let cursor = path; cursor !== root; cursor = dirname(cursor)) if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Package source cannot traverse symlinks');
      const stat = await lstat(path); if (!stat.isFile() || stat.size > maximum) throw new Error('Package source exceeds its read budget'); return await readFile(path);
    };
    const state = JSON.parse((await read('state.json', 10000)).toString()) as { status: string; id: string };
    const envelope = JSON.parse((await read('manifest.json', 16000000)).toString()) as { manifest: TaskPackageManifest; hash: string }, manifest = envelope.manifest;
    if (manifest.schema !== 1 || state.status !== 'complete' || state.id !== manifest.id || digest(manifest) !== envelope.hash) throw new Error('Task package is incomplete or its manifest changed'); safeId(manifest.id);
    if (!Array.isArray(manifest.repos) || !manifest.repos.length || manifest.repos.length > 100 || !manifest.blobs || Object.keys(manifest.blobs).length > 20000
      || !manifest.runtime || !Array.isArray(manifest.notes) || !Array.isArray(manifest.unresolved) || !Array.isArray(manifest.materials) || !Array.isArray(manifest.artifacts) || !Array.isArray(manifest.evidence) || !Array.isArray(manifest.memories)
      ||typeof manifest.goal!=='string'||!manifest.goal.trim()||manifest.goal.length>4000||typeof manifest.sourceWorkspace!=='string'||typeof manifest.environment?.executable!=='string'
      ||!['checks','services','browser','recipes'].every(key=>Array.isArray((manifest.runtime as any)[key]))
      ||manifest.notes.some(note=>typeof note.text!=='string'||!['user','assistant','source'].includes(note.role)||!['background','requirement','decision','observation'].includes(note.kind))) throw new Error('Invalid package structure');
    const ids = new Set<string>(), folders: string[] = [];
    for (const repo of manifest.repos) {
      safeId(repo.repo.id); safeRelative(repo.directory);
      if(typeof repo.repo.root!=='string'||typeof repo.repo.role!=='string'||!Array.isArray(repo.repo.dependsOn)||repo.repo.dependsOn.some(dep=>typeof dep!=='string'))throw new Error('Invalid package repository');
      if (ids.has(repo.repo.id) || folders.some(folder => repo.directory === folder || repo.directory.startsWith(folder + '/') || folder.startsWith(repo.directory + '/'))) throw new Error('Package repository paths overlap');
      ids.add(repo.repo.id); folders.push(repo.directory);
      for (const [file, version] of Object.entries(repo.files)) { safeRelative(file); if (!/^[a-f0-9]{64}$/.test(version.hash) || !Number.isInteger(version.mode) || version.mode < 0 || version.mode > 0o777 || manifest.blobs[version.hash] === undefined) throw new Error('Invalid package file version'); }
    }
    for(const definition of [...manifest.runtime.checks,...manifest.runtime.services])if(!ids.has(definition.repo)||!Array.isArray(definition.argv)||!definition.argv.length||definition.argv.some(arg=>typeof arg!=='string'))throw new Error('Invalid package runtime definition');
    for(const recipe of manifest.runtime.recipes)if(typeof recipe.label!=='string'||!Array.isArray(recipe.steps))throw new Error('Invalid package recipe definition');
    let bytes = 0;
    for (const [key, size] of Object.entries(manifest.blobs)) {
      if (!/^[a-f0-9]{64}$/.test(key) || !Number.isSafeInteger(size) || size < 0 || size > 32000000) throw new Error('Invalid package blob');
      const content = await read(`blobs/${key}`, 32000000); if (content.length !== size || hash(content) !== key) throw new Error('Task package blob integrity mismatch'); bytes += size;
    }
    if (bytes > 128000000 || bytes !== manifest.bytes) throw new Error('Package total byte budget mismatch');
    if (manifest.materials.length > 30 || manifest.artifacts.length > 30 || manifest.evidence.length > 30 || manifest.memories.length > 30) throw new Error('Package selection budget exceeded');
    for (const material of manifest.materials) {
      if (manifest.blobs[material.blob] === undefined || material.resource.role !== 'reference' || hash(await read(`blobs/${material.blob}`, 1000000)) !== material.resource.contentHash) throw new Error('Package material version does not match its content');
      if (material.capture && manifest.blobs[material.capture] === undefined) throw new Error('Package source capture is missing');
    }
    for (const artifact of manifest.artifacts) if (artifact.record.hash !== artifact.blob || artifact.record.bytes !== manifest.blobs[artifact.blob]) throw new Error('Package artifact version mismatch');
    for (const evidence of manifest.evidence) if (manifest.blobs[evidence.blob] === undefined || JSON.parse((await read(`blobs/${evidence.blob}`, 32000000)).toString()).id !== evidence.id) throw new Error('Package evidence origin mismatch');
    for (const memory of manifest.memories) if (manifest.blobs[memory.blob] === undefined || JSON.parse((await read(`blobs/${memory.blob}`, 32000000)).toString()).record?.id !== memory.id) throw new Error('Package memory origin mismatch');
    return { manifest, directory: root,manifestHash:envelope.hash, blob: async (key: string) => { if (manifest.blobs[key] === undefined) throw new Error('Unknown package blob'); const content = await read(`blobs/${key}`, 32000000); if (content.length !== manifest.blobs[key] || hash(content) !== key) throw new Error('Package blob changed after inspection'); return content; } };
  }
  static async restore(directory: string, destination: string, options: PackageRestoreOptions = {}) {
    const packageData = await this.inspect(directory), manifest = packageData.manifest, requested = resolve(destination);
    if(options.expectedManifest!==undefined&&options.expectedManifest!==packageData.manifestHash)throw new Error('任务包在预览后已变化，请重新检查内容和仓库权限。');
    const target = join(await realpath(dirname(requested)), basename(requested));
    if (inside(packageData.directory, target) || manifest.repos.some(repo => inside(repo.repo.root, target)) && !inside(join(manifest.sourceWorkspace, '.enigma-next'), target)) throw new Error('Restore destination cannot be inside a package or source code');
    if (manifest.unresolved.length) throw new Error('Package has unresolved source effects; reconcile its source before creating an executable task');
    const map = (repo: string) => safeId(options.mapping?.[repo] ?? repo), writes = new Set(options.writeRepos ?? []);
    const taskScope = options.task ?? `restored-${manifest.id}`; safeId(taskScope);
    if (new Set(manifest.repos.map(repo => map(repo.repo.id))).size !== manifest.repos.length || [...writes].some(repo => !manifest.repos.some(item => map(item.repo.id) === repo))) throw new Error('Invalid target repository mapping or write grant');
    options.signal?.throwIfAborted(); await mkdir(target, { mode: 0o700 });
    const workspace = await Workspace.open(target), originPath = join(workspace.data, 'fork-origin.json');
    await writeJson(originPath, { state: 'pending', source: manifest.id, sourceWorkspace: manifest.sourceWorkspace });
    try {
      for (const item of manifest.repos) {
        options.signal?.throwIfAborted(); const root = join(target, 'repos', item.directory); await mkdir(root, { recursive: true, mode: 0o700 });
        // This fixed metadata operation initializes a newly validated directory;
        // it is not a model-supplied command in the source workspace sandbox.
        const initialized = await runProcess(['git', 'init', '-b', `codex/package-${manifest.id.slice(-12)}`], root, { signal: options.signal, timeoutMs: 30000,internalGit:true });
        if (initialized.status !== 'passed') throw new Error(`Cannot initialize restored repository: ${initialized.output}`);
        await workspace.exclusive(() => workspace.addRepo(map(item.repo.id), root, { role: item.repo.role, access: writes.has(map(item.repo.id)) ? 'write' : 'read' }));
        for (const [file, version] of Object.entries(item.files)) { const path = await workspace.path(map(item.repo.id), file); await mkdir(dirname(path), { recursive: true }); await writeFile(path, await packageData.blob(version.hash), { mode: version.mode, flag: 'wx' }); await chmod(path, version.mode); }
      }
      for (const item of manifest.repos) await workspace.exclusive(() => workspace.setDependencies(map(item.repo.id), item.repo.dependsOn.map(map)));
      const relocate = (argument: string) => relocatePackageArgument(argument, manifest, workspace, options.mapping);
      const runtime = structuredClone(manifest.runtime);
      if (options.checks) { if (options.checks.some(id => !runtime.checks.some(check => check.id === id))) throw new Error('Target check selection is not in the source definitions'); runtime.checks = runtime.checks.filter(check => options.checks!.includes(check.id)); }
      for (const check of runtime.checks) { check.repo = map(check.repo); check.argv = await Promise.all(check.argv.map(relocate)); }
      for (const service of runtime.services) { service.repo = map(service.repo); service.argv = await Promise.all(service.argv.map(relocate)); }
      for (const recipe of runtime.recipes) for (const step of recipe.steps) if (step.kind === 'command') { step.repo = map(step.repo); step.argv = await Promise.all(step.argv.map(relocate)); }
      await writeJson(join(workspace.data, 'imported-runtime.json'), { source: manifest.id, runtime, activated: options.activateRuntime ?? false });
      if (options.activateRuntime) {
        for (const check of runtime.checks) await workspace.exclusive(() => workspace.addCheck(check));
        for (const service of runtime.services) await new ServiceManager(workspace).add(service);
        for (const scenario of runtime.browser) await new BrowserValidation(workspace).add(scenario);
        for (const recipe of runtime.recipes) await new RecipeStore(workspace).save(recipe);
      }
      const resources: { source: string; target?: string; skipped?: string }[] = [];
      for (const material of manifest.materials) {
        if (material.current === false) { resources.push({ source: material.resource.id, skipped: 'Source material was already stale at export' }); continue; }
        const source = structuredClone(material.resource.source);
        if (source.kind === 'file') source.repo = map(source.repo);
        if (source.kind === 'imported' && source.capture && material.capture) {
          const raw = JSON.parse((await packageData.blob(material.capture)).toString()), key = digest(raw); await ensureDir(join(workspace.data, 'source-captures')); await writeJson(join(workspace.data, 'source-captures', `${key}.json`), raw); source.capture.raw = key;
        }
        const resource = await new ProjectContext(workspace).add({ ...material.resource, task: material.resource.task ? taskScope : undefined, repos: material.resource.repos.map(map), source, content: (await packageData.blob(material.blob)).toString() }); resources.push({ source: material.resource.id, target: resource.id });
      }
      const historical = await ensureDir(join(workspace.data, 'imported-history'));
      for (const evidence of manifest.evidence) await writeJson(join(historical, `${safeId(evidence.id)}.json`), { role: 'source', source: manifest.id, evidence: JSON.parse((await packageData.blob(evidence.blob)).toString()), activeAcceptance: false });
      for (const memory of manifest.memories) await writeJson(join(historical, `${safeId(memory.id)}.json`), { role: 'source', source: manifest.id, memory: JSON.parse((await packageData.blob(memory.blob)).toString()), activeMemory: false, note: 'Historical selected memory; current forgetting/scope requires source revalidation before future promotion.' });
      const artifactDirectory = await ensureDir(join(workspace.data, 'artifacts')), artifactBlobs = await ensureDir(join(artifactDirectory, 'blobs'));
      for (const artifact of manifest.artifacts) {
        const bytes = await packageData.blob(artifact.blob); await writeFile(join(artifactBlobs, artifact.blob), bytes, { flag: 'wx', mode: 0o600 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; });
        const record = { ...artifact.record, id: id('artifact'), task: artifact.record.task ? taskScope : undefined, entry: undefined, evidence: [], origin: { originalHash: artifact.blob, runtime: `imported-history/${manifest.id}/${artifact.record.id}` }, note: 'Historical artifact; source evidence is not target acceptance' };
        await writeJson(join(artifactDirectory, `${record.id}.json`), record);
      }
      let plan: TaskPlan | undefined;
      if (manifest.plan && options.activateRuntime && options.includePlan !== false) plan = await new PlanStore(workspace).create({ goal: manifest.plan.goal, steps: manifest.plan.steps.map(step => ({ id: step.id, repo: map(step.repo), goal: step.goal, requires: step.requires, checks: step.checks })) });
      await writeJson(join(workspace.data, 'package-origin.json'), { source: manifest.id, package: packageData.directory, manifestHash: digest(manifest), sourceEnvironment: manifest.environment, resources, historicalEvidence: manifest.evidence.map(item => item.id), runtimeActivated: options.activateRuntime ?? false });
      await writeJson(originPath, { state: 'complete', source: manifest.id, sourceWorkspace: manifest.sourceWorkspace });
      const handoffDirectory = await ensureDir(join(workspace.data, 'handoffs'));
      const handoffPath = join(handoffDirectory, id('context'));
      await exportHandoff(workspace, handoffPath, { mode: 'continue', goal: manifest.goal, planOverride: plan ?? null,
        source: { ...manifest.source, sessionFile: undefined }, notes: [...manifest.notes, { role: 'source', kind: 'observation', reference: `package:${manifest.id}`,
          text: `Restored code snapshot from ${manifest.checkpoint}; source repository HEADs and check results are historical. Current target root: ${workspace.root}. Runtime activation: ${options.activateRuntime ?? false}. All checks must run here.` }] });
      let piSession: { sessionFile: string; sessionId: string } | undefined;
      if (options.preparePi) {
        const { inspectHandoff } = await import('./handoff.js'), { importPiHandoff } = await import('./pi-session.js');
        piSession = await importPiHandoff(workspace, await inspectHandoff(workspace, handoffPath));
        const project = new ProjectContext(workspace);
        for (const resource of resources) if (resource.target) {
          const previous = await project.read(resource.target, { task: taskScope });
          if (previous.resource.task) {
            const rebound = await project.add({ ...previous.resource, task: piSession.sessionId, content: previous.content }); await project.remove(resource.target, { task: taskScope }); resource.target = rebound.id;
          }
        }
        for (const name of await (await import('node:fs/promises')).readdir(artifactDirectory)) if (name.endsWith('.json')) {
          const path = join(artifactDirectory, name), record = JSON.parse((await readFile(path)).toString()) as ArtifactRecord;
          if (record.task === taskScope) { record.task = piSession.sessionId; await writeJson(path, record); }
        }
        await writeJson(join(workspace.data, 'session-start.json'), { schema: 1, ...piSession });
        const origin = JSON.parse((await readFile(join(workspace.data, 'package-origin.json'))).toString());
        await writeJson(join(workspace.data, 'package-origin.json'), { ...origin, resources, piSession });
      }
      await workspace.exclusive(() => workspace.checkpoint('restored task package', { references: [], plan: plan ? { id: plan.id, revision: plan.revision } : null }));
      return { workspace, source: manifest, resources, plan, handoff: handoffPath, piSession, taskScope: piSession?.sessionId ?? taskScope, runtimeActivated: options.activateRuntime ?? false };
    } catch (error) { await writeJson(originPath, { state: 'failed', source: manifest.id, error: redact(String(error), workspace.secrets) }); throw error; }
  }
}
