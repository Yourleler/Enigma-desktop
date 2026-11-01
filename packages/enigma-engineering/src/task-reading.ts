import { readFile,readdir,stat } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';
import type { Workspace } from './workspace.js';
import type { ReadingResult, SourceLocation } from './reading.js';
import { repoGraph } from './reading.js';
import { ReadingStore } from './reading-store.js';
import { discoverContracts } from './contracts.js';
import { ProjectContext } from './project-context.js';
import { SourceIndex } from './source-index.js';
import { ensureDir, id, readJson, redact, safeId, writeJson,hash } from './storage.js';
import type {Observation,Evidence} from './types.js';
import {emitActivity} from './telemetry.js';

type Role = 'entry' | 'contract' | 'implementation' | 'consumer' | 'test' | 'configuration' | 'documentation';
type ReadingChange={repo:string;file:string;change:string;patch?:string;after?:{omitted?:string}};
export interface TaskReadingInput {
  goal: string; queries?: { symbol: string; repo?: string }[]; baseline?: string; task?: string;
  resources?: string[]; expectedRepos?: string[]; expectedFiles?: { repo: string; file: string }[];
  requirements?: { id: string; text: string; checks?: string[] }[]; maxQueries?: number; maxFiles?: number;
  changes?: ReadingChange[];
}
export interface TaskReading {
  schema: 1; id: string; revision: number; goal: string; task?: string; createdAt: string; evidence: string; reader?: string;
  nodes: { id: string; source: SourceLocation; role: Role; responsibility: string }[];
  edges: { from: string; to: string; kind: string; confidence: string }[];
  path: { order: number; node: string; reason: string }[];
  chapters?: { id: string; title: string; summary: string; nodes: string[]; authority: 'navigation-hint' | 'model-inference' }[];
  layers?: { id: string; title: string; summary: string; nodes: string[]; authority: 'navigation-hint' | 'model-inference' }[];
  architecture: { repo: string; responsibility: string; nodes: string[]; dependsOn: string[] }[];
  groups: { id: string; files: { repo: string; file: string; classification: string; reason: string; patch?: string }[]; nodes: string[]; classification: string }[];
  contracts: Awaited<ReturnType<typeof discoverContracts>>;
  resources: { id: string; revision: number; current: boolean | null }[];
  requirements: { id: string; text: string; checks: string[]; status: 'unassessed' | 'supported' | 'conflict' | 'insufficient'; anchors: string[]; explanation?: string }[];
  insights: { title: string; text: string; anchors: string[]; kind: 'explanation' | 'risk'; authority: 'model-inference' }[];
  unexpected: { repo: string; file: string; reason: string }[];
  sourceCoverage?: {
    files: {repo:string;file:string;status:'symbols'|'excerpt'|'deleted'|'unavailable'|'budget';reason?:string;partial?:boolean}[];
    outlineFiles: {examined:number;total:number};
    symbolQueries: {completed:number;limit:number;pending:number};
  };
  modelCoverage?: {
    status:'pending'|'partial'|'complete';requests:number;completedRequests:number;plannedRequests:number;
    nodes:number;totalNodes:number;changes:number;totalChanges:number;edges:number;totalEdges:number;
    characters:number;clippedNodes:number;clippedPatches:number;
  };
  gaps: string[]; truncated: boolean;
}

