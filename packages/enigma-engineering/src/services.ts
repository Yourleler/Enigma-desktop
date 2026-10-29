import { join } from 'node:path';
import { createServer, createConnection } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import type { Workspace } from './workspace.js';
import { BackgroundRuns, type BackgroundInput } from './background.js';
import { hash, readJson, safeId, writeJson,redact } from './storage.js';

export interface ServiceInput extends Omit<BackgroundInput, 'kind' | 'task'> {
  id: string; dependsOn?: string[]; readiness?: { type: 'http' | 'tcp' | 'log'; port?: number; path?: string; includes?: string; timeoutMs?: number };
  envFromServices?: Record<string, { service: string; value: 'url' | 'port' }>;
}
interface ServiceConfig { schema: 1; services: ServiceInput[] }
interface ServicePointer { schema: 1; runs: Record<string, { run: string; configuration: string; source?: Record<string, string>; dependencies?: Record<string, string> }> }
export class ServiceManager {
  readonly background: BackgroundRuns;
  constructor(readonly workspace: Workspace) { this.background = new BackgroundRuns(workspace); }
  private async config(): Promise<ServiceConfig> {
    try { const value = await readJson<ServiceConfig>(join(this.workspace.data, 'services.json')); if (value.schema !== 1 || !Array.isArray(value.services)) throw new Error('Invalid service configuration'); return value; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schema: 1, services: [] }; throw error; }
  }
  private async pointers(): Promise<ServicePointer> {
    try { const value = await readJson<ServicePointer>(join(this.workspace.data, 'service-runs.json')); if (value.schema !== 1 || !value.runs || Array.isArray(value.runs)) throw new Error('Invalid service run pointers'); return value; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schema: 1, runs: {} }; throw error; }
  }
  async definitions(){const config=await this.config();this.validate(config.services);return config.services;}
  private validate(services: ServiceInput[]) {
    if (services.length > 100) throw new Error('Service configuration budget exceeded');
    const ids = new Set<string>();
    for (const service of services) {
      safeId(service.id); this.workspace.repo(service.repo);
      if (ids.has(service.id) || !service.label?.trim() || service.label.length>200 || !Array.isArray(service.argv) || !service.argv.length || service.argv.length>256||service.argv.some(argument=>typeof argument!=='string'||argument.length>16000||argument.includes('\0'))|| (service.dependsOn && !Array.isArray(service.dependsOn))) throw new Error('Invalid service'); ids.add(service.id);
      if(service.maxRuntimeMs!==undefined&&(!Number.isSafeInteger(service.maxRuntimeMs)||service.maxRuntimeMs<1||service.maxRuntimeMs>86400000))throw new Error('Invalid service runtime budget');
      if(service.portPrefix!==undefined&&(typeof service.portPrefix!=='string'||!service.portPrefix||service.portPrefix.length>100))throw new Error('Invalid service port prefix');
      for(const [name,reference]of Object.entries(service.envRefs||{}))if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)||typeof reference!=='string'||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(reference))throw new Error('Use environment variable names for service credentials');
      if(redact(JSON.stringify(service),this.workspace.secrets)!==JSON.stringify(service))throw new Error('Use environment references instead of literal credentials in service configuration');
      if (service.readiness) {
        const ready = service.readiness;
        if (!['http', 'tcp', 'log'].includes(ready.type) || ready.port !== undefined && (!Number.isInteger(ready.port) || ready.port < 1 || ready.port > 65535)
          || ready.type !== 'log' && !ready.port && !service.portPrefix || ready.type === 'log' && !ready.includes
          || ready.path && !ready.path.startsWith('/') || ready.timeoutMs !== undefined && (!Number.isSafeInteger(ready.timeoutMs)||ready.timeoutMs < 1 || ready.timeoutMs > 120000)) throw new Error('Invalid service readiness');
      }
      for (const [name, reference] of Object.entries(service.envFromServices ?? {})) if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
        || !['url', 'port'].includes(reference.value) || !service.dependsOn?.includes(reference.service)) throw new Error('Service environment must refer to declared dependencies');
    }
    const visiting = new Set<string>(), visited = new Set<string>();
    const visit = (id: string) => {
      if (visiting.has(id)) throw new Error('Service dependencies contain a cycle'); if (visited.has(id)) return;
      const service = services.find(service => service.id === id); if (!service) throw new Error(`Unknown required service: ${id}`);
      visiting.add(id); (service.dependsOn ?? []).forEach(visit); visiting.delete(id); visited.add(id);
    }; services.forEach(service => visit(service.id));
  }
  async add(input: ServiceInput,expectedConfiguration?:string) {
    return await this.workspace.exclusive(async () => {
      const config = await this.config(), pointers = await this.pointers(), existing = pointers.runs[input.id];
      const previous=config.services.find(service=>service.id===input.id);
      if(expectedConfiguration!==undefined&&(!previous||hash(JSON.stringify(previous))!==expectedConfiguration))throw new Error('服务配置已变化，请重新打开当前配置再保存。');
      if(existing){const run=await this.background.status(existing.run);if(!run.terminal||run.state.status==='unknown'&&!run.reconciled)throw new Error('请先停止服务并核对未知运行效果，再修改启动配置。');}
      const services = [...config.services.filter(service => service.id !== input.id), input]; this.validate(services);
      await writeJson(join(this.workspace.data, 'services.json'), { schema: 1, services }); return input;
    });
  }
  private async probe(service: ServiceInput, state: Awaited<ReturnType<BackgroundRuns['status']>>['state']) {
    if (!['starting', 'running'].includes(state.status) || !service.readiness) return { ready: false, port: state.port ?? service.readiness?.port };
    const rule = service.readiness, port = state.port ?? rule.port;
    if (rule.type === 'log') return { ready: state.output.includes(rule.includes!), port };
    if (!port) return { ready: false, port };
    try {
      if (rule.type === 'tcp') {
        const ready = await new Promise<boolean>(resolve => {
          const socket = createConnection({ host: '127.0.0.1', port }); const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 1000);
          socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); }); socket.once('error', () => { clearTimeout(timer); resolve(false); });
        }); return { ready, port };
      }
      const response = await fetch(`http://127.0.0.1:${port}${rule.path ?? '/'}`, { signal: AbortSignal.timeout(1500) });
      let body = '', bytes = 0;
      if (rule.includes && response.body) for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 64000) throw new Error('Readiness body exceeded budget'); body += new TextDecoder().decode(chunk); }
      else await response.body?.cancel();
      return { ready: response.ok && (!rule.includes || body.includes(rule.includes)), port };
    } catch { return { ready: false, port }; }
  }
  async status(id: string, observedSource?: Record<string, string>) {
    const config = await this.config(); this.validate(config.services);
    const service = config.services.find(service => service.id === id); if (!service) throw new Error('Unknown service');
    const pointers = await this.pointers(), pointer = pointers.runs[id];
    if (!pointer) return { service,configuration:hash(JSON.stringify(service)), status: 'not-started', ready: false, port: service.readiness?.port };
    const run = await this.background.status(pointer.run);
    const current = pointer.configuration === hash(JSON.stringify(service));
    const dependenciesCurrent = (service.dependsOn ?? []).every(dependency => pointer.dependencies?.[dependency] === pointers.runs[dependency]?.run);
    const sourceCurrent = pointer.source !== undefined && JSON.stringify(pointer.source) === JSON.stringify(observedSource ?? await this.workspace.fingerprints());
    const active = ['starting', 'running'].includes(run.state.status), probe = current && dependenciesCurrent && sourceCurrent ? await this.probe(service, run.state) : { ready: false, port: run.state.port ?? service.readiness?.port };
    const readinessExpired=service.readiness&&Date.now()-Date.parse(run.spec.createdAt)>=(service.readiness.timeoutMs??30000);
    const status = !active ? run.state.status : !current ? 'configuration-changed' : !dependenciesCurrent ? 'dependency-changed' : !sourceCurrent ? 'source-changed' : probe.ready ? 'ready' : readinessExpired?'readiness-timeout':run.state.status;
    return { service,configuration:hash(JSON.stringify(service)), run: run.spec.id, status, ready: active && current && dependenciesCurrent && sourceCurrent && probe.ready, dependenciesCurrent, sourceCurrent, executionTerminal: run.terminal,
      reconciled:run.reconciled,
      port: probe.port, process: run.state, configurationCurrent: current, url: probe.port && service.readiness?.type === 'http' ? `http://127.0.0.1:${probe.port}` : undefined,
      note: 'Readiness observes a local endpoint/log and a live owned worker. It is not task acceptance or universal port ownership proof.' };
  }
  async list() { const config = await this.config(); this.validate(config.services); const source = config.services.length ? await this.workspace.fingerprints() : undefined; return await Promise.all(config.services.map(service => this.status(service.id, source))); }
  async start(id: string, options: { task?: string; signal?: AbortSignal } = {}, visiting = new Set<string>()) {
    if (visiting.has(id)) throw new Error('Service startup cycle'); visiting.add(id);
    const current = await this.status(id), service = current.service;
    if (current.ready) return current;
    if (['configuration-changed', 'dependency-changed', 'source-changed','readiness-timeout'].includes(current.status)||current.status==='unknown'&&(!('reconciled' in current)||!current.reconciled)) throw new Error('请先核对当前服务，停止或明确重启；不会悄悄替换正在运行的实例。');
    for (const dependency of service.dependsOn ?? []) {
      const ready = await this.start(dependency, options, new Set(visiting)); if (!ready.ready) throw new Error(`Dependency is not ready: ${dependency}`);
    }
    if (!['starting', 'running'].includes(current.status)) {
      if (service.readiness?.port) await new Promise<void>((resolve, reject) => {
        const probe = createServer(); probe.once('error', () => reject(new Error('Configured port is occupied; the existing process will not be stopped')));
        probe.listen(service.readiness!.port!, '127.0.0.1', () => probe.close(() => resolve()));
      });
      const environment: Record<string, string> = {};
      for (const [name, reference] of Object.entries(service.envFromServices ?? {})) {
        const dependency = await this.status(reference.service), value = reference.value === 'url' && 'url' in dependency ? dependency.url : dependency.port;
        if (!dependency.ready || value === undefined) throw new Error('Dependency environment value is not available'); environment[name] = String(value);
      }
      const source = await this.workspace.fingerprints(), launched = await this.background.start({ ...service, kind: 'service', task: options.task }, environment);
      await this.workspace.exclusive(async () => {
        const pointers = await this.pointers(), dependencies: Record<string, string> = {};
        for (const dependency of service.dependsOn ?? []) { const run = pointers.runs[dependency]?.run; if (!run) throw new Error('Required dependency run disappeared'); dependencies[dependency] = run; }
        pointers.runs[id] = { run: launched.spec.id, configuration: hash(JSON.stringify(service)), dependencies, source }; await writeJson(join(this.workspace.data, 'service-runs.json'), pointers);
      });
    }
    const deadline = Date.now() + (service.readiness?.timeoutMs ?? 30000);
    while (Date.now() < deadline) {
      if (options.signal?.aborted) { await this.stop(id); throw new Error('Service startup cancelled'); }
      const observed = await this.status(id);
      if (observed.ready || !['starting', 'running'].includes(observed.status) || !service.readiness) return observed;
      await delay(150);
    }
    return { ...await this.status(id), ready: false, status: 'readiness-timeout' };
  }
  async stop(id: string) {
    const pointer = (await this.pointers()).runs[id]; if (pointer) await this.background.cancel(pointer.run); return await this.status(id);
  }
  async restart(id: string, options: { task?: string; signal?: AbortSignal } = {}) { await this.stop(id); return await this.start(id, options); }
}
