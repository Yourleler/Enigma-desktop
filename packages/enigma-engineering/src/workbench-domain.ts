import { join } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import type { WorkbenchSession } from './workbench-session.js';
import type { AgentSession, ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { Workspace } from './workspace.js';
import { contextCheckpoints, contextRewindHistory } from './context-rewind.js';
import { ChangeReadings } from './change-reading.js';
import { DocumentationStore, type DocumentationInput } from './documentation.js';
import {workbenchOperationHistory} from './operation-history.js';

/** Domain calls can attach to a native host without creating another agent runtime. */
export interface DomainController {
    options: { workspace: Workspace; models: ModelRuntime; agentDir: string };
    chat: { session: string; provider: string; model: string };
    runtime: { session: AgentSession };
    snapshot(): Pick<ReturnType<WorkbenchSession['snapshot']>, 'memory' | 'tree' | 'messages'>;
    runCommand(name: string, args: string): Promise<unknown>;
    confirmOperation?(title: string, message: string, signal: AbortSignal): Promise<boolean>;
}
import { PlanStore, type PlanInput, type PlanStep } from './planning.js';
import { repoGraph } from './reading.js';
import { ReadingStore } from './reading-store.js';
import { SourceIndex,sourceSelectionView } from './source-index.js';
import { readSchemas } from './schema-reading.js';
import { ProjectContext } from './project-context.js';
import { fetchResource, refreshResource, readResourceCapture } from './resource-fetch.js';
import { TaskReadingStore, type TaskReadingInput } from './task-reading.js';
import { ServiceManager, type ServiceInput } from './services.js';
import { BrowserValidation, type BrowserScenario } from './browser-validation.js';
import { BackgroundRuns, type BackgroundInput } from './background.js';
import { TaskEvents, type WaitInput } from './task-events.js';
import { Artifacts, type ArtifactInput } from './artifacts.js';
import { SkillDiscovery, loadNativeSkills, configureSkillPaths, skillPaths } from './skill-discovery.js';
import { RecipeStore, type RecipeInput } from './recipes.js';
import { Delegations } from './delegation.js';
import { Experiments, type ExperimentInput } from './experiments.js';
import { MemoryStore, type MemoryInput } from './memory.js';
import { ProjectKnowledge, type KnowledgeInput } from './project-knowledge.js';
import { TaskPackages } from './task-package.js';
import { exportHandoff,renderHandoff, type HandoffMode } from './handoff.js';
import { exportDifferentialHandoff, inspectPortableHandoff } from './differential-handoff.js';
import { selectedPiNotes } from './pi-session.js';
import { runPiReview } from './pi-review.js';
import {listReviews} from './review.js';
import { askObserver } from './observer-questions.js';
import { previewRestore } from './solutions.js';
import { readJson, safeId } from './storage.js';
export interface Field {
    name: string;
    label: string;
    kind?: string;
    required?: boolean;
    options?: string[];
    source?: string;
    help?: string;
    value?: unknown;
    fields?: Field[];
    when?: {field: string; values: string[]};
}
export interface UIAction {
    id: string;
    group: string;
    title: string;
    description: string;
    effect?: 'read' | 'write' | 'execute';
    fields: Field[];
}
const field = (name: string, label: string, kind = 'text', extra: Partial<Field> = {}): Field => ({ name, label, kind, ...extra });
const identifier = field('id', '记录 ID', 'identifier', { required: true, help: '用于步骤之间引用，例如 api-check。以字母或数字开头，只用英文字母、数字、点、短横线或下划线；名称与目标可用中文。' });
const repo = field('repo', '仓库', 'select', { source: 'repos', required: true });
const title = field('title', '名称', 'text', { required: true });
const goal = field('goal', '任务目标', 'textarea', { required: true });
const checks = field('checks', '原检查', 'multi', { source: 'checks' });
const resources = field('resources', '项目资料', 'multi', { source: 'materials' });
const entries = field('entries', '携带的原始消息', 'multi', { source: 'entries', help: '选择背景与用户要求；隐藏思维和工具历史不导出。' });
const checkpoint = field('checkpoint', '检查点', 'select', { source: 'checkpoints', required: true });
const argv = field('argv', '命令与参数', 'lines', { required: true, help: '每行一个参数。例如第一行 npm，第二行 test。按原样传递，不拼接 shell。' });
const timeout = field('timeoutMs', '时间上限（毫秒）', 'number');
const noteKinds = ['convention', 'contract', 'decision', 'troubleshooting', 'preference', 'research'];
const sourceRows = field('sources', '源码依据', 'rows', { fields: [repo, field('file', '文件相对路径', 'text', { required: true })] });
const serviceStep = field('steps', '浏览器步骤', 'rows', { required: true, fields: [field('action', '动作', 'select', { options: ['click', 'fill', 'expect', 'screenshot', 'goto', 'wait', 'check', 'uncheck', 'select', 'press'], required: true }), field('selector', 'CSS 选择器'), field('value', '输入值'), field('includes', '预期文本'), field('label', '截图名'), field('path', '导航路径'), field('key', '按键')] });
export const uiActions: UIAction[] = [
    { id: 'document-example', group: 'documents', title: '验证文档示例', description: '选择已登记的示例，核对命令后运行。可以查看进度或停止，结果会保留为当前源码版本的证据。', effect: 'execute', fields: [field('selection','文档与示例','select',{source:'documentExamples',required:true})] },
    { id: 'document-register', group: 'documents', title: '登记已有文档', description: '关联 Markdown 文档，可补充需跟踪的说明、源码依据与示例。登记本身不代表文档已验证。', effect: 'write', fields: [repo, field('file','Markdown 文件相对路径','text',{required:true}), title,
        field('claims','需要核对的说明','rows',{fields:[identifier,field('section','所在标题（含 #）','text',{required:true}),field('text','文档中的原文','textarea',{required:true}),field('authority','依据类型','select',{options:['source','user-decision','inference','unverified'],value:'unverified',required:true}),field('sources','源码依据','rows',{fields:[repo,field('file','源码相对路径','text',{required:true}),field('start','起始行','number',{required:true}),field('end','结束行','number',{required:true})]})]}),
        field('examples','可执行示例','rows',{fields:[identifier,field('section','所在标题（含 #）','text',{required:true}),repo,argv,field('expected','输出应包含的内容','textarea',{required:true}),timeout]})] },
    { id: 'repo-add', group: 'project', title: '加入仓库', description: '注册现有 Git 仓库，保留独立位置。', effect: 'write', fields: [identifier, field('path', '本地绝对路径', 'text', { required: true }), field('role', '仓库职责'), field('readOnly', '只读', 'boolean')] },
    { id: 'repo-dependencies', group: 'project', title: '调整仓库依赖', description: '声明上游依赖，查看联合影响。', effect: 'write', fields: [repo, field('dependsOn', '上游仓库', 'multi', { source: 'repos' })] },
    { id: 'check-add', group: 'project', title: '添加验收检查', description: '用户定义原检查，模型不能自行放宽。', effect: 'write', fields: [identifier, repo, argv, field('joint', '联合检查', 'boolean'), timeout] },
    { id: 'verify', group: 'project', title: '运行全部检查', description: '执行当前注册的各仓库与联合标准。', effect: 'execute', fields: [] },
    { id: 'plan-create', group: 'plan', title: '建立任务目标', description: '目标、步骤、依赖和原检查形成版本计划。', effect: 'write', fields: [goal, field('steps', '任务步骤', 'rows', { required: true, fields: [identifier, repo, goal, field('requires', '前置步骤 ID', 'lines'), checks] })] },
    { id: 'plan-step', group: 'plan', title: '更新步骤进度', description: '完成需要当前有效证据；原计划修订保留。', effect: 'write', fields: [field('plan', '计划 ID', 'text', { required: true }), field('revision', '当前修订', 'number', { required: true }), field('step', '步骤 ID', 'text', { required: true }), field('phase', '阶段', 'select', { options: ['pending', 'running', 'failed', 'verified'], required: true }), field('evidence', '已通过的验收', 'select', { source: 'checkEvidence', required: true, when: { field: 'phase', values: ['verified'] }, help: '从最近 50 份记录中选择当前仍有效的验收。没有可选项时，先运行项目检查；确认时还会核对是否覆盖本步骤。' })] },
    { id: 'code-read', group: 'reading', title: '追踪代码', description: '按问题追踪静态定义、调用和跨仓库关系。', fields: [field('query', '符号或问题关键词', 'text', { required: true }), field('repo', '限定仓库', 'select', { source: 'repos' }), field('maxFiles', '文件预算', 'number', { value: 120 })] },
    { id: 'source-index', group: 'reading', title: '查询源码索引', description: '在预算内选择源码候选，失效索引可重建。', fields: [field('query', '关键词', 'text', { required: true }), field('language', '语言', 'select', { options: ['Go', 'Python', 'TypeScript'] }), field('maxFiles', '文件预算', 'number', { value: 120 })] },
    { id: 'schema-read', group: 'reading', title: '阅读 Schema / IDL', description: '读取字段、类型和有来源的契约关系。', fields: [field('query', '类型或字段关键词')] },
    { id: 'map-build', group: 'reading', title: '建立任务代码地图', description: '按任务和 diff 关联入口、消费者、职责及原检查。', effect: 'write', fields: [goal, field('symbol', '起始符号'), field('repo', '起始仓库', 'select', { source: 'repos' }), field('baseline', '差异基线', 'select', { source: 'checkpoints' }), resources, field('requirements', '需求与测试点', 'rows', { fields: [identifier, field('text', '要求', 'textarea', { required: true }), checks] })] },
    { id: 'map-coverage', group: 'reading', title: '检查需求覆盖', description: '静态依据与实际检查分别核对，旧证据不算通过。', fields: [identifier, field('evidence', '当前有效的检查（可选）','select',{source:'checkEvidence'})] },
    { id: 'changes-build', group: 'reading', title: '生成变更智能阅读', description: '全量 diff 与智能阅读引用同一份固定源码版本。', effect: 'write', fields: [goal, field('kind', '变更来源', 'select', { options: ['working','staged','commit','merge-request'], value: 'working' }), field('base', '指定基线版本（可选）', 'pairs', {help:'每行 仓库ID=Git版本，例如 api=main。通常可以留空。',when:{field:'kind',values:['working','commit','merge-request']}}), field('target', '指定目标版本（可选）', 'pairs', {help:'每行 仓库ID=Git版本。MR 链接可自动解析已在本地的精确提交。',when:{field:'kind',values:['commit','merge-request']}}), field('url', 'MR / PR 链接','text',{required:true,when:{field:'kind',values:['merge-request']}}), field('repo','MR 所属仓库（可选）','select',{source:'repos',when:{field:'kind',values:['merge-request']}}), field('fetch','允许获取缺少的远端提交','boolean',{help:'获取前仍会确认，不切换分支或修改工作区。',when:{field:'kind',values:['merge-request']}})] },
    { id: 'material-file', group: 'materials', title: '关联文件资料', description: '文件属于注册仓库，保存来源和修订。', effect: 'write', fields: [title, repo, field('file', '相对路径', 'text', { required: true }), field('private', '仅此任务', 'boolean')] },
    { id: 'material-note', group: 'materials', title: '添加项目笔记', description: '用户背景资料，保持参考来源角色。', effect: 'write', fields: [title, field('content', '正文', 'textarea', { required: true }), field('private', '仅此任务', 'boolean')] },
    { id: 'material-fetch', group: 'materials', title: '获取网页 / 飞书', description: '读取实际来源；局部范围、认证失败和远端新鲜度明确保留。', effect: 'write', fields: [field('url', '来源链接', 'text', { required: true }), title, field('scope', '读取范围', 'select', { options: ['outline', 'full', 'keyword', 'section', 'range'], value: 'outline' }), field('keyword', '关键词'), field('private', '仅此任务', 'boolean')] },
    { id: 'material-refresh', group: 'materials', title: '刷新资料', description: '生成新修订；关联地图与知识按版本失效。', effect: 'write', fields: [identifier] },
    { id: 'material-remove', group: 'materials', title: '移除资料', description: '从未来上下文移除，旧修订不复活。', effect: 'write', fields: [identifier] },
    { id: 'material-raw', group: 'materials', title: '查看原始来源', description: '核对获取范围、版本和原始响应，不将局部内容误当全文。', fields: [identifier] },
    { id: 'skills-paths', group: 'skills', title: '添加技能发现路径', description: '复用 Pi 原生技能，不扩大仓库写权限。', effect: 'write', fields: [field('paths', '技能文件或目录绝对路径', 'lines', { required: true })] },
    { id: 'skills-read', group: 'skills', title: '阅读技能', description: '以当前 ID 和内容版本核对正文。', fields: [identifier, field('version', '当前版本', 'text', { required: true })] },
    { id: 'recipe-save', group: 'skills', title: '创建 / 编辑配方', description: '用户推广的流程，参数、服务、浏览器和原检查可复用。', effect: 'write', fields: [identifier, field('label', '名称', 'text', { required: true }), timeout, field('parameters', '输入参数', 'rows', { fields: [field('name', '参数名', 'text', { required: true }), field('description', '描述'), field('default', '默认值')] }), field('steps', '流程步骤', 'rows', { required: true, fields: [identifier, field('kind', '步骤类型', 'select', { options: ['command', 'service', 'browser', 'verify'], required: true }), field('repo', '仓库', 'select', { source: 'repos' }), field('argv', '命令与参数', 'lines'), field('service', '服务', 'select', { source: 'services' }), field('action', '服务动作', 'select', { options: ['start', 'stop'] }), field('scenario', '浏览器场景', 'select', { source: 'scenarios' })] })] },
    { id: 'recipe-run', group: 'skills', title: '运行配方', description: '执行推广后的流程和原标准，保存真实运行回执。', effect: 'execute', fields: [identifier, field('parameters', '本次参数', 'pairs')] },
    { id: 'recipe-propose', group: 'skills', title: '从成功任务提取配方', description: '生成待确认草稿，不自动推广或执行。', effect: 'write', fields: [] },
    { id: 'delegate-start', group: 'collaboration', title: '创建隔离子任务', description: 'Pi / Codex 在独立工作区准备结果，父代码通过预览合并。', effect: 'execute', fields: [goal, field('target', '目标 Agent', 'select', { options: ['pi', 'codex'], value: 'pi', required: true }), field('writeRepos', '可写仓库', 'multi', { source: 'repos' }), checks, entries, resources, field('maxRequests', 'Pi 调用上限', 'number', { value: 24 }), field('timeoutMs', '运行时间上限（毫秒）', 'number', { value: 240000 })] },
    { id: 'delegate-cancel', group: 'collaboration', title: '取消子任务', description: '核对拥有关系与终态，不重放未知效果。', effect: 'execute', fields: [identifier] },
    { id: 'delegate-preview', group: 'collaboration', title: '预览合并', description: '与当前父代码进行三方差异比较，保留并发修改。', effect: 'write', fields: [identifier] },
    { id: 'delegate-merge', group: 'collaboration', title: '应用已预览结果', description: '核对预览版本，再运行所有父原检查。', effect: 'execute', fields: [identifier] },
    { id: 'experiment-create', group: 'collaboration', title: '比较多个方案', description: '既有子任务必须同起点、同原检查，实际比较后选择。', effect: 'write', fields: [goal, checks, field('candidates', '候选方案', 'rows', { required: true, fields: [identifier, field('delegation', '子任务 ID', 'text', { required: true })] })] },
    { id: 'experiment-evaluate', group: 'collaboration', title: '执行共同验收', description: '实际子工作区运行相同原标准。', effect: 'execute', fields: [identifier] },
    { id: 'experiment-select', group: 'collaboration', title: '选择当前通过方案', description: '生成合并预览，选择本身不应用代码。', effect: 'write', fields: [identifier, field('candidate', '候选 ID', 'text', { required: true })] },
    { id: 'checkpoint', group: 'timeline', title: '保存当前代码快照', description: '关联代码、当前会话节点与计划。', effect: 'write', fields: [field('label', '标签', 'text', { required: true })] },
    { id: 'restore-preview', group: 'timeline', title: '预览代码恢复', description: '核对当前代码，外部修改阻止覆盖。', fields: [field('target', '恢复目标', 'select', { source: 'checkpoints', required: true }), field('expected', '当前基线', 'select', { source: 'checkpoints', required: true })] },
    { id: 'restore', group: 'timeline', title: '确认恢复代码', description: '显式恢复；最新要求、累计消耗和原用户文件保留。', effect: 'execute', fields: [field('target', '恢复目标', 'select', { source: 'checkpoints', required: true }), field('expected', '当前基线', 'select', { source: 'checkpoints', required: true }), field('context', '同时恢复关联上下文', 'boolean')] },
    { id: 'code-fork', group: 'timeline', title: '另开代码方案', description: '在新目录恢复方案，保留原仓库状态。', effect: 'execute', fields: [checkpoint, field('destination', '新目录绝对路径', 'text', { required: true })] },
    { id: 'memory-search', group: 'memory', title: '检索记忆', description: '当前作用域、来源和忘记状态重新核对。', fields: [field('query', '中文或符号关键词'), field('includeStale', '包含过期条目', 'boolean')] },
    { id: 'memory-read', group: 'memory', title: '阅读完整记忆', description: '实际正文与来源版本重新核对，过期和忘记明确报告。', fields: [identifier] },
    { id: 'memory-reindex', group: 'memory', title: '重建记忆索引', description: '从当前正文重建可丢弃的派生索引。', effect: 'write', fields: [] },
    { id: 'memory-recover', group: 'memory', title: '恢复记忆整理状态', description: '核对已退出的写入者，未结算草稿保持未知。', effect: 'write', fields: [] },
    { id: 'reading-open', group: 'reading', title: '展开已发布阅读', description: '读取对应源码版本和真实位置，失效证据保持可见。', fields: [field('query', '原查询', 'text', { required: true }), field('repo', '限定仓库', 'select', { source: 'repos' }), field('node', '阅读节点 ID')] },
    { id: 'map-annotate', group: 'reading', title: '补充讲解与风险', description: '引用当前地图节点，保持模型推断标识，不替代实际验收。', effect: 'write', fields: [identifier, field('revision', '当前修订', 'number', { required: true }), field('insights', '有依据的结论', 'rows', { fields: [title, field('text', '说明', 'textarea', { required: true }), field('kind', '类型', 'select', { options: ['explanation', 'risk'], value: 'explanation' }), field('anchors', '来源节点 ID', 'lines', { required: true })] })] },
    { id: 'memory-save', group: 'memory', title: '保存 / 更正记忆', description: '明确用户来源和范围，可用新条目替代旧条目。', effect: 'write', fields: [title, field('content', '正文', 'textarea', { required: true }), field('kind', '类型', 'select', { options: noteKinds, value: 'decision' }), field('scope', '范围', 'select', { options: ['project', 'task', 'repositories'], value: 'project' }), field('repos', '相关仓库', 'multi', { source: 'repos' }), sourceRows, field('replaces', '替代的旧记忆 ID'), field('appliesWhen', '适用条件')] },
    { id: 'memory-forget', group: 'memory', title: '忘记记忆', description: '停止召回，旧方案恢复也不复活。', effect: 'write', fields: [identifier] },
    { id: 'memory-organize', group: 'memory', title: '整理经验草稿', description: '重新核对来源，把所选草稿保存为候选记忆，不调用模型。', effect: 'write', fields: [field('drafts','要整理的草稿（可选）','multi',{source:'memoryDrafts',help:'单次最多10份；留空时整理当前可见的最多3份草稿。已保存、过期或中断的草稿不会自动重放。'})] },
    { id: 'knowledge-draft', group: 'memory', title: '记录有依据的经验', description: '引用当前资料、源码或父验收证据，先保存为草稿。', effect: 'write', fields: [title, field('content', '经验正文', 'textarea', { required: true }), field('kind', '类型', 'select', { options: noteKinds.filter(k => k !== 'preference'), value: 'contract' }), resources, sourceRows, field('evidence', '父证据 ID', 'lines')] },
    { id: 'observer-question', group: 'observer', title: '询问运行状态', description: '旁路只根据可见事实回答，不阻塞主 Agent。', fields: [field('question', '你想知道什么', 'textarea', { required: true, value: '现在是在等待，还是有有效进展？' })] },
    { id: 'review-run', group: 'review', title: '按需独立审查', description: '新上下文只读冻结差异，意见不代替原验收。', effect: 'execute', fields: [field('baseline', '差异基线', 'select', { source: 'checkpoints', required: true }), goal, entries] },
    { id: 'service-add', group: 'environment', title: '配置服务', description: '定义独立服务、依赖和明确的就绪条件。', effect: 'write', fields: [identifier, field('label', '名称', 'text', { required: true }), repo, argv, field('dependsOn', '上游服务', 'multi', { source: 'services' }), field('portPrefix', '动态端口日志前缀'), field('readiness', '就绪条件', 'object', { fields: [field('type', '类型', 'select', { options: ['http', 'log', 'tcp'], value: 'http' }), field('port', '固定端口', 'number'), field('path', 'HTTP 路径'), field('includes', '预期响应或日志'), timeout] })] },
    ...['start', 'stop', 'restart'].map(action => ({ id: `service-${action}`, group: 'environment', title: ({ start: '启动服务', stop: '停止服务', restart: '重启服务' })[action]!, description: '只操作当前登记的拥有进程，核对依赖与实际终态。', effect: 'execute' as const, fields: [identifier] })),
    { id: 'background-start', group: 'environment', title: '运行后台命令', description: '有界运行、日志和实际终态，不占主工作区锁。', effect: 'execute', fields: [field('label', '名称', 'text', { required: true }), repo, argv, field('maxRuntimeMs', '运行时间上限（毫秒）', 'number', { value: 600000 })] },
    { id: 'background-cancel', group: 'environment', title: '取消后台命令', description: '取消拥有命令并核对退出。', effect: 'execute', fields: [identifier] },
    { id: 'wait-start', group: 'environment', title: '等待结果并接续', description: '选择要观察的任务或服务。默认只记录结果；勾选接续后，结果到达时才会按任务规则继续对话。取消等待不会停止目标。', effect: 'write', fields: [field('label', '名称', 'text', { required: true }), field('condition', '等待条件', 'object', { fields: [field('kind', '来源', 'select', { options: ['background', 'delegation', 'service', 'github'], value: 'background' }), field('run', '后台 ID 或 GitHub run 编号'), field('task', '子任务 ID'), field('service', '服务 ID'), field('state', '服务状态', 'select', { options: ['ready', 'stopped'] }), field('repo', 'GitHub owner/repo')] }), field('resume', '结果到达后继续当前任务', 'boolean'), timeout] },
    { id: 'wait-cancel', group: 'environment', title: '取消等待', description: '只结束等待，不伪造目标结果。', effect: 'write', fields: [identifier] },
    { id: 'browser-add', group: 'environment', title: '配置浏览器验收', description: '真实页面步骤和预期结果，保留截图与轨迹。', effect: 'write', fields: [identifier, field('label', '名称', 'text', { required: true }), field('service', '已配置服务', 'select', { source: 'services', required: true }), serviceStep, timeout] },
    { id: 'browser-run', group: 'environment', title: '执行浏览器场景', description: '实际操作当前就绪服务并保存版本化结果。', effect: 'execute', fields: [identifier] },
    { id: 'browser-report', group: 'environment', title: '查看浏览器报告', description: '核对动作、截图、轨迹和当前来源有效性。', fields: [identifier] },
    { id: 'background-acknowledge', group: 'environment', title: '核对未知后台效果', description: '先确认进程停止和实际效果，记录说明，不重放命令。', effect: 'write', fields: [identifier, field('observation', '已核对的效果', 'textarea', { required: true })] },
    { id: 'recipe-report', group: 'skills', title: '查看配方运行报告', description: '实际步骤、验收、失败与取消的持久回执。', fields: [identifier] },
    { id: 'recipe-reconcile', group: 'skills', title: '核对中断配方', description: '确认原进程退出后释放配方占用；文件和未确认效果保留，原步骤不重放。', effect: 'write', fields: [field('owner','待核对的配方','select',{source:'recipeLocks',required:true}),field('observation', '实际效果说明', 'textarea', { required: true })] },
    { id: 'artifact-add', group: 'artifacts', title: '登记产物版本', description: '保存实际字节、来源和版本；源码改变仍可读历史。', effect: 'write', fields: [title, field('kind', '类型', 'select', { options: ['document', 'code', 'report', 'screenshot', 'trace', 'package'], value: 'document' }), field('repo', '文件所属仓库', 'select', { source: 'repos' }), field('file', '仓库内文件'), field('runtime', '或本工作区结果路径'), field('evidence', '证据 ID', 'lines')] },
    { id: 'handoff-export', group: 'handoff', title: '导出背景交接', description: '筛选原消息与新目标，保留来源角色，不迁移隐藏状态。', effect: 'write', fields: [goal, entries, field('mode', '模式', 'select', { options: ['background', 'continue', 'alternative'], value: 'background' }), field('destination', '新目录绝对路径', 'text', { required: true })] },
    { id: 'handoff-inspect', group: 'handoff', title: '核对交接包', description: '验证来源、当前代码和缺失项，不执行旧任务。', fields: [field('directory', '交接目录', 'text', { required: true })] },
    { id: 'new-context', group: 'handoff', title: '同背景开启新任务', description: '原对话保留，筛选背景，不自动继续旧目标。', effect: 'write', fields: [goal, entries] },
    { id: 'package-export', group: 'handoff', title: '导出可复现任务包', description: '含选定代码、材料、计划和原检查，目标端重新验收。', effect: 'write', fields: [goal, entries, resources, field('artifacts', '产物', 'multi', { source: 'artifacts' })] },
    { id: 'package-inspect', group: 'handoff', title: '检查任务包', description: '核对 manifest 和实际字节完整性。', fields: [field('directory', '任务包目录', 'text', { required: true })] },
    { id: 'package-restore', group: 'handoff', title: '在新目录复现', description: '先检查任务包，再指定包内仓库的写权限；新工作区需要重新验收。', effect: 'execute', fields: [field('directory', '源任务包目录', 'text', { required: true }),field('expectedManifest','已检查的任务包版本','record',{required:true}), field('destination', '目标新目录（绝对路径）', 'text', { required: true,help:'目标目录不能已存在；父目录需要存在。' }), field('writeRepos', '允许写入的包内仓库', 'multi',{help:'从检查结果选择；未选仓库默认只读。'}), field('activateRuntime', '加载服务和检查定义', 'boolean',{help:'只登记定义，不会启动服务或运行命令；之后在新工作区重新验收。'})] },
    { id: 'recover', group: 'timeline', title: '核对中断运行', description: '仅处理已停止的拥有进程，未知效果不自动重放。', effect: 'write', fields: [] },
    { id: 'acknowledge', group: 'timeline', title: '记录未知效果核对', description: '明确观察到的实际状态，保留原操作记录。', effect: 'write', fields: [identifier, field('observation', '已核对的实际效果', 'textarea', { required: true })] },
];
const recordSources: Record<string, string> = {
    'map-coverage':'taskMaps','map-annotate':'taskMaps',
    'material-refresh': 'materials', 'material-remove': 'materials', 'material-raw': 'materials',
    'recipe-run': 'recipes', 'recipe-report': 'recipeRuns',
    'delegate-cancel': 'delegations', 'delegate-preview': 'delegations', 'delegate-merge': 'mergePreviews',
    'experiment-evaluate': 'experiments', 'experiment-select': 'experiments',
    'service-start': 'services', 'service-stop': 'services', 'service-restart': 'services',
    'background-cancel': 'background', 'background-acknowledge': 'background', 'wait-cancel': 'waits',
    'browser-run': 'scenarios', 'browser-report': 'browserReports',
};
for (const action of uiActions) {
    if (recordSources[action.id])
        action.fields = action.fields.map(f => f.name === 'id' ? { ...f, kind: 'select', source: recordSources[action.id], label: '选择项目记录', help: '选择已有记录，无需填写编号。' } : f);
    if (action.id === 'recipe-save')
        action.fields = [...action.fields.map(f => f.name === 'steps' ? { ...f, value: [{ id: 'acceptance', kind: 'verify' }], help: '配方最后保留全部原检查。参数使用 {{参数名}} 占据单独一行，不能替换程序名或内联代码。' } : f.name==='id'?{...f,label:'配方编号',help:'例如 migration-check，以英文或数字开头；名称可以用中文。'}:f),field('revision','正在编辑的修订号（新建留空）','number',{help:'从配方卡片点击编辑会自动带入。版本已改变时会拒绝覆盖。'})];
    if(action.id==='recipe-run')action.fields.push(field('version','已核对的配方版本（自动带入）','text',{help:'从已加载的配方记录带入，执行前再次核对。'}));
    if(action.id==='map-annotate')action.fields.push(field('requirements','需求说明（可选）','rows',{fields:[identifier,field('status','源码支持情况','select',{required:true,options:['supported','conflict','insufficient'],value:'insufficient'}),field('anchors','来源节点 ID','lines'),field('explanation','判断依据','textarea',{required:true})]}));
    if(action.id==='map-build')action.fields.push(field('expectedRepos','本任务预期涉及的仓库（可选）','multi',{source:'repos',help:'用于标出预期范围之外的变更，不改变仓库权限。'}));
    if (action.id === 'service-add')
        action.fields.push(field('envFromServices', '连接上游服务', 'rows', { fields: [field('name', '目标环境变量名', 'text', { required: true }), field('service', '来源服务', 'select', { source: 'services', required: true }), field('value', '传入内容', 'select', { options: ['url', 'port'], value: 'url' })] }), field('envRefs', '凭证环境变量引用', 'pairs', { help: '目标变量=已有环境变量名。只保存名称，不填写密钥值。' }), field('maxRuntimeMs', '服务最长运行时间（毫秒）', 'number'),field('version','正在编辑的配置版本（自动带入）','text'));
    if (action.id === 'background-start')
        action.fields.push(field('envRefs', '环境变量引用', 'pairs', { help: '目标变量=已有环境变量名；不在界面填入密钥值。' }));
    if(action.id==='experiment-create')action.fields=action.fields.map(f=>f.name!=='candidates'?f:{...f,help:'至少两个方案，需来自相同代码起点并保留相同原检查。',fields:f.fields?.map(child=>child.name==='delegation'?{...child,kind:'select',source:'delegations',label:'独立子任务'}:child.name==='id'?{...child,label:'方案代号',help:'例如 compatibility 或 simple，用于区分方案。'}:child)});
    if (action.id === 'material-fetch')
        action.fields.push(field('startBlock', '起始文档区块'), field('endBlock', '结束文档区块'));
    if (action.id === 'handoff-export') action.fields.push(field('baseDirectory','已分享的交接目录（可选）','text',{help:'填写后只省略该交接中重复的背景，原用户要求会保留。首次交接请留空。'}));
    if (action.id === 'package-export' || action.id === 'handoff-export')
        action.fields.push(field('evidence', '携带的验收证据', 'multi',{source:'checkEvidence'}), field('memories', '携带的记忆', 'multi',{source:'memories',help:'按名称选择当前可见记忆；导出时重新核对来源，已忘记或过期的条目不会带走。'}));
    if (action.id === 'review-run')
        action.fields.push(field('evidence', '参考验收证据 ID', 'lines'));
    if (action.id === 'recipe-save') action.fields=action.fields.map(f=>f.name!=='steps'?f:{...f,fields:[...f.fields||[],field('timeoutMs','本步骤超时（毫秒）','number',{when:{field:'kind',values:['command']}}),field('envRefs','凭证环境变量引用','pairs',{when:{field:'kind',values:['command']},help:'每行 目标变量=已有环境变量名，不填写密钥。'})].map(child=>{
        const choices:Record<string,string[]>={repo:['command'],argv:['command'],service:['service'],action:['service'],scenario:['browser']};
        const values = choices[child.name];
        return values ? {...child,required:true,when:{field:'kind',values}} : child.name==='id'?{...child,label:'步骤编号',help:'在这份配方内保持唯一，例如 prepare 或 acceptance。'}:child;
    })});
    if (action.id === 'browser-add') action.fields=action.fields.map(f=>f.name!=='steps'?f:{...f,fields:f.fields?.map(child=>{
        const choices:Record<string,string[]>={selector:['click','fill','expect','wait','check','uncheck','select','press'],value:['fill','select'],includes:['expect'],label:['screenshot'],path:['goto'],key:['press']};
        const values = choices[child.name];
        return values ? {...child,required:child.name!=='value',when:{field:'action',values}} : child;
    })});
    if(action.id==='wait-start')action.fields=action.fields.map(f=>f.name!=='condition'?f:{...f,fields:f.fields?.map(child=>{
        const choices:Record<string,string[]>={run:['background'],task:['delegation'],service:['service'],state:['service'],repo:['github']};
        const values = choices[child.name];
        const sources:Record<string,string>={run:'background',task:'delegations',service:'services'};
        return values ? {...child,required:true,when:{field:'kind',values},...(sources[child.name]?{kind:'select',source:sources[child.name],label:{run:'选择后台运行',task:'选择子任务',service:'选择项目服务'}[child.name]}:{})} : child;
    }).concat(field('githubRun','GitHub运行编号','number',{required:true,when:{field:'kind',values:['github']}}))});
    if(action.id==='delegate-start')action.fields=action.fields.map(f=>f.name==='maxRequests'?{...f,when:{field:'target',values:['pi']}}:f);
    if(action.id==='material-fetch')action.fields=action.fields.map(f=>f.name==='keyword'?{...f,when:{field:'scope',values:['keyword']}}:f.name==='startBlock'?{...f,when:{field:'scope',values:['section','range']}}:f.name==='endBlock'?{...f,when:{field:'scope',values:['range']}}:f);
    if(action.id==='memory-save')action.fields=action.fields.map(f=>f.name==='repos'?{...f,when:{field:'scope',values:['repositories']}}:f.name==='replaces'?{...f,kind:'select',source:'memories',label:'替代的旧记忆（可选）'}:f);
    if(['memory-read','memory-forget'].includes(action.id))action.fields=action.fields.map(f=>f.name==='id'?{...f,kind:'select',source:'memories',label:'选择记忆',help:'按名称和适用范围选择已有记忆，无需填写编号。'}:f);
    if(action.id==='knowledge-draft')action.fields=action.fields.map(f=>f.name==='evidence'?{...f,kind:'multi',source:'checkEvidence',label:'当前工作区的验收证据'}:f);
}
function text(args: Record<string, unknown>, key: string) {
    const value = args[key];
    if (typeof value !== 'string' || !value.trim())
        throw new Error(`请填写 ${key}`);
    return value;
}
export async function planScope(controller: DomainController) {
    try {
        return (await readJson<{
            planFile?: string;
        }>(join(controller.options.workspace.data, `session-${safeId(controller.chat.session)}.json`))).planFile ?? 'active-plan.json';
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            throw error;
        return `active-plan-${safeId(controller.chat.session)}.json`;
    }
}
const notes = (controller: DomainController, selected: unknown) => {
    if (!Array.isArray(selected) || !selected.length)
        return [];
    return selectedPiNotes(controller.runtime.session.sessionManager, selected.map(id => ({ id: String(id) })));
};
export async function domainAction(controller: DomainController, action: string, a: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    const w = controller.options.workspace, task = controller.chat.session, entry = controller.runtime.session.sessionManager.getLeafId() ?? undefined, access = { session: task, entries: controller.runtime.session.sessionManager.getBranch().map(e => e.id) }, scope = await planScope(controller);
    const plan = new PlanStore(w, scope), material = new ProjectContext(w), delegates = new Delegations(w), recipes = new RecipeStore(w), events = new TaskEvents(w);
    const definition = uiActions.find(d => d.id === action);
    if (!definition)
        throw new Error('未知工作台操作。');
    signal.throwIfAborted();
    if (definition.effect) {
        try {
            const state = await readJson<{
                reviewEntries?: string[];
            }>(join(w.data, `session-${safeId(task)}.json`));
            // Export carries every preserved requirement below and does not run
            // source commands. An interrupted task must remain transferable.
            if (state.reviewEntries?.length && !['recover', 'acknowledge', 'memory-forget','package-export','handoff-export'].includes(action))
                throw new Error('恢复后仍有原用户要求未回读。请先让 Agent 使用 task_requirements 核对后继续。');
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
                throw error;
        }
    }
    const accounting = await readJson<{
        requests?: number;
        inheritedRequests?: number;
    }>(join(w.data, `session-${safeId(task)}.json`)).catch(() => ({ requests: 0, inheritedRequests: 0 }));
    const source = { agent: 'pi', session: task, entry, requests: (accounting.requests ?? 0) + (accounting.inheritedRequests ?? 0) };
    const packageInput = async () => {
        const selected = notes(controller, a.entries);
        const state = await readJson<{
            requests?: number;
            inheritedRequests?: number;
            requirements?: string[];
            requirementEntries?: string[];
        }>(join(w.data, `session-${safeId(task)}.json`)).catch(() => ({ requests: 0, inheritedRequests: 0, requirements: [], requirementEntries: [] }));
        for (const note of notes(controller, state.requirementEntries ?? [])) {
            const existing=selected.find(item=>item.reference===note.reference);
            if(existing)existing.kind='requirement';else selected.push({ ...note, kind: 'requirement' });
        }
        for (const [index, value] of (state.requirements ?? []).entries())
            selected.push({ role: 'user', kind: 'requirement', reference: `pi:${task}:preserved-${index}`, text: value });
        return { goal: text(a, 'goal'), task, source: { ...source, requests: (state.requests ?? 0) + (state.inheritedRequests ?? 0) }, notes: selected, resources: a.resources as string[] | undefined, artifacts: a.artifacts as string[] | undefined, evidence: a.evidence as string[] | undefined, memories: a.memories as string[] | undefined, memoryAccess: access, plan: await plan.current() ?? null };
    };
    switch (action) {
        case 'repo-add': return {...await w.exclusive(() => w.addRepo(text(a, 'id'), text(a, 'path'), { role: String(a.role ?? ''), access: a.readOnly ? 'read' : 'write' })),repositoryAdded:true};
        case 'repo-dependencies': return w.exclusive(async()=>{await w.setDependencies(text(a, 'repo'), (a.dependsOn ?? []) as string[]);return {dependenciesUpdated:true,repo:text(a,'repo'),dependsOn:w.repo(text(a,'repo')).dependsOn};});
        case 'check-add': return w.exclusive(async()=>{const check={ id: text(a, 'id'), repo: text(a, 'repo'), argv: a.argv as string[], joint: a.joint === true, timeoutMs: a.timeoutMs as number | undefined };await w.addCheck(check);return {...check,checkAdded:true};});
        case 'verify': return w.exclusive(() => w.verify(signal));
        case 'plan-create': return plan.create(a as unknown as PlanInput);
        case 'plan-step': return plan.advance(text(a, 'step'), Number(a.revision), { phase: a.phase as PlanStep['phase'], evidence: a.evidence as string | undefined }, text(a, 'plan'));
        case 'code-read': return w.exclusive(() => new ReadingStore(w).update(text(a, 'query'), { repo: a.repo as string | undefined, maxFiles: a.maxFiles as number | undefined, signal }));
        case 'source-index': return {...sourceSelectionView(await new SourceIndex(w).select(text(a, 'query'), { language: a.language as 'Go' | 'Python' | 'TypeScript' | undefined, maxFiles: a.maxFiles as number | undefined, signal })),sourceIndex:true,query:text(a,'query')};
        case 'schema-read': return {...await readSchemas(w, { query: String(a.query ?? ''), signal }),schemaReading:true,query:String(a.query??'')};
        case 'map-build': return new TaskReadingStore(w).build({ ...a, goal: text(a, 'goal'), task, baseline: a.baseline as string | undefined, resources: a.resources as string[] | undefined, requirements: a.requirements as TaskReadingInput['requirements'], queries: a.symbol ? [{ symbol: String(a.symbol), repo: a.repo as string | undefined }] : a.queries as TaskReadingInput['queries'] }, signal);
        case 'map-coverage': return new TaskReadingStore(w).coverage(text(a, 'id'), a.evidence as string | undefined, task);
        case 'changes-build': {
            await controller.runCommand('change-reading', JSON.stringify({ ...a, base: a.base && Object.keys(a.base).length ? typeof a.base==='string'?JSON.parse(a.base):a.base : undefined, target: a.target && Object.keys(a.target).length ? typeof a.target==='string'?JSON.parse(a.target):a.target : undefined }));
            return new ChangeReadings(w).latest(task);
        }
        case 'material-file': return material.add({ title: text(a, 'title'), task: a.private ? task : undefined, source: { kind: 'file', repo: text(a, 'repo'), file: text(a, 'file') } });
        case 'material-note': return material.add({ title: text(a, 'title'), task: a.private ? task : undefined, source: { kind: 'note', author: 'user' }, content: text(a, 'content') });
        case 'material-fetch': return material.add({ ...await fetchResource(w, text(a, 'url'), { title: a.title as string | undefined, scope: a.scope as 'full' | 'outline' | 'keyword' | 'section' | 'range' | undefined, keyword: a.keyword as string | undefined, startBlock: a.startBlock as string | undefined, endBlock: a.endBlock as string | undefined, signal }), task: a.private ? task : undefined });
        case 'material-refresh': {
            const r = await material.read(text(a, 'id'), { task });
            return r.resource.source.kind === 'imported' ? refreshResource(w, text(a, 'id'), { task, signal }) : material.refresh(text(a, 'id'), { task });
        }
        case 'material-remove': { const resource=text(a,'id');await material.remove(resource,{task});return {removedResource:resource}; }
        case 'material-raw': {
            const r = await material.read(text(a, 'id'), { task });
            if (r.resource.source.kind !== 'imported' || !r.resource.source.capture)
                throw Error('此资料没有远端获取缓存。');
            return {sourceCapture:true,resource:r.resource,capture:await readResourceCapture(w, r.resource.source.capture.raw)};
        }
        case 'skills-paths': {
            const paths=a.paths;if(!Array.isArray(paths)||paths.some(p=>typeof p!=='string'))throw Error('请逐行填写技能目录。');
            const result = await configureSkillPaths(w, [...new Set([...await skillPaths(w),...paths])]);
            await controller.runtime.session.reload();
            return {...result,skillPathsConfigured:true};
        }
        case 'skills-read': {
            return new SkillDiscovery(() => loadNativeSkills(w, { agentDir: controller.options.agentDir })).open(text(a,'id'),text(a,'version'),{manualRead:true});
        }
        case 'recipe-save': {
            const rows=(a.parameters??[]) as {name:string;description?:string;default?:string}[];
            if(!Array.isArray(rows)||rows.some(p=>!p||typeof p.name!=='string')||new Set(rows.map(p=>p.name)).size!==rows.length)throw new Error('配方参数名必须唯一，请检查重复项。');
            const parameters = Object.fromEntries((rows as {
                name: string;
                description?: string;
                default?: string;
            }[]).map(p => [p.name, { description: p.description ?? '', ...(p.default!==undefined ? { default: p.default } : {}) }]));
            try{return await recipes.save({ ...a, parameters } as unknown as RecipeInput, a.revision as number | undefined);}
            catch(error){if((error as Error).message.includes('Recipe changed;'))throw new Error('配方已被更新，请关闭表单并重新点击编辑，核对最新修订后再保存。');throw error;}
        }
        case 'recipe-run': {
            const r = await recipes.read(text(a, 'id'));
            if(a.version!==undefined&&a.version!==r.version)throw new Error('配方在打开表单后已变化，请重新核对当前步骤与参数。');
            return recipes.run(r.id, (a.parameters ?? {}) as Record<string, string>, { task, entry, signal, expectedVersion: r.version });
        }
        case 'recipe-propose': {
            const p = await plan.current();
            if (!p)
                throw Error('当前任务没有计划。');
            try{return await recipes.propose(p, task);}catch(error){if((error as Error).message.includes('fully verified'))throw new Error('请先完成当前计划的全部步骤，并关联当前有效的原检查证据，再提取配方。');throw error;}
        }
        case 'recipe-report': return {...await recipes.readRun(text(a, 'id'), task),recipeReport:true};
        case 'recipe-reconcile': return recipes.reconcileLock(text(a, 'observation'),text(a,'owner'));
        case 'delegate-start': return delegates.start({ ...await packageInput(), target: a.target as 'pi' | 'codex', writeRepos: a.writeRepos as string[] | undefined, checks: a.checks as string[] | undefined, maxRequests: a.target === 'pi' ? a.maxRequests as number | undefined : undefined, timeoutMs: a.timeoutMs as number | undefined, agentDir: controller.options.agentDir, provider: controller.chat.provider, model: controller.chat.model });
        case 'delegate-cancel': return delegates.cancel(text(a, 'id'), task);
        case 'delegate-preview': return delegates.preview(text(a, 'id'), task, { planFile: scope });
        case 'delegate-merge': return delegates.merge(text(a, 'id'), { task, signal, planFile: scope });
        case 'experiment-create': return new Experiments(w).create({ ...a, task } as unknown as ExperimentInput);
        case 'experiment-evaluate': return new Experiments(w).evaluate(text(a, 'id'), { task, signal });
        case 'experiment-select': return new Experiments(w).select(text(a, 'id'), text(a, 'candidate'), { task, planFile: scope });
        case 'document-register': return new DocumentationStore(w).register({...a,claims:a.claims||[],examples:a.examples||[]} as unknown as DocumentationInput);
        case 'document-example': {
            const parts=text(a,'selection').split('/');
            if(parts.length!==2||!parts.every(Boolean))throw new Error('请选择已登记的文档示例');
            const [id,exampleId]=parts as [string,string],store=new DocumentationStore(w),document=await store.read(id),example=document.record.examples?.find(item=>item.id===exampleId);
            if(!example)throw new Error('所选示例已不存在，请刷新文档记录');
            if(!await controller.confirmOperation?.('验证文档示例',JSON.stringify({文档:document.record.title,章节:example.section,仓库:example.repo,命令:example.argv,预期输出:example.expected}),signal))throw new Error('文档示例运行已取消');
            signal.throwIfAborted();
            return store.runExample(id,exampleId,signal);
        }
        case 'checkpoint': return w.exclusive(() => w.checkpoint(text(a, 'label'), { session: task, entry }));
        case 'restore-preview': return w.exclusive(() => previewRestore(w, text(a, 'target'), text(a, 'expected')));
        case 'restore': {const target=await w.loadCheckpoint(text(a,'target'));const result=await controller.runCommand('enigma-restore', JSON.stringify(a));return {commandResult:result,codeRestored:true,targetLabel:target.label,contextSwitched:a.context===true};}
        case 'code-fork': {const target=await w.loadCheckpoint(text(a,'checkpoint'));const result=await controller.runCommand('branch-code', JSON.stringify(a));return {commandResult:result,...(result&&typeof result==='object'&&'createdSession' in result?{createdSession:result.createdSession}:{}),codeForked:true,targetLabel:target.label,destination:text(a,'destination')};}
        case 'memory-search':
            if (!String(a.query ?? '').trim())
                return { items: [], note: '输入关键词以按需召回。' };
            return (await MemoryStore.open(w)).search(String(a.query), access, { includeStale: a.includeStale === true });
        case 'memory-save': return (await MemoryStore.open(w)).save({ kind: a.kind as MemoryInput['kind'], title: text(a, 'title'), content: text(a, 'content'), scope: { type: (a.scope ?? 'project') as MemoryInput['scope']['type'], ...(a.scope === 'task' ? { session: task, entry } : {}), ...(a.scope === 'repositories' ? { repos: a.repos as string[] } : {}) }, origin: { kind: 'user', reference: `workbench:${task}` }, sources: a.sources as MemoryInput['sources'], appliesWhen: a.appliesWhen as string | undefined }, { userStated: true, replaces: a.replaces as string | undefined, access });
        case 'memory-forget': {const store=await MemoryStore.open(w),memory=await store.read(text(a,'id'),access);await store.forget(text(a,'id'),access);return {forgottenMemory:memory.record.id,title:memory.record.title};}
        case 'memory-read': return (await MemoryStore.open(w)).read(text(a, 'id'), access);
        case 'memory-reindex': {const store=await MemoryStore.open(w),indexed=await store.index(true),visible=await store.records(access);return {memoryIndex:true,indexed:visible.items.length,refreshed:indexed.refreshed,reused:indexed.reused,unavailable:indexed.unavailable};}
        case 'memory-recover': return (await MemoryStore.open(w)).recover();
        case 'reading-open': return new ReadingStore(w).open(text(a, 'query'), { repo: a.repo as string | undefined, node: a.node as string | undefined });
        case 'map-annotate': {
            try{return await new TaskReadingStore(w).annotate(text(a, 'id'), Number(a.revision), { insights: a.insights as Parameters<TaskReadingStore['annotate']>[2]['insights'],requirements:a.requirements as Parameters<TaskReadingStore['annotate']>[2]['requirements'] }, task);}
            catch(error){if((error as Error).message.includes('source or revision changed'))throw new Error('地图来源或修订已变化，请重新生成或打开当前地图后再补充说明。');throw error;}
        }
        case 'memory-organize': return (await MemoryStore.open(w)).organize({ signal,access,ids:Array.isArray(a.drafts)&&a.drafts.length?a.drafts as string[]:undefined,limit:Array.isArray(a.drafts)&&a.drafts.length?Math.min(10,a.drafts.length):3 });
        case 'knowledge-draft': return new ProjectKnowledge(w).draft({ ...a, task, entry } as unknown as KnowledgeInput, access);
        case 'observer-question': return askObserver(w.root, text(a, 'question'), { session: task });
        case 'review-run': return runPiReview(w, { baseline: text(a, 'baseline'), goal: text(a, 'goal'), requirements: notes(controller, a.entries).map(n => ({ text: n.text, reference: n.reference })), evidence: a.evidence as string[] | undefined,task,planFile:scope }, { modelRuntime: controller.options.models, provider: controller.chat.provider, model: controller.chat.model, agentDir: controller.options.agentDir, signal });
        case 'service-add': {
            const envFromServices = Array.isArray(a.envFromServices) ? Object.fromEntries((a.envFromServices as {
                name: string;
                service: string;
                value: 'url' | 'port';
            }[]).map(({ name, ...value }) => [name, value])) : a.envFromServices;
            const services=new ServiceManager(w),existing=(await services.definitions()).find(item=>item.id===a.id);
            if(existing&&!a.version)throw new Error('已存在同名服务，请先从服务卡片打开编辑，避免覆盖新配置。');
            const {version,...input}=a;
            return {...await services.add({ ...input, envFromServices } as unknown as ServiceInput,version as string|undefined),serviceConfigured:true};
        }
        case 'service-start': return new ServiceManager(w).start(text(a, 'id'), { task, signal });
        case 'service-stop': return new ServiceManager(w).stop(text(a, 'id'));
        case 'service-restart': return new ServiceManager(w).restart(text(a, 'id'), { task, signal });
        case 'background-start': return new BackgroundRuns(w).start({ ...a, task } as unknown as BackgroundInput);
        case 'background-cancel': return new BackgroundRuns(w).cancel(text(a, 'id'), task);
        case 'wait-start': {
            const condition = { ...(a.condition as Record<string, unknown>) };
            if (condition.kind === 'github')
                condition.run = Number(condition.githubRun??condition.run);
            delete condition.githubRun;
            return events.start({ ...a, condition, task, entry } as unknown as WaitInput);
        }
        case 'wait-cancel': return events.cancel(text(a, 'id'), task);
        case 'browser-add': return {...await new BrowserValidation(w).add(a as unknown as BrowserScenario),browserConfigured:true};
        case 'browser-run': {const browser=new BrowserValidation(w),report=await browser.run(text(a,'id'),{signal,task,entry});return browser.read(report.id);}
        case 'browser-report': return new BrowserValidation(w).read(text(a, 'id'));
        case 'background-acknowledge': {
            await new BackgroundRuns(w).status(text(a, 'id'), task);
            return new BackgroundRuns(w).acknowledge(text(a, 'id'), text(a, 'observation'));
        }
        case 'artifact-add': return new Artifacts(w).add({ ...a, task, entry } as unknown as ArtifactInput);
        case 'handoff-export': {
            const selected=a.mode==='background'?notes(controller,a.entries):(await packageInput()).notes;
            const input={mode:a.mode as HandoffMode,goal:text(a,'goal'),source,notes:selected,evidence:a.evidence as string[]|undefined,includeEvidence:true,memories:a.memories as string[]|undefined,memoryAccess:access,planOverride:await plan.current()??null},directory=text(a,'destination');
            const result=a.baseDirectory?await exportDifferentialHandoff(w,text(a,'baseDirectory'),directory,input):{manifest:await exportHandoff(w,directory,input)};
            return {...result,handoffExport:true,directory,documentPath:join(directory,'handoff.md'),document:renderHandoff(result.manifest)};
        }
        case 'handoff-inspect': return inspectPortableHandoff(w, text(a, 'directory'),{memoryAccess:access});
        case 'new-context': return controller.runCommand('new-context', JSON.stringify({ goal: a.goal, entries: ((a.entries ?? []) as string[]).map(id => ({ id })) }));
        case 'package-export': return {...await new TaskPackages(w).export(await packageInput(), { signal }),packageExport:true};
        case 'package-inspect': {const inspected=await TaskPackages.inspect(text(a, 'directory'));return {manifest:inspected.manifest,directory:inspected.directory,manifestHash:inspected.manifestHash,packageInspection:true};}
        case 'package-restore': {
            const r = await TaskPackages.restore(text(a, 'directory'), text(a, 'destination'), { expectedManifest:text(a,'expectedManifest'),writeRepos: a.writeRepos as string[], activateRuntime: a.activateRuntime === true, preparePi: true, signal });
            return { packageRestored:true,goal:r.source.goal,sourcePackage:r.source.id,workspace: r.workspace.root, session: r.piSession,runtimeActivated:r.runtimeActivated,repos:r.workspace.config.repos.map(repo=>({id:repo.id,root:repo.root,access:repo.access})),materials:r.resources,handoff:r.handoff };
        }
        case 'recover': return w.recover();
        case 'acknowledge': return w.exclusive(() => w.acknowledgeOperation(text(a, 'id'), text(a, 'observation')));
    }
    throw new Error('Unsupported operation');
}
export async function domainData(controller: DomainController, group: string, query = '',options:{offset?:number}={}) {
    const w = controller.options.workspace, task = controller.chat.session;
    const access = { session: task, entries: controller.runtime.session.sessionManager.getBranch().map(e => e.id) };
    if (group === 'plan')
        return await new PlanStore(w, await planScope(controller)).view() ?? null;
    if(group==='maps')return new TaskReadingStore(w).list(task);
    if (group === 'skills' || group === 'recipes') {
        const store=new RecipeStore(w),recipes=await store.list(),proposals=await store.proposals(task,recipes),plan=await new PlanStore(w,await planScope(controller)).view();
        const data={recipes,runs:await store.runs(task),proposals:proposals.items,proposalNotice:{unavailable:proposals.unavailable,truncated:proposals.truncated},interruption:await store.interruption(),proposalPlan:plan?{completed:plan.completed,total:plan.total,eligible:plan.completed===plan.total&&!plan.gaps.length}:null};
        return group==='recipes'?data:{...data,catalog: await new SkillDiscovery(() => loadNativeSkills(w, { agentDir: controller.options.agentDir })).search(query, { includeManual: true, limit: 30 }), paths: await skillPaths(w)};
    }
    if (group === 'memory') {
        const store=await MemoryStore.open(w),drafts=await store.drafts(access);
        return { enabled:controller.snapshot().memory, search:query.trim()?await store.search(query,access,{includeStale:true,limit:20,offset:options.offset}):await store.catalog(access,{offset:options.offset}),drafts:{items:drafts.items.slice(0,50),unavailable:drafts.unavailable,total:drafts.items.length,more:drafts.items.length>50} };
    }
    if (group === 'observer')
        return {...await askObserver(w.root, query || '当前运行状态', { session: task }),operationHistory:workbenchOperationHistory(controller.runtime.session.sessionManager.getBranch())};
    if (group === 'environment') {
        const services=await new ServiceManager(w).list(),browser=new BrowserValidation(w);
        return { services, background: await new BackgroundRuns(w).list(task), waits: await new TaskEvents(w).list(task), scenarios: await browser.list(),browserReports:await browser.reports(services) };
    }
    if (group === 'collaboration')
        return { delegations: await new Delegations(w).list(task), experiments: await Promise.all((await new Experiments(w).list(task)).map(e => new Experiments(w).report(e.id, task))) };
    if (group === 'timeline')
        return { checkpoints: await w.checkpoints(), contextCheckpoints: contextCheckpoints(controller.runtime.session.sessionManager),
            modelRewinds: contextRewindHistory(controller.runtime.session.sessionManager), operations: await w.operations(), tree: controller.snapshot().tree };
    if (group === 'reading')
        return { graph: await repoGraph(w), changeReading: await new ChangeReadings(w).latest(task), changeReadings: await new ChangeReadings(w).list(task) };
    if (group === 'review') return listReviews(w,task);
    if (group === 'handoff') {
        const packages=await new TaskPackages(w).list(task);
        return { entries: controller.snapshot().messages, packages:packages.items,packagesTruncated:packages.truncated };
    }
    if (group === 'choices') {
        const overview = await import('./project-overview.js').then(m => m.projectOverview(w, { task })), recipe = new RecipeStore(w), mergePreviews = [];
        try {
            for (const id of (await readdir(join(w.data, 'merge-previews'))).slice(-50)) {
                const p = await readJson<{
                    delegation: string;
                    id: string;
                }>(join(w.data, 'merge-previews', id, 'preview.json'));
                if (overview.delegates.some(d => d.spec.id === p.delegation))
                    mergePreviews.push(p);
            }
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                throw e;
        }
        const browserReports = [];
        try {
            for (const id of (await readdir(join(w.data, 'browser-runs'))).slice(-30))
                try {
                    browserReports.push(await readJson(join(w.data, 'browser-runs', id, 'report.json')));
                }
                catch (e) {
                    if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                        throw e;
                }
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                throw e;
        }
        return { ...overview, recipes: await recipe.list(), recipeRuns: (await recipe.runs(task)).map(item=>({...item,id:item.run.id,label:`${item.recipeLabel||item.run.recipe} · 修订 ${item.run.revision} · ${item.run.createdAt}`})), scenarios: await new BrowserValidation(w).list(), mergePreviews, browserReports };
    }
    throw Error('Unknown panel');
}

/** Load only the choices requested by a form. Opening a checkpoint selector
 * must not scan every service, artifact, event and delegated task. */
export async function domainChoices(controller: DomainController, sources: string[], query = '') {
    const w=controller.options.workspace,task=controller.chat.session;
    const loaders: Record<string,()=>Promise<unknown>|unknown> = {
        repos:()=>w.config.repos,
        checks:()=>w.config.checks,
        memories:async()=>{const store=await MemoryStore.open(w);return (await store.records({session:task,entries:controller.runtime.session.sessionManager.getBranch().map(entry=>entry.id)})).items.map(record=>({id:record.id,label:`${record.title} · ${record.scope.type==='task'?'仅此任务':record.scope.repos?.join('、')||'项目'} · 修订 ${record.revision}`}));},
        memoryDrafts:async()=>{const store=await MemoryStore.open(w);return (await store.drafts({session:task,entries:controller.runtime.session.sessionManager.getBranch().map(entry=>entry.id)})).items.filter(draft=>draft.state==='queued').map(draft=>({id:draft.id,label:draft.input.title}));},
        taskMaps:async()=>(await new TaskReadingStore(w).list(task)).items.map(item=>({...item.report,label:`${item.report.goal} · 修订 ${item.report.revision}`})),
        checkEvidence:async()=>{
            const directory=join(w.data,'evidence');let names:string[]=[];
            try{names=(await readdir(directory)).filter(name=>name.endsWith('.json'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
            const recent=(await Promise.all(names.map(async name=>({name,mtime:(await stat(join(directory,name))).mtimeMs})))).sort((a,b)=>b.mtime-a.mtime).slice(0,50);
            if(!recent.length)return [];
            const current=await w.observe(),items=[];
            for(const {name} of recent){
                const entry=await readJson<import('./types.js').Evidence>(join(directory,name));
                const data=entry.data as {status?:string;results?:{check:string;status:string}[]};
                if(entry.kind!=='check'||entry.validAtCapture!==true||data.status!=='verified'||!data.results?.length||data.results.some(result=>result.status!=='passed')
                    ||entry.configuration!==current.configuration||entry.environment!==current.environment||JSON.stringify(entry.fingerprints)!==JSON.stringify(current.fingerprints))continue;
                items.push({id:entry.id,label:`${data.results.map(result=>result.check).join('、')} · ${entry.createdAt}`});
            }
            return items;
        },
        checkpoints:()=>w.checkpoints(),
        documentExamples:async()=>(await new DocumentationStore(w).list()).flatMap(document=>(document.record.examples||[]).map(example=>({id:`${document.record.id}/${example.id}`,label:`${document.record.title} · ${example.section} · ${example.id}`}))),
        entries:()=>controller.snapshot().messages,
        materials:async()=>(await new ProjectContext(w).search(query,{task},30)).items,
        services:()=>new ServiceManager(w).list(),
        background:()=>new BackgroundRuns(w).list(task),
        waits:()=>new TaskEvents(w).list(task),
        delegations:()=>new Delegations(w).list(task),
        experiments:()=>new Experiments(w).list(task),
        artifacts:()=>new Artifacts(w).list(task),
        recipes:()=>new RecipeStore(w).list(),
        recipeRuns:async()=>(await new RecipeStore(w).runs(task)).map(item=>({...item,id:item.run.id,label:`${item.recipeLabel||item.run.recipe} · 修订 ${item.run.revision} · ${item.run.createdAt}`})),
        recipeLocks:async()=>{const store=new RecipeStore(w),owner=await store.interruption();if(!owner)return [];const recipe=owner.recipe?(await store.list()).find(recipe=>recipe.id===owner.recipe):undefined;return [{id:owner.token,label:`${recipe?.label||'中断的配方'} · ${owner.canReconcile?'原进程已退出':'原进程仍在运行或状态待确认'}`}];},
        scenarios:()=>new BrowserValidation(w).list(),
        mergePreviews:async()=>{
            const delegated=new Set((await new Delegations(w).list(task)).map(d=>d.spec.id)),items=[];
            let names:string[]=[];try{names=await readdir(join(w.data,'merge-previews'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
            for(const id of names.slice(-50)){const record=await readJson<{delegation:string;id:string}>(join(w.data,'merge-previews',id,'preview.json'));if(delegated.has(record.delegation))items.push(record);}
            return items;
        },
        browserReports:async()=>{
            const items=[];let names:string[]=[];try{names=await readdir(join(w.data,'browser-runs'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
            for(const id of names.slice(-30))try{items.push(await readJson(join(w.data,'browser-runs',id,'report.json')));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
            return items;
        },
    };
    const selected=[...new Set(sources)];
    if(selected.length>Object.keys(loaders).length||selected.some(source=>!Object.hasOwn(loaders,source)))throw new Error('Unsupported form choice source');
    return Object.fromEntries(await Promise.all(selected.map(async source=>[source,await loaders[source]!()])));
}