function sourceRole(source: SourceLocation): Role {
  if (/(^|[/_.-])(test|tests|spec)([/_.-]|$)|_test\.go$/.test(source.file) || source.kind === 'test-reference') return 'test';
  if (/\.(md|txt|rst|adoc)$/i.test(source.file)) return 'documentation';
  if (/Interface|TypeAlias|go-symbol-11|\.proto$|\.thrift$/.test(source.kind + source.file)) return 'contract';
  if (/config|settings|\.json$|\.ya?ml$/.test(source.file)) return 'configuration';
  if (/route|handler|controller|main|entry|server/.test(`${source.file} ${source.symbol}`)) return 'entry';
  if (/call-site|source-reference|import-binding/.test(source.kind)) return 'consumer';
  return 'implementation';
}
const roles: Role[] = ['entry', 'contract', 'implementation', 'consumer', 'test', 'configuration', 'documentation'];
function candidateSymbols(file: string, text: string, patch?: string) {
  const ranges = [...patch?.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm) ?? []].map(match => ({ start: Number(match[1]), end: Number(match[1]) + Number(match[2] ?? 1) }));
  const intersects = (start: number, end: number) => !ranges.length || ranges.some(range => start <= range.end && end >= range.start);
  const candidates: string[] = [];
  if (/\.[cm]?[jt]sx?$/.test(file)) {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)
        || ts.isMethodDeclaration(node) || ts.isVariableDeclaration(node)) && node.name && intersects(source.getLineAndCharacterOfPosition(node.getStart()).line + 1, source.getLineAndCharacterOfPosition(node.end).line + 1)) {
        candidates.push(node.name.getText(source));
      }
      ts.forEachChild(node, visit);
    }; visit(source);
  } else for (const [offset, line] of text.split('\n').entries()) {
    const match = file.endsWith('.go') ? /^\s*(?:func\s+(?:\([^)]*\)\s*)?|type\s+)([\w]+)\b/.exec(line) : /^\s*(?:async\s+)?(?:def|class)\s+(\w+)\b/.exec(line);
    if (match && intersects(offset + 1, offset + 40)) candidates.push(match[1]!);
  }
  return [...new Set(candidates)];
}

