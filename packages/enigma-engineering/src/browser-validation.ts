import { join,relative } from 'node:path';
import {readdir} from 'node:fs/promises';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { ensureDir, hash, id, readJson, safeId, writeJson, redact } from './storage.js';
import type { Workspace } from './workspace.js';
import { ServiceManager } from './services.js';
import type { Observation } from './types.js';
import {Artifacts} from './artifacts.js';

export type BrowserStep = { action: 'goto'; path: string } | { action: 'click' | 'check' | 'uncheck' | 'wait'; selector: string }
  | { action: 'fill' | 'select'; selector: string; value?: string; env?: string } | { action: 'press'; selector: string; key: string }
  | { action: 'expect'; selector: string; includes: string } | { action: 'screenshot'; label: string };
export interface BrowserScenario { id: string; label: string; service: string; steps: BrowserStep[]; timeoutMs?: number; allowedOrigins?: string[] }
export interface BrowserReport {
  schema: 1; id: string; scenario: string; configuration: string; serviceRun: string; status: 'passed' | 'failed' | 'cancelled' | 'stale';
  steps: { index: number; action: string; status: string; error?: string }[]; errors: string[]; screenshots: string[]; trace?: string; createdAt: string; sourceCurrent: boolean;
  observation: Observation;
  artifacts?:{id:string;title:string;kind:'screenshot'|'trace'}[];
  artifactErrors?:string[];
  scenarioLabel?:string;
}
export class BrowserValidation {
  constructor(readonly workspace: Workspace) {}
  private validate(scenario: BrowserScenario) {
    safeId(scenario.id); safeId(scenario.service);
    if (!scenario.label?.trim() || !Array.isArray(scenario.steps) || !scenario.steps.length || scenario.steps.length > 100
      || scenario.timeoutMs !== undefined && (!Number.isSafeInteger(scenario.timeoutMs) || scenario.timeoutMs < 1 || scenario.timeoutMs > 300_000)) throw new Error('Invalid browser scenario');
    for (const step of scenario.steps) {
      if (!['goto', 'click', 'check', 'uncheck', 'wait', 'fill', 'select', 'press', 'expect', 'screenshot'].includes(step.action)) throw new Error('Unknown browser action');
      if ('selector' in step && (typeof step.selector !== 'string' || !step.selector.length || step.selector.length > 500)) throw new Error('Invalid browser selector');
      if ('value' in step && step.value && this.workspace.secrets.some(secret => step.value!.includes(secret))) throw new Error('Use an environment reference for sensitive browser inputs');
      if ('env' in step && step.env && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(step.env)) throw new Error('Invalid browser environment reference');
    }
    for (const origin of scenario.allowedOrigins ?? []) { const url = new URL(origin); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.origin !== origin) throw new Error('Browser allowed origins must be explicit HTTP(S) origins'); }
  }
  private async scenarios() {
    try { const value = await readJson<{ schema: number; scenarios: BrowserScenario[] }>(join(this.workspace.data, 'browser-scenarios.json'));
      if (value.schema !== 1 || !Array.isArray(value.scenarios) || value.scenarios.length > 100) throw new Error('Invalid browser scenario registry'); value.scenarios.forEach(scenario => this.validate(scenario)); return value.scenarios;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
  async add(scenario: BrowserScenario) {
    this.validate(scenario); return await this.workspace.exclusive(async () => {
      const scenarios = [...(await this.scenarios()).filter(item => item.id !== scenario.id), scenario];
      await writeJson(join(this.workspace.data, 'browser-scenarios.json'), { schema: 1, scenarios }); return scenario;
    });
  }
  async list() { return await this.scenarios(); }
  async run(scenarioId: string, options: { signal?: AbortSignal;task?:string;entry?:string } = {}): Promise<BrowserReport> {
    const scenario = (await this.scenarios()).find(scenario => scenario.id === scenarioId); if (!scenario) throw new Error('Unknown browser scenario');
    const services = new ServiceManager(this.workspace), service = await services.status(scenario.service);
    if (!service.ready || !('url' in service) || !service.url || !('run' in service) || !service.run) throw new Error('Browser scenario requires a ready owned HTTP service');
    const configuration = hash(JSON.stringify(scenario)), observation = await this.workspace.observe(), runId = id('browser');
    const directory = await ensureDir(join(await ensureDir(join(this.workspace.data, 'browser-runs')), runId));
    const report: BrowserReport = { schema: 1, id: runId, scenario: scenario.id,scenarioLabel:scenario.label, configuration, serviceRun: service.run, status: 'failed', steps: [], errors: [], screenshots: [], createdAt: new Date().toISOString(), sourceCurrent: true, observation };
    let browser: Browser | undefined, context: BrowserContext | undefined, tracing = false; const abort = () => { void browser?.close().catch(() => {}); };
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), scenario.timeoutMs ?? 60_000);
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    signal.addEventListener('abort', abort, { once: true });
    try {
      signal.throwIfAborted(); browser = await chromium.launch({ headless: true, timeout: Math.min(scenario.timeoutMs ?? 30000, 30000) }); signal.throwIfAborted();
      context = await browser.newContext({ acceptDownloads: false });
      const origins = new Set([new URL(service.url).origin, ...scenario.allowedOrigins ?? []]);
      for (const ready of await services.list()) if (ready.ready && 'url' in ready && ready.url) origins.add(new URL(ready.url).origin);
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (['data:', 'blob:', 'about:'].includes(url.protocol) || origins.has(url.origin)) return route.continue();
        report.errors.push(`Blocked request outside scenario origins: ${redact(url.origin, this.workspace.secrets)}`); return route.abort();
      });
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true }); tracing = true;
      const page = await context.newPage(); page.setDefaultTimeout(10_000);
      page.on('pageerror', error => report.errors.push(redact(error.message, this.workspace.secrets)));
      page.on('console', message => { if (message.type() === 'error') report.errors.push(redact(message.text(), this.workspace.secrets).slice(0, 2000)); });
      await page.goto(service.url);
      for (const [index, step] of scenario.steps.entries()) {
        signal.throwIfAborted();
        try {
          if (step.action === 'goto') { const url = new URL(step.path, service.url); if (!origins.has(url.origin)) throw new Error('Navigation origin is outside scenario scope'); await page.goto(url.href); }
          else if (step.action === 'screenshot') { const path = join(directory, `${index}-${safeId(step.label)}.png`); await page.screenshot({ path, fullPage: true }); report.screenshots.push(path); }
          else {
            const locator = page.locator(step.selector);
            if (step.action === 'click') await locator.click();
            else if (step.action === 'check') await locator.check();
            else if (step.action === 'uncheck') await locator.uncheck();
            else if (step.action === 'press') await locator.press(step.key);
            else if (step.action === 'wait') await locator.waitFor({ state: 'visible' });
            else if (step.action === 'fill' || step.action === 'select') {
              const value = step.env ? process.env[step.env] : step.value; if (value === undefined) throw new Error('Browser input is unavailable');
              if (step.action === 'fill') await locator.fill(value); else await locator.selectOption(value);
            } else if (step.action === 'expect') {
              await locator.filter({ hasText: step.includes }).waitFor({ state: 'visible' });
              if (!(await locator.textContent())?.includes(step.includes)) throw new Error('Expected visible text was absent');
            }
          }
          report.steps.push({ index, action: step.action, status: 'passed' });
        } catch (error) { report.steps.push({ index, action: step.action, status: 'failed', error: redact(String(error), this.workspace.secrets) }); throw error; }
      }
      report.status = report.errors.length ? 'failed' : 'passed';
      report.trace = join(directory, 'trace.zip'); await context.tracing.stop({ path: report.trace }); tracing = false;
      await context.close();
    } catch (error) { report.status = signal.aborted ? 'cancelled' : 'failed'; report.errors.push(redact(String(error), this.workspace.secrets)); }
    finally {
      if (tracing && context) try { report.trace = join(directory, 'trace.zip'); await context.tracing.stop({ path: report.trace }); } catch { report.trace = undefined; }
      clearTimeout(timer); signal.removeEventListener('abort', abort); await browser?.close().catch(() => {});
      report.sourceCurrent = JSON.stringify(observation) === JSON.stringify(await this.workspace.observe());
      const currentScenario = (await this.scenarios()).find(item => item.id === scenario.id), currentService = await services.status(scenario.service);
      if (hash(JSON.stringify(currentScenario)) !== configuration || !('run' in currentService) || currentService.run !== service.run) report.sourceCurrent = false;
      if (report.status === 'passed' && !report.sourceCurrent) report.status = 'stale';
      if(options.task){
        const artifacts=new Artifacts(this.workspace);report.artifacts=[];report.artifactErrors=[];
        for(const [index,file] of report.screenshots.entries())try{const record=await artifacts.add({title:`${scenario.label} · 截图 ${index+1}`,kind:'screenshot',task:options.task,entry:options.entry,runtime:relative(this.workspace.data,file)});report.artifacts.push({id:record.id,title:record.title,kind:'screenshot'});}catch{report.artifactErrors.push('截图成果登记失败，原运行目录中的文件仍保留。');}
        if(report.trace)try{const record=await artifacts.add({title:`${scenario.label} · 浏览器轨迹`,kind:'trace',task:options.task,entry:options.entry,runtime:relative(this.workspace.data,report.trace)});report.artifacts.push({id:record.id,title:record.title,kind:'trace'});}catch{report.artifactErrors.push('轨迹成果登记失败，原文件仍保留。');}
      }
      await writeJson(join(directory, 'report.json'), report);
    }
    return report;
  }
  async read(run: string,context?:{observation:Observation;services:Awaited<ReturnType<ServiceManager['list']>>}) {
    const report = await readJson<BrowserReport>(join(this.workspace.data, 'browser-runs', safeId(run), 'report.json'));
    if (report.schema !== 1 || report.id !== run||!Array.isArray(report.steps)||!Array.isArray(report.errors)||!Array.isArray(report.screenshots)) throw new Error('Invalid browser report');
    const scenario = (await this.scenarios()).find(item => item.id === report.scenario), service = scenario ? context?context.services.find(item=>item.service.id===scenario.service):await new ServiceManager(this.workspace).status(scenario.service) : undefined;
    return { report,scenarioLabel:report.scenarioLabel||scenario?.label, sourceCurrent: JSON.stringify(report.observation) === JSON.stringify(context?.observation||await this.workspace.observe()), configurationCurrent: hash(JSON.stringify(scenario)) === report.configuration, serviceCurrent: !!service && 'run' in service && service.run === report.serviceRun,serviceReady:!!service?.ready,
      note: 'Trace/screenshots can include sensitive application data. They stay local and are not published automatically. Passing this scenario is not universal task acceptance.' };
  }
  async reports(services?:Awaited<ReturnType<ServiceManager['list']>>) {
    let names:string[];try{names=await readdir(join(this.workspace.data,'browser-runs'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {items:[],total:0,unavailable:0};throw error;}
    const records:BrowserReport[]=[];let unavailable=0;
    for(const name of names)try{const record=await readJson<BrowserReport>(join(this.workspace.data,'browser-runs',safeId(name),'report.json'));if(record.schema!==1||record.id!==name)throw new Error('Invalid browser report');records.push(record);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')unavailable++;}
    records.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));if(!records.length)return {items:[],total:0,unavailable};
    const context={observation:await this.workspace.observe(),services:services||await new ServiceManager(this.workspace).list()},items=[];
    for(const record of records.slice(0,20))try{items.push(await this.read(record.id,context));}catch{unavailable++;}
    return {items,total:records.length,unavailable};
  }
}