/** Task-oriented graph built from actual source facts; narratives stay explicitly advisory. */
export class TaskReadingStore {
  constructor(readonly workspace: Workspace) {}
  private async directory() { return await ensureDir(join(this.workspace.data, 'task-readings')); }
  private path(report: string, revision: number) { safeId(report); if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Invalid task reading revision'); return join(this.workspace.data, 'task-readings', `${report}-${revision}.json`); }
  async build(input: TaskReadingInput, signal?: AbortSignal): Promise<TaskReading> {
    if (!input.goal?.trim() || input.goal.length > 4000 || (input.resources?.length ?? 0) > 30 || (input.requirements?.length ?? 0) > 100) throw new Error('Invalid task reading input');
    const maxQueries = input.maxQueries ?? 12;
    if (!Number.isInteger(maxQueries) || maxQueries < 1 || maxQueries > 40) throw new Error('Invalid task reading query budget');
    return await this.workspace.exclusive(async () => {
      const observation = await this.workspace.observe(); const gaps: string[] = []; let truncated = false;
      const reader = await new ReadingStore(this.workspace).readerVersion(signal);
      const graph = await repoGraph(this.workspace), contexts = new ProjectContext(this.workspace);
      input.expectedRepos?.forEach(repo => this.workspace.repo(repo));
      const resources = await Promise.all((input.resources ?? []).map(async id => {
        const read = await contexts.read(id, { task: input.task });
        if (read.current === false) gaps.push(`Project material ${id} is stale.`);
        if (read.current === null) gaps.push(`Imported material ${id} has not been revalidated against its remote source.`);
        return { id, revision: read.resource.revision, current: read.current };
      }));
      let changes: ReadingChange[] = input.changes ?? [];
      for (const change of changes) await this.workspace.path(change.repo, change.file);
      if (input.baseline) {
        const baseline = await this.workspace.loadCheckpoint(input.baseline), target = await this.workspace.checkpoint('task reading target');
        changes = await this.workspace.compare(baseline.id, target.id);
      }
      const queue = [...input.queries ?? []];
      const outlineFiles={examined:0,total:0};
      if (!queue.length) {
        const candidates = changes.length ? changes : (await new SourceIndex(this.workspace).select(input.goal, { maxFiles: 12, signal })).files.filter(file => file.score > 0);
        outlineFiles.total=candidates.length;outlineFiles.examined=Math.min(24,candidates.length);
        if(candidates.length>24){truncated=true;gaps.push(`Symbol outlines examined 24 of ${candidates.length} candidate files; remaining changes retain per-file coverage.`);}
        for (const item of candidates.slice(0, 24)) {
          try {
            const bytes = await readFile(await this.workspace.path(item.repo, item.file)); if (bytes.length > 512000) { gaps.push(`Outline budget exceeded: ${item.repo}:${item.file}`); continue; }
            const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            for (const symbol of candidateSymbols(item.file, text, 'patch' in item ? item.patch : undefined)) queue.push({ symbol, repo: item.repo });
          } catch (error) { gaps.push(`Could not outline ${item.repo}:${item.file}: ${String(error)}`); }
        }
      }
      const seen = new Set<string>(), readings: ReadingResult[] = [];
      while (queue.length && readings.length < maxQueries) {
        if (signal?.aborted) throw new Error('Task reading cancelled');
        const query = queue.shift()!, key = `${query.repo ?? '*'}:${query.symbol}`;
        if (seen.has(key)) continue; seen.add(key);
        if (!query.symbol.trim() || query.symbol.length > 160) continue;
        emitActivity({kind:'update',stage:'reading.analyze',repo:query.repo,reference:key,count:readings.length+1,detail:`源码查询 ${readings.length+1}/${maxQueries}：${query.symbol}`},this.workspace.activity);
        const reading = await new ReadingStore(this.workspace).update(query.symbol, { repo: query.repo, maxFiles: input.maxFiles, signal });
        readings.push(reading); gaps.push(...reading.diagnostics ?? []); truncated ||= reading.truncated;
        if (!reading.symbols.length) gaps.push(`No resolved source definition for ${key}.`);
        for (const reference of reading.references) {
          if (reference.owner && reference.owner !== query.symbol) queue.push({ symbol: reference.owner, repo: reference.repo });
          if (reference.kind === 'outgoing-call' && reference.target) queue.push({ symbol: reference.target.symbol, repo: reference.target.repo });
        }
      }
      if (queue.some(query=>!seen.has(`${query.repo??'*'}:${query.symbol}`))) { truncated = true; gaps.push('Further source expansion remains outside the query budget.'); }
      if (!readings.length) gaps.push('No source query could be derived; provide entry symbols or a diff baseline.');
      const nodes = new Map<string, TaskReading['nodes'][number]>(), edges = new Map<string, TaskReading['edges'][number]>();
      for (const reading of readings) {
        for (const node of reading.map?.nodes ?? []) if (!nodes.has(node.id)) nodes.set(node.id, { ...node, role: sourceRole(node.source), responsibility: this.workspace.repo(node.source.repo).role });
        for (const edge of reading.map?.edges ?? []) edges.set(`${edge.from}:${edge.to}:${edge.kind}`, edge);
      }
      // Documents and small configuration edits may have no language symbol.
      // Keep a literal, versioned excerpt rather than dropping them from reading.
      const coverageFiles:NonNullable<TaskReading['sourceCoverage']>['files']=[];
      const locatedFiles=new Set([...nodes.values()].map(n=>`${n.source.repo}:${n.source.file}`));
      let excerptBytes=0;
      for(const change of changes){
        signal?.throwIfAborted();
        const identity={repo:change.repo,file:change.file};
        if(locatedFiles.has(`${change.repo}:${change.file}`)){coverageFiles.push({...identity,status:'symbols'});continue;}
        if(change.change==='deleted'){coverageFiles.push({...identity,status:'deleted',reason:'文件已删除，请在全量 Diff 查看保存的旧版本。'});continue;}
        if(change.after?.omitted){coverageFiles.push({...identity,status:'unavailable',reason:change.after.omitted==='Binary or source reading budget exceeded'?'冻结版本未保存文本：二进制或超出源码读取预算。':`冻结版本未保存文本：${change.after.omitted}`});continue;}
        if(excerptBytes>=64_000_000){coverageFiles.push({...identity,status:'budget',reason:'本次文件片段读取已达到64MB预算。'});truncated=true;continue;}
        try{
          const filePath=await this.workspace.path(change.repo,change.file),info=await stat(filePath);
          if(info.size>512000){coverageFiles.push({...identity,status:'budget',reason:'文件超过512KB片段读取预算。'});truncated=true;continue;}
          const bytes=await readFile(filePath);excerptBytes+=bytes.length;
          if(bytes.length>512000){coverageFiles.push({...identity,status:'budget',reason:'文件超过512KB片段读取预算。'});truncated=true;continue;}
          if(bytes.includes(0)){coverageFiles.push({...identity,status:'unavailable',reason:'二进制文件没有文本源码片段。'});continue;}
          const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),lines=text.split('\n');
          const start=Math.max(1,Math.min(lines.length,Number(/@@ -\d+(?:,\d+)? \+(\d+)/.exec(change.patch||'')?.[1])||1));
          const excerpt=lines.slice(start-1,start+39).join('\n'),partial=start>1||lines.length>40||excerpt.length>6000;
          const source:SourceLocation={repo:change.repo,file:change.file,line:start,endLine:Math.min(lines.length,start+39),hash:hash(bytes),symbol:change.file,kind:'file-excerpt',snippet:excerpt.slice(0,6000),truncated:partial};
          const nodeId=`file-${hash(`${change.repo}:${change.file}`).slice(0,20)}`;nodes.set(nodeId,{id:nodeId,source,role:sourceRole(source),responsibility:'固定版本文件片段；未推断调用关系'});
          coverageFiles.push({...identity,status:'excerpt',partial});
        }catch{coverageFiles.push({...identity,status:'unavailable',reason:'文件片段无法读取或不是UTF-8文本。'});gaps.push(`Unavailable file excerpt: ${change.repo}/${change.file}`);}
      }
      const omittedCoverage=coverageFiles.filter(file=>file.status==='unavailable'||file.status==='budget');
      if(omittedCoverage.length)gaps.push(`${omittedCoverage.length} changed files have no readable source excerpt; inspect the per-file coverage and full diff.`);
      const ordered = [...nodes.values()].sort((a, b) => roles.indexOf(a.role) - roles.indexOf(b.role) || `${a.source.repo}:${a.source.file}:${a.source.line}`.localeCompare(`${b.source.repo}:${b.source.file}:${b.source.line}`, undefined, { numeric: true }));
      const changedFiles = changes.map(change => ({ ...change,
        classification: /\.(md|txt|rst)$/.test(change.file) ? 'documentation' : /_test\.go$|(^|\/)test[s]?\/|\.(test|spec)\./.test(change.file) ? 'test' : /\.gen\.|lock\.(json|yaml)$|\.lock$/.test(change.file) ? 'mechanical-candidate' : 'behavioral-or-unknown',
        reason: /\.gen\.|lock\.(json|yaml)$|\.lock$/.test(change.file) ? 'Generated/lock file naming suggests mechanical output; dependency and runtime effects still require inspection.' : 'Classification is a navigation hint; it does not waive review or acceptance.' }));
      // Connected components group files only when actual source relations connect them.
      const fileKey = (source: SourceLocation) => `${source.repo}:${source.file}`;
      const groups = new Map<string, string>();
      const root = (key: string): string => {
        if(!groups.has(key)){groups.set(key,key);return key;}
        let current=key;const trail:string[]=[];
        while(groups.get(current)!==current){trail.push(current);current=groups.get(current)!;}
        for(const item of trail)groups.set(item,current);
        return current;
      };
      for (const file of changedFiles) root(`${file.repo}:${file.file}`);
      for (const edge of edges.values()) {
        const from = nodes.get(edge.from), to = nodes.get(edge.to); if (!from || !to || edge.confidence !== 'confirmed') continue;
        const a = fileKey(from.source), b = fileKey(to.source);
        if (groups.has(a) && groups.has(b)) groups.set(root(b), root(a));
      }
      const grouped = new Map<string, typeof changedFiles>();
      for (const file of changedFiles) { const key = root(`${file.repo}:${file.file}`); grouped.set(key, [...grouped.get(key) ?? [], file]); }
      const contracts = await discoverContracts(this.workspace, { maxFiles: input.maxFiles, signal });
      for (const definition of contracts.schemas.definitions) {
        const node = { id: definition.id, source: definition.source, role: 'contract' as const, responsibility: this.workspace.repo(definition.source.repo).role };
        if (!nodes.has(node.id)) { nodes.set(node.id, node); ordered.push(node); }
      }
      for (const relation of contracts.schemas.relations) if (nodes.has(relation.from) && nodes.has(relation.to)) edges.set(`${relation.from}:${relation.to}:schema`, relation);
      ordered.sort((a, b) => roles.indexOf(a.role) - roles.indexOf(b.role) || a.id.localeCompare(b.id));
      gaps.push(...contracts.schemas.diagnostics); truncated ||= contracts.schemas.truncated;
      const unexpected = changes.filter(change => input.expectedFiles?.length ? !input.expectedFiles.some(file => file.repo === change.repo && file.file === change.file)
        : input.expectedRepos?.length ? !input.expectedRepos.includes(change.repo) : false).map(change => ({ repo: change.repo, file: change.file, reason: 'Change is outside the explicitly supplied expected scope; confirm whether the task needs this expansion.' }));
      if (!input.expectedRepos?.length && !input.expectedFiles?.length) gaps.push('No explicit expected change scope; nonexpected changes cannot be decided from goal wording alone.');
      const requirements: TaskReading['requirements'] = (input.requirements ?? []).map(requirement => {
        safeId(requirement.id);
        for (const check of requirement.checks ?? []) if (!this.workspace.config.checks.some(item => item.id === check)) throw new Error(`Unknown requirement check: ${check}`);
        return { ...requirement, checks: requirement.checks ?? [], anchors: [], status: 'unassessed' };
      });
      if (new Set(requirements.map(item => item.id)).size !== requirements.length) throw new Error('Requirement ids must be unique');
      const evidence = await this.workspace.evidence('reading', { observation, sources: [...readings.flatMap(reading => reading.sources), ...contracts.sources, ...graph.sources] });
      if (!evidence.validAtCapture) throw new Error('Source changed while building the task reading; refresh required');
      if (reader !== await new ReadingStore(this.workspace).readerVersion(signal)) throw new Error('Reader tool version changed during analysis');
      const report: TaskReading = { schema: 1, id: id('task-reading'), revision: 1, goal: input.goal, task: input.task, reader, createdAt: new Date().toISOString(), evidence: evidence.id,
        nodes: ordered, edges: [...edges.values()], path: ordered.map((node, index) => ({ order: index + 1, node: node.id, reason: `Suggested ${node.role} reading; source location and relation can be checked independently.` })),
        architecture: graph.repos.map(repo => ({ repo: repo.id, responsibility: repo.role, nodes: ordered.filter(node => node.source.repo === repo.id).map(node => node.id), dependsOn: graph.edges.filter(edge => edge.from === repo.id).map(edge => edge.to) })),
        groups: [...grouped.values()].map((files, index) => ({ id: `change-${index + 1}`, files, nodes: ordered.filter(node => files.some(file => file.repo === node.source.repo && file.file === node.source.file)).map(node => node.id),
          classification: files.every(file => file.classification === 'mechanical-candidate') ? 'mechanical-candidate' : 'requires-reading' })),
        chapters: roles.map(role => ({ id: `read-${role}`, title: role, summary: `Source-backed ${role} locations; expand each node for actual code.`, nodes: ordered.filter(node => node.role === role).map(node => node.id), authority: 'navigation-hint' as const })).filter(chapter => chapter.nodes.length),
        layers: graph.repos.map(repo => ({ id: `repo-${repo.id}`, title: repo.role, summary: 'Repository responsibility declared by the workspace; not an inferred runtime architecture.', nodes: ordered.filter(node => node.source.repo === repo.id).map(node => node.id), authority: 'navigation-hint' as const })),
        contracts, resources, requirements, insights: [], unexpected, sourceCoverage:{files:coverageFiles,outlineFiles,symbolQueries:{completed:readings.length,limit:maxQueries,pending:new Set(queue.map(q=>`${q.repo??'*'}:${q.symbol}`).filter(key=>!seen.has(key))).size}},gaps: [...new Set(gaps)], truncated };
      await this.directory(); await this.publish(report); return report;
    });
  }
  private async publish(report: TaskReading) {
    const safe = JSON.parse(redact(JSON.stringify(report), this.workspace.secrets)) as TaskReading;
    await writeJson(this.path(report.id, report.revision), safe);
    await writeJson(join(await this.directory(), `${safeId(report.id)}.json`), { revision: report.revision });
  }
  private async load(reportId:string,task?:string){
    const pointer = await readJson<{ revision: number }>(join(await this.directory(), `${safeId(reportId)}.json`));
    const report = await readJson<TaskReading>(this.path(reportId, pointer.revision));
    if (report.schema !== 1 || report.id !== reportId || report.revision !== pointer.revision || !Array.isArray(report.nodes)) throw new Error('Invalid task reading artifact');
    if (report.task && report.task !== task) throw new Error('Reading belongs to another task');
    return report;
  }
  async open(reportId: string, task?: string,context?:{reader:string;observation:Observation}) {
    const report=await this.load(reportId,task),issues:string[]=[];
    const readerCurrent = report.reader === (context?.reader||await new ReadingStore(this.workspace).readerVersion());
    let current=false;
    try{
      if(context){const evidence=await readJson<Evidence>(join(this.workspace.data,'evidence',safeId(report.evidence)+'.json'));current=evidence.validAtCapture===true&&evidence.configuration===context.observation.configuration&&evidence.environment===context.observation.environment&&JSON.stringify(evidence.fingerprints)===JSON.stringify(context.observation.fingerprints);}
      else current=(await this.workspace.evidenceStatus(report.evidence)).valid;
    }catch{issues.push('地图的原始来源证据暂不可读取。');}
    if(!current)issues.push('源码、环境或配置与生成地图时不一致，使用前请重新生成。');
    current&&=readerCurrent;
    if(!readerCurrent)issues.push('代码阅读器已变化，需要重新生成地图。');
    for (const resource of report.resources) try {
      const read = await new ProjectContext(this.workspace).read(resource.id, { task });
      if (read.resource.revision !== resource.revision || read.current === false) {current = false;issues.push('地图引用的背景资料已更新。');}
    } catch { current = false;issues.push('地图引用的背景资料已移除或不可读取。'); }
    return { report, current, readerCurrent,issues:[...new Set(issues)] };
  }
  async list(task?:string){
    const names=(await readdir(await this.directory())).filter(name=>/^task-reading-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.json$/i.test(name)),records:TaskReading[]=[],unavailable:{id:string;reason:string}[]=[];
    for(const name of names)try{records.push(await this.load(name.slice(0,-5),task));}catch(error){if(!(error as Error).message.includes('another task'))unavailable.push({id:name.slice(0,-5),reason:'地图记录暂不可读取。'});}
    records.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));if(!records.length)return {items:[],unavailable,truncated:false};
    const context={reader:await new ReadingStore(this.workspace).readerVersion(),observation:await this.workspace.observe()},items=[];
    for(const record of records.slice(0,30))items.push(await this.open(record.id,task,context));
    return {items,unavailable,truncated:records.length>30};
  }
  async annotate(reportId: string, expectedRevision: number, input: {
    insights?: { title: string; text: string; anchors: string[]; kind: 'explanation' | 'risk' }[];
    requirements?: { id: string; status: 'supported' | 'conflict' | 'insufficient'; anchors: string[]; explanation: string }[];
    chapters?: { id: string; title: string; summary: string; nodes: string[] }[];
    layers?: { id: string; title: string; summary: string; nodes: string[] }[];
  }, task?: string,modelCoverage?:TaskReading['modelCoverage']) {
    return await this.workspace.exclusive(async () => {
      const opened = await this.open(reportId, task); if (!opened.current || opened.report.revision !== expectedRevision) throw new Error('Task reading source or revision changed; read the current map before annotation');
      const report = structuredClone(opened.report), nodes = new Set(report.nodes.map(node => node.id));
      const check = (anchors: string[], text: string, maximum = 20) => {
        if (!Array.isArray(anchors) || anchors.length > maximum || anchors.some(anchor => !nodes.has(anchor)) || !text.trim() || text.length > 6000) throw new Error('Annotation needs bounded text and actual published source anchors');
      };
      if ((input.insights?.length ?? 0) > 30 || (input.requirements?.length ?? 0) > 100) throw new Error('Annotation budget exceeded');
      for (const insight of input.insights ?? []) {
        check(insight.anchors, insight.text);
        if (!insight.anchors.length || !insight.title?.trim() || !['explanation', 'risk'].includes(insight.kind)) throw new Error('Explanation/risk must cite source and have a title');
        report.insights.push({ ...insight, authority: 'model-inference' });
      }
      for (const assessment of input.requirements ?? []) {
        check(assessment.anchors, assessment.explanation);
        const requirement = report.requirements.find(item => item.id === assessment.id);
        if (!requirement || !['supported', 'conflict', 'insufficient'].includes(assessment.status) || assessment.status !== 'insufficient' && !assessment.anchors.length) throw new Error('Requirement assessment needs an existing id and source evidence');
        Object.assign(requirement, assessment);
      }
      for (const kind of ['chapters', 'layers'] as const) if (input[kind]) {
        if (input[kind]!.length > 30) throw new Error('Reading grouping budget exceeded');
        const identities = new Set<string>();
        report[kind] = input[kind]!.map(group => {
          safeId(group.id); check(group.nodes, group.summary, 400);
          if (!group.nodes.length || !group.title?.trim() || group.title.length > 200 || identities.has(group.id)) throw new Error('Invalid or duplicate reading group');
          identities.add(group.id); return { ...group, authority: 'model-inference' as const };
        });
        const covered = new Set(report[kind]!.flatMap(group => group.nodes)), omitted = [...nodes].filter(node => !covered.has(node));
        if (omitted.length) report.gaps.push(`${kind}: ${omitted.length} published source nodes are not included in the chosen grouping; they remain available in the full map.`);
      }
      if(modelCoverage){
        if(Object.entries(modelCoverage).some(([key,value])=>key!=='status'&&(!Number.isSafeInteger(value)||Number(value)<0))||modelCoverage.nodes>modelCoverage.totalNodes||modelCoverage.changes>modelCoverage.totalChanges||modelCoverage.edges>modelCoverage.totalEdges||modelCoverage.completedRequests>modelCoverage.requests||modelCoverage.requests>modelCoverage.plannedRequests||modelCoverage.status!=='complete'||modelCoverage.completedRequests!==modelCoverage.plannedRequests)throw new Error('Invalid model material coverage');
        report.modelCoverage={...modelCoverage};
      }
      report.revision++; await this.publish(report); return report;
    });
  }
  async coverage(reportId: string, evidenceId?: string, task?: string) {
    const opened = await this.open(reportId, task);
    let evidence:Awaited<ReturnType<Workspace['evidenceStatus']>>|undefined,evidenceIssue:string|undefined;
    if(evidenceId)try{evidence=await this.workspace.evidenceStatus(evidenceId);}catch{evidenceIssue='所选检查证据不可读取，请重新运行或选择当前有效的检查。';}
    const results = evidence?.entry.data as { status?: string; results?: { check: string; status: string }[] } | undefined;
    return { map:opened.report.id,goal:opened.report.goal,current: opened.current,evidenceIssue, requirements: opened.report.requirements.map(requirement => ({ ...requirement,
      checksPassed: !!evidence?.valid && evidence.entry.kind === 'check' && results?.status === 'verified' && requirement.checks.length > 0
        && requirement.checks.every(check => results?.results?.some(result => result.check === check && result.status === 'passed')) })),
      note: 'Source assessments are advisory. Passing linked checks proves those executions, not completeness of all requirements.' };
  }
}
