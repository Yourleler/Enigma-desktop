import { join } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import type { WorkbenchSession } from './workbench-session.js';
import type { AgentSession, ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { Workspace } from './workspace.js';

/** Domain calls can attach to a native host without creating another agent runtime. */
export interface DomainController {
    options: { workspace: Workspace; models: ModelRuntime; agentDir: string };
    chat: { session: string; provider: string; model: string };
    runtime: { session: AgentSession };
    snapshot(): Pick<ReturnType<WorkbenchSession['snapshot']>, 'memory' | 'tree' | 'messages'>;
    runCommand(name: string, args: string): Promise<unknown>;
}
import { PlanStore, type PlanInput, type PlanStep } from './planning.js';
import { repoGraph } from './reading.js';
import { ReadingStore } from './reading-store.js';
import { SourceIndex } from './source-index.js';
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
import { exportHandoff, inspectHandoff, type HandoffMode } from './handoff.js';
import { selectedPiNotes } from './pi-session.js';
import { runPiReview } from './pi-review.js';
import { askObserver } from './observer-questions.js';
import { previewRestore } from './solutions.js';
import { hash, readJson, safeId } from './storage.js';
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
const identifier = field('id', '记录 ID', 'text', { required: true });
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
    { id: 'repo-add', group: 'project', title: '加入仓库', description: '注册现有 Git 仓库，保留独立位置。', effect: 'write', fields: [identifier, field('path', '本地绝对路径', 'text', { required: true }), field('role', '仓库职责'), field('readOnly', '只读', 'boolean')] },
    { id: 'repo-dependencies', group: 'project', title: '调整仓库依赖', description: '声明上游依赖，查看联合影响。', effect: 'write', fields: [repo, field('dependsOn', '上游仓库', 'multi', { source: 'repos' })] },
    { id: 'check-add', group: 'project', title: '添加验收检查', description: '用户定义原检查，模型不能自行放宽。', effect: 'write', fields: [identifier, repo, argv, field('joint', '联合检查', 'boolean'), timeout] },
    { id: 'verify', group: 'project', title: '运行全部检查', description: '执行当前注册的各仓库与联合标准。', effect: 'execute', fields: [] },
    { id: 'plan-create', group: 'plan', title: '建立任务目标', description: '目标、步骤、依赖和原检查形成版本计划。', effect: 'write', fields: [goal, field('steps', '任务步骤', 'rows', { required: true, fields: [identifier, repo, goal, field('requires', '前置步骤 ID', 'lines'), checks] })] },
    { id: 'plan-step', group: 'plan', title: '更新步骤进度', description: '完成需要当前有效证据；原计划修订保留。', effect: 'write', fields: [field('plan', '计划 ID', 'text', { required: true }), field('revision', '当前修订', 'number', { required: true }), field('step', '步骤 ID', 'text', { required: true }), field('phase', '阶段', 'select', { options: ['pending', 'running', 'failed', 'verified'], required: true }), field('evidence', '验收证据 ID')] },
    { id: 'code-read', group: 'reading', title: '追踪代码', description: '按问题追踪静态定义、调用和跨仓库关系。', fields: [field('query', '符号或问题关键词', 'text', { required: true }), field('repo', '限定仓库', 'select', { source: 'repos' }), field('maxFiles', '文件预算', 'number', { value: 120 })] },
    { id: 'source-index', group: 'reading', title: '查询源码索引', description: '在预算内选择源码候选，失效索引可重建。', fields: [field('query', '关键词', 'text', { required: true }), field('language', '语言', 'select', { options: ['Go', 'Python', 'TypeScript'] }), field('maxFiles', '文件预算', 'number', { value: 120 })] },
    { id: 'schema-read', group: 'reading', title: '阅读 Schema / IDL', description: '读取字段、类型和有来源的契约关系。', fields: [field('query', '类型或字段关键词')] },
    { id: 'map-build', group: 'reading', title: '建立任务代码地图', description: '按任务和 diff 关联入口、消费者、职责及原检查。', effect: 'write', fields: [goal, field('symbol', '起始符号'), field('repo', '起始仓库', 'select', { source: 'repos' }), field('baseline', '差异基线', 'select', { source: 'checkpoints' }), resources, field('requirements', '需求与测试点', 'rows', { fields: [identifier, field('text', '要求', 'textarea', { required: true }), checks] })] },
    { id: 'map-coverage', group: 'reading', title: '检查需求覆盖', description: '静态依据与实际检查分别核对，旧证据不算通过。', fields: [identifier, field('evidence', '检查证据 ID')] },
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
    { id: 'checkpoint', group: 'timeline', title: '记录检查点', description: '关联代码、当前会话节点与计划。', effect: 'write', fields: [field('label', '标签', 'text', { required: true })] },
    { id: 'restore-preview', group: 'timeline', title: '预览代码恢复', description: '核对当前代码，外部修改阻止覆盖。', fields: [field('target', '恢复目标', 'select', { source: 'checkpoints', required: true }), field('expected', '当前基线', 'select', { source: 'checkpoints', required: true })] },
    { id: 'restore', group: 'timeline', title: '恢复代码 / 上下文', description: '显式恢复；最新要求、累计消耗和原用户文件保留。', effect: 'execute', fields: [field('target', '恢复目标', 'select', { source: 'checkpoints', required: true }), field('expected', '当前基线', 'select', { source: 'checkpoints', required: true }), field('context', '同时恢复关联上下文', 'boolean')] },
    { id: 'code-fork', group: 'timeline', title: '创建独立代码方案', description: '在新目录恢复方案，保留原仓库状态。', effect: 'execute', fields: [checkpoint, field('destination', '新目录绝对路径', 'text', { required: true })] },
    { id: 'memory-search', group: 'memory', title: '检索记忆', description: '当前作用域、来源和忘记状态重新核对。', fields: [field('query', '中文或符号关键词'), field('includeStale', '包含过期条目', 'boolean')] },
    { id: 'memory-read', group: 'memory', title: '阅读完整记忆', description: '实际正文与来源版本重新核对，过期和忘记明确报告。', fields: [identifier] },
    { id: 'memory-reindex', group: 'memory', title: '重建记忆索引', description: '从当前正文重建可丢弃的派生索引。', effect: 'write', fields: [] },
    { id: 'memory-recover', group: 'memory', title: '恢复记忆整理状态', description: '核对已退出的写入者，未结算草稿保持未知。', effect: 'write', fields: [] },
    { id: 'reading-open', group: 'reading', title: '展开已发布阅读', description: '读取对应源码版本和真实位置，失效证据保持可见。', fields: [field('query', '原查询', 'text', { required: true }), field('repo', '限定仓库', 'select', { source: 'repos' }), field('node', '阅读节点 ID')] },
    { id: 'map-annotate', group: 'reading', title: '补充讲解与风险', description: '引用当前地图节点，保持模型推断标识，不替代实际验收。', effect: 'write', fields: [identifier, field('revision', '当前修订', 'number', { required: true }), field('insights', '有依据的结论', 'rows', { fields: [title, field('text', '说明', 'textarea', { required: true }), field('kind', '类型', 'select', { options: ['explanation', 'risk'], value: 'explanation' }), field('anchors', '来源节点 ID', 'lines', { required: true })] })] },
    { id: 'memory-save', group: 'memory', title: '保存 / 更正记忆', description: '明确用户来源和范围，可用新条目替代旧条目。', effect: 'write', fields: [title, field('content', '正文', 'textarea', { required: true }), field('kind', '类型', 'select', { options: noteKinds, value: 'decision' }), field('scope', '范围', 'select', { options: ['project', 'task', 'repositories'], value: 'project' }), field('repos', '相关仓库', 'multi', { source: 'repos' }), sourceRows, field('replaces', '替代的旧记忆 ID'), field('appliesWhen', '适用条件')] },
    { id: 'memory-forget', group: 'memory', title: '忘记记忆', description: '停止召回，旧方案恢复也不复活。', effect: 'write', fields: [identifier] },
    { id: 'memory-organize', group: 'memory', title: '整理候选知识', description: '空闲时有限整理，有来源、可重建索引。', effect: 'write', fields: [] },
    { id: 'knowledge-draft', group: 'memory', title: '记录有依据的经验', description: '引用当前资料、源码或父验收证据，先保存为草稿。', effect: 'write', fields: [title, field('content', '经验正文', 'textarea', { required: true }), field('kind', '类型', 'select', { options: noteKinds.filter(k => k !== 'preference'), value: 'contract' }), resources, sourceRows, field('evidence', '父证据 ID', 'lines')] },
    { id: 'observer-question', group: 'observer', title: '询问运行状态', description: '旁路只根据可见事实回答，不阻塞主 Agent。', fields: [field('question', '你想知道什么', 'textarea', { required: true, value: '现在是在等待，还是有有效进展？' })] },
    { id: 'review-run', group: 'review', title: '按需独立审查', description: '新上下文只读冻结差异，意见不代替原验收。', effect: 'execute', fields: [field('baseline', '差异基线', 'select', { source: 'checkpoints', required: true }), goal, entries] },
    { id: 'service-add', group: 'environment', title: '配置服务', description: '定义独立服务、依赖和明确的就绪条件。', effect: 'write', fields: [identifier, field('label', '名称', 'text', { required: true }), repo, argv, field('dependsOn', '上游服务', 'multi', { source: 'services' }), field('portPrefix', '动态端口日志前缀'), field('readiness', '就绪条件', 'object', { fields: [field('type', '类型', 'select', { options: ['http', 'log', 'tcp'], value: 'http' }), field('port', '固定端口', 'number'), field('path', 'HTTP 路径'), field('includes', '预期响应或日志'), timeout] })] },
    ...['start', 'stop', 'restart'].map(action => ({ id: `service-${action}`, group: 'environment', title: ({ start: '启动服务', stop: '停止服务', restart: '重启服务' })[action]!, description: '只操作当前登记的拥有进程，核对依赖与实际终态。', effect: 'execute' as const, fields: [identifier] })),
    { id: 'background-start', group: 'environment', title: '运行后台命令', description: '有界运行、日志和实际终态，不占主工作区锁。', effect: 'execute', fields: [field('label', '名称', 'text', { required: true }), repo, argv, field('maxRuntimeMs', '运行时间上限（毫秒）', 'number', { value: 600000 })] },
    { id: 'background-cancel', group: 'environment', title: '取消后台命令', description: '取消拥有命令并核对退出。', effect: 'execute', fields: [identifier] },
    { id: 'wait-start', group: 'environment', title: '等待结果并接续', description: '选择具体运行和终态来源，空闲时接续原任务。', effect: 'write', fields: [field('label', '名称', 'text', { required: true }), field('condition', '等待条件', 'object', { fields: [field('kind', '来源', 'select', { options: ['background', 'delegation', 'service', 'github'], value: 'background' }), field('run', '后台 ID 或 GitHub run 编号'), field('task', '子任务 ID'), field('service', '服务 ID'), field('state', '服务状态', 'select', { options: ['ready', 'stopped'] }), field('repo', 'GitHub owner/repo')] }), field('resume', '结果到达后继续当前任务', 'boolean'), timeout] },
    { id: 'wait-cancel', group: 'environment', title: '取消等待', description: '只结束等待，不伪造目标结果。', effect: 'write', fields: [identifier] },
    { id: 'browser-add', group: 'environment', title: '配置浏览器验收', description: '真实页面步骤和预期结果，保留截图与轨迹。', effect: 'write', fields: [identifier, field('label', '名称', 'text', { required: true }), field('service', '已配置服务', 'select', { source: 'services', required: true }), serviceStep, timeout] },
    { id: 'browser-run', group: 'environment', title: '执行浏览器场景', description: '实际操作当前就绪服务并保存版本化结果。', effect: 'execute', fields: [identifier] },
    { id: 'browser-report', group: 'environment', title: '查看浏览器报告', description: '核对动作、截图、轨迹和当前来源有效性。', fields: [identifier] },
    { id: 'background-acknowledge', group: 'environment', title: '核对未知后台效果', description: '先确认进程停止和实际效果，记录说明，不重放命令。', effect: 'write', fields: [identifier, field('observation', '已核对的效果', 'textarea', { required: true })] },
    { id: 'recipe-report', group: 'skills', title: '查看配方运行报告', description: '实际步骤、验收、失败与取消的持久回执。', fields: [identifier] },
    { id: 'recipe-reconcile', group: 'skills', title: '核对中断配方', description: '核对停止和副作用后结算未知流程，原步骤不重放。', effect: 'write', fields: [field('observation', '实际效果说明', 'textarea', { required: true })] },
    { id: 'artifact-add', group: 'artifacts', title: '登记产物版本', description: '保存实际字节、来源和版本；源码改变仍可读历史。', effect: 'write', fields: [title, field('kind', '类型', 'select', { options: ['document', 'code', 'report', 'screenshot', 'trace', 'package'], value: 'document' }), field('repo', '文件所属仓库', 'select', { source: 'repos' }), field('file', '仓库内文件'), field('runtime', '或本工作区结果路径'), field('evidence', '证据 ID', 'lines')] },
    { id: 'handoff-export', group: 'handoff', title: '导出背景交接', description: '筛选原消息与新目标，保留来源角色，不迁移隐藏状态。', effect: 'write', fields: [goal, entries, field('mode', '模式', 'select', { options: ['background', 'continue', 'alternative'], value: 'background' }), field('destination', '新目录绝对路径', 'text', { required: true })] },
    { id: 'handoff-inspect', group: 'handoff', title: '核对交接包', description: '验证来源、当前代码和缺失项，不执行旧任务。', fields: [field('directory', '交接目录', 'text', { required: true })] },
    { id: 'new-context', group: 'handoff', title: '同背景开启新任务', description: '原对话保留，筛选背景，不自动继续旧目标。', effect: 'write', fields: [goal, entries] },
    { id: 'package-export', group: 'handoff', title: '导出可复现任务包', description: '含选定代码、材料、计划和原检查，目标端重新验收。', effect: 'write', fields: [goal, entries, resources, field('artifacts', '产物', 'multi', { source: 'artifacts' })] },
    { id: 'package-inspect', group: 'handoff', title: '检查任务包', description: '核对 manifest 和实际字节完整性。', fields: [field('directory', '任务包目录', 'text', { required: true })] },
    { id: 'package-restore', group: 'handoff', title: '在新目录复现', description: '显式指定可写仓库，新工作区重新启动和验收。', effect: 'execute', fields: [field('directory', '源任务包目录', 'text', { required: true }), field('destination', '目标新目录', 'text', { required: true }), field('writeRepos', '可写仓库', 'multi', { source: 'repos' }), field('activateRuntime', '加载服务/检查定义', 'boolean')] },
    { id: 'recover', group: 'timeline', title: '核对中断运行', description: '仅处理已停止的拥有进程，未知效果不自动重放。', effect: 'write', fields: [] },
    { id: 'acknowledge', group: 'timeline', title: '记录未知效果核对', description: '明确观察到的实际状态，保留原操作记录。', effect: 'write', fields: [identifier, field('observation', '已核对的实际效果', 'textarea', { required: true })] },
];
const recordSources: Record<string, string> = {
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
        action.fields = action.fields.map(f => f.name === 'id' ? { ...f, kind: 'select', source: recordSources[action.id], label: '选择项目记录' } : f);
    if (action.id === 'recipe-save')
        action.fields = action.fields.map(f => f.name === 'steps' ? { ...f, value: [{ id: 'acceptance', kind: 'verify' }], help: '配方最后保留全部原检查。可以添加步骤并调整顺序。' } : f);
    if (action.id === 'service-add')
        action.fields.push(field('envFromServices', '连接上游服务', 'rows', { fields: [field('name', '目标环境变量名', 'text', { required: true }), field('service', '来源服务', 'select', { source: 'services', required: true }), field('value', '传入内容', 'select', { options: ['url', 'port'], value: 'url' })] }), field('envRefs', '凭证环境变量引用', 'pairs', { help: '目标变量=已有环境变量名。只保存名称，不填写密钥值。' }), field('maxRuntimeMs', '服务最长运行时间（毫秒）', 'number'));
    if (action.id === 'background-start')
        action.fields.push(field('envRefs', '环境变量引用', 'pairs', { help: '目标变量=已有环境变量名；不在界面填入密钥值。' }));
    if (action.id === 'material-fetch')
        action.fields.push(field('startBlock', '起始文档区块'), field('endBlock', '结束文档区块'));
    if (action.id === 'package-export' || action.id === 'handoff-export')
        action.fields.push(field('evidence', '携带的证据 ID', 'lines'), field('memories', '携带的记忆 ID', 'lines'));
    if (action.id === 'review-run')
        action.fields.push(field('evidence', '参考验收证据 ID', 'lines'));
    if (action.id === 'recipe-save') action.fields=action.fields.map(f=>f.name!=='steps'?f:{...f,fields:f.fields?.map(child=>{
        const choices:Record<string,string[]>={repo:['command'],argv:['command'],service:['service'],action:['service'],scenario:['browser']};
        const values = choices[child.name];
        return values ? {...child,required:true,when:{field:'kind',values}} : child;
    })});
    if (action.id === 'browser-add') action.fields=action.fields.map(f=>f.name!=='steps'?f:{...f,fields:f.fields?.map(child=>{
        const choices:Record<string,string[]>={selector:['click','fill','expect','wait','check','uncheck','select','press'],value:['fill','select'],includes:['expect'],label:['screenshot'],path:['goto'],key:['press']};
        const values = choices[child.name];
        return values ? {...child,required:child.name!=='value',when:{field:'action',values}} : child;
    })});
    if(action.id==='wait-start')action.fields=action.fields.map(f=>f.name!=='condition'?f:{...f,fields:f.fields?.map(child=>{
        const choices:Record<string,string[]>={run:['background','github'],task:['delegation'],service:['service'],state:['service'],repo:['github']};
        const values = choices[child.name];
        return values ? {...child,required:true,when:{field:'kind',values}} : child;
    })});
    if(action.id==='delegate-start')action.fields=action.fields.map(f=>f.name==='maxRequests'?{...f,when:{field:'target',values:['pi']}}:f);
    if(action.id==='material-fetch')action.fields=action.fields.map(f=>f.name==='keyword'?{...f,when:{field:'scope',values:['keyword']}}:f.name==='startBlock'?{...f,when:{field:'scope',values:['section','range']}}:f.name==='endBlock'?{...f,when:{field:'scope',values:['range']}}:f);
    if(action.id==='memory-save')action.fields=action.fields.map(f=>f.name==='repos'?{...f,when:{field:'scope',values:['repositories']}}:f);
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
            if (state.reviewEntries?.length && !['recover', 'acknowledge', 'memory-forget'].includes(action))
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
        const known = new Set(selected.map(n => n.reference));
        for (const note of notes(controller, state.requirementEntries ?? []))
            if (!known.has(note.reference))
                selected.push({ ...note, kind: 'requirement' });
        for (const [index, value] of (state.requirements ?? []).entries())
            selected.push({ role: 'user', kind: 'requirement', reference: `pi:${task}:preserved-${index}`, text: value });
        return { goal: text(a, 'goal'), task, source: { ...source, requests: (state.requests ?? 0) + (state.inheritedRequests ?? 0) }, notes: selected, resources: a.resources as string[] | undefined, artifacts: a.artifacts as string[] | undefined, evidence: a.evidence as string[] | undefined, memories: a.memories as string[] | undefined, memoryAccess: access, plan: await plan.current() ?? null };
    };
    switch (action) {
        case 'repo-add': return w.exclusive(() => w.addRepo(text(a, 'id'), text(a, 'path'), { role: String(a.role ?? ''), access: a.readOnly ? 'read' : 'write' }));
        case 'repo-dependencies': return w.exclusive(() => w.setDependencies(text(a, 'repo'), (a.dependsOn ?? []) as string[]));
        case 'check-add': return w.exclusive(() => w.addCheck({ id: text(a, 'id'), repo: text(a, 'repo'), argv: a.argv as string[], joint: a.joint === true, timeoutMs: a.timeoutMs as number | undefined }));
        case 'verify': return w.exclusive(() => w.verify(signal));
        case 'plan-create': return plan.create(a as unknown as PlanInput);
        case 'plan-step': return plan.advance(text(a, 'step'), Number(a.revision), { phase: a.phase as PlanStep['phase'], evidence: a.evidence as string | undefined }, text(a, 'plan'));
        case 'code-read': return w.exclusive(() => new ReadingStore(w).update(text(a, 'query'), { repo: a.repo as string | undefined, maxFiles: a.maxFiles as number | undefined, signal }));
        case 'source-index': return new SourceIndex(w).select(text(a, 'query'), { language: a.language as 'Go' | 'Python' | 'TypeScript' | undefined, maxFiles: a.maxFiles as number | undefined, signal });
        case 'schema-read': return readSchemas(w, { query: String(a.query ?? ''), signal });
        case 'map-build': return new TaskReadingStore(w).build({ ...a, goal: text(a, 'goal'), task, baseline: a.baseline as string | undefined, resources: a.resources as string[] | undefined, requirements: a.requirements as TaskReadingInput['requirements'], queries: a.symbol ? [{ symbol: String(a.symbol), repo: a.repo as string | undefined }] : a.queries as TaskReadingInput['queries'] }, signal);
        case 'map-coverage': return new TaskReadingStore(w).coverage(text(a, 'id'), a.evidence as string | undefined, task);
        case 'material-file': return material.add({ title: text(a, 'title'), task: a.private ? task : undefined, source: { kind: 'file', repo: text(a, 'repo'), file: text(a, 'file') } });
        case 'material-note': return material.add({ title: text(a, 'title'), task: a.private ? task : undefined, source: { kind: 'note', author: 'user' }, content: text(a, 'content') });
        case 'material-fetch': return material.add({ ...await fetchResource(w, text(a, 'url'), { title: a.title as string | undefined, scope: a.scope as 'full' | 'outline' | 'keyword' | 'section' | 'range' | undefined, keyword: a.keyword as string | undefined, startBlock: a.startBlock as string | undefined, endBlock: a.endBlock as string | undefined, signal }), task: a.private ? task : undefined });
        case 'material-refresh': {
            const r = await material.read(text(a, 'id'), { task });
            return r.resource.source.kind === 'imported' ? refreshResource(w, text(a, 'id'), { task, signal }) : material.refresh(text(a, 'id'), { task });
        }
        case 'material-remove': return material.remove(text(a, 'id'), { task });
        case 'material-raw': {
            const r = await material.read(text(a, 'id'), { task });
            if (r.resource.source.kind !== 'imported' || !r.resource.source.capture)
                throw Error('此资料没有远端获取缓存。');
            return readResourceCapture(w, r.resource.source.capture.raw);
        }
        case 'skills-paths': {
            const result = await configureSkillPaths(w, a.paths as string[]);
            await controller.runtime.session.reload();
            return result;
        }
        case 'skills-read': {
            const catalogue = await new SkillDiscovery(() => loadNativeSkills(w, { agentDir: controller.options.agentDir })).search('', { includeManual: true, limit: 30 });
            const skill = catalogue.skills.find(s => s.id === text(a, 'id'));
            if (!skill || skill.version !== text(a, 'version'))
                throw Error('技能来源或版本已变化，请重新发现。');
            const content = await readFile(skill.file, 'utf8');
            if (hash(content) !== skill.version || Buffer.byteLength(content) > 256000)
                throw Error('技能在读取期间变化。');
            return { skill, content, role: 'selected skill reference', note: '手动阅读不扩大操作权限。' };
        }
        case 'recipe-save': {
            const parameters = Object.fromEntries(((a.parameters ?? []) as {
                name: string;
                description?: string;
                default?: string;
            }[]).map(p => [p.name, { description: p.description ?? '', ...(p.default ? { default: p.default } : {}) }]));
            return recipes.save({ ...a, parameters } as unknown as RecipeInput, a.revision as number | undefined);
        }
        case 'recipe-run': {
            const r = await recipes.read(text(a, 'id'));
            return recipes.run(r.id, (a.parameters ?? {}) as Record<string, string>, { task, entry, signal, expectedVersion: r.version });
        }
        case 'recipe-propose': {
            const p = await plan.current();
            if (!p)
                throw Error('当前任务没有计划。');
            return recipes.propose(p, task);
        }
        case 'recipe-report': return recipes.readRun(text(a, 'id'), task);
        case 'recipe-reconcile': return recipes.reconcileLock(text(a, 'observation'));
        case 'delegate-start': return delegates.start({ ...await packageInput(), target: a.target as 'pi' | 'codex', writeRepos: a.writeRepos as string[] | undefined, checks: a.checks as string[] | undefined, maxRequests: a.target === 'pi' ? a.maxRequests as number | undefined : undefined, timeoutMs: a.timeoutMs as number | undefined, agentDir: controller.options.agentDir, provider: controller.chat.provider, model: controller.chat.model });
        case 'delegate-cancel': return delegates.cancel(text(a, 'id'), task);
        case 'delegate-preview': return delegates.preview(text(a, 'id'), task, { planFile: scope });
        case 'delegate-merge': return delegates.merge(text(a, 'id'), { task, signal, planFile: scope });
        case 'experiment-create': return new Experiments(w).create({ ...a, task } as unknown as ExperimentInput);
        case 'experiment-evaluate': return new Experiments(w).evaluate(text(a, 'id'), { task, signal });
        case 'experiment-select': return new Experiments(w).select(text(a, 'id'), text(a, 'candidate'), { task, planFile: scope });
        case 'checkpoint': return w.exclusive(() => w.checkpoint(text(a, 'label'), { session: task, entry }));
        case 'restore-preview': return w.exclusive(() => previewRestore(w, text(a, 'target'), text(a, 'expected')));
        case 'restore': return controller.runCommand('enigma-restore', JSON.stringify(a));
        case 'code-fork': return controller.runCommand('branch-code', JSON.stringify(a));
        case 'memory-search':
            if (!String(a.query ?? '').trim())
                return { items: [], note: '输入关键词以按需召回。' };
            return (await MemoryStore.open(w)).search(String(a.query), access, { includeStale: a.includeStale === true });
        case 'memory-save': return (await MemoryStore.open(w)).save({ kind: a.kind as MemoryInput['kind'], title: text(a, 'title'), content: text(a, 'content'), scope: { type: (a.scope ?? 'project') as MemoryInput['scope']['type'], ...(a.scope === 'task' ? { session: task, entry } : {}), ...(a.scope === 'repositories' ? { repos: a.repos as string[] } : {}) }, origin: { kind: 'user', reference: `workbench:${task}` }, sources: a.sources as MemoryInput['sources'], appliesWhen: a.appliesWhen as string | undefined }, { userStated: true, replaces: a.replaces as string | undefined, access });
        case 'memory-forget': return (await MemoryStore.open(w)).forget(text(a, 'id'), access);
        case 'memory-read': return (await MemoryStore.open(w)).read(text(a, 'id'), access);
        case 'memory-reindex': return (await MemoryStore.open(w)).index(true);
        case 'memory-recover': return (await MemoryStore.open(w)).recover();
        case 'reading-open': return new ReadingStore(w).open(text(a, 'query'), { repo: a.repo as string | undefined, node: a.node as string | undefined });
        case 'map-annotate': return new TaskReadingStore(w).annotate(text(a, 'id'), Number(a.revision), { insights: a.insights as Parameters<TaskReadingStore['annotate']>[2]['insights'] }, task);
        case 'memory-organize': return (await MemoryStore.open(w)).organize({ signal });
        case 'knowledge-draft': return new ProjectKnowledge(w).draft({ ...a, task, entry } as unknown as KnowledgeInput, access);
        case 'observer-question': return askObserver(w.root, text(a, 'question'), { session: task });
        case 'review-run': return runPiReview(w, { baseline: text(a, 'baseline'), goal: text(a, 'goal'), requirements: notes(controller, a.entries).map(n => ({ text: n.text, reference: n.reference })), evidence: a.evidence as string[] | undefined }, { modelRuntime: controller.options.models, provider: controller.chat.provider, model: controller.chat.model, agentDir: controller.options.agentDir, signal });
        case 'service-add': {
            const envFromServices = Array.isArray(a.envFromServices) ? Object.fromEntries((a.envFromServices as {
                name: string;
                service: string;
                value: 'url' | 'port';
            }[]).map(({ name, ...value }) => [name, value])) : a.envFromServices;
            return new ServiceManager(w).add({ ...a, envFromServices } as unknown as ServiceInput);
        }
        case 'service-start': return new ServiceManager(w).start(text(a, 'id'), { task, signal });
        case 'service-stop': return new ServiceManager(w).stop(text(a, 'id'));
        case 'service-restart': return new ServiceManager(w).restart(text(a, 'id'), { task, signal });
        case 'background-start': return new BackgroundRuns(w).start({ ...a, task } as unknown as BackgroundInput);
        case 'background-cancel': return new BackgroundRuns(w).cancel(text(a, 'id'), task);
        case 'wait-start': {
            const condition = { ...(a.condition as Record<string, unknown>) };
            if (condition.kind === 'github')
                condition.run = Number(condition.run);
            return events.start({ ...a, condition, task, entry } as unknown as WaitInput);
        }
        case 'wait-cancel': return events.cancel(text(a, 'id'), task);
        case 'browser-add': return new BrowserValidation(w).add(a as unknown as BrowserScenario);
        case 'browser-run': return new BrowserValidation(w).run(text(a, 'id'), { signal });
        case 'browser-report': return new BrowserValidation(w).read(text(a, 'id'));
        case 'background-acknowledge': {
            await new BackgroundRuns(w).status(text(a, 'id'), task);
            return new BackgroundRuns(w).acknowledge(text(a, 'id'), text(a, 'observation'));
        }
        case 'artifact-add': return new Artifacts(w).add({ ...a, task, entry } as unknown as ArtifactInput);
        case 'handoff-export': return exportHandoff(w, text(a, 'destination'), { mode: a.mode as HandoffMode, goal: text(a, 'goal'), source, notes: notes(controller, a.entries), evidence: a.evidence as string[] | undefined, includeEvidence: true, memories: a.memories as string[] | undefined, memoryAccess: access, planOverride: await plan.current() ?? null });
        case 'handoff-inspect': return inspectHandoff(w, text(a, 'directory'));
        case 'new-context': return controller.runCommand('new-context', JSON.stringify({ goal: a.goal, entries: ((a.entries ?? []) as string[]).map(id => ({ id })) }));
        case 'package-export': return new TaskPackages(w).export(await packageInput(), { signal });
        case 'package-inspect': return (await TaskPackages.inspect(text(a, 'directory'))).manifest;
        case 'package-restore': {
            const r = await TaskPackages.restore(text(a, 'directory'), text(a, 'destination'), { writeRepos: a.writeRepos as string[], activateRuntime: a.activateRuntime === true, preparePi: true, signal });
            return { workspace: r.workspace.root, session: r.piSession };
        }
        case 'recover': return w.recover();
        case 'acknowledge': return w.exclusive(() => w.acknowledgeOperation(text(a, 'id'), text(a, 'observation')));
    }
    throw new Error('Unsupported operation');
}
export async function domainData(controller: DomainController, group: string, query = '') {
    const w = controller.options.workspace, task = controller.chat.session;
    const access = { session: task, entries: controller.runtime.session.sessionManager.getBranch().map(e => e.id) };
    if (group === 'plan')
        return await new PlanStore(w, await planScope(controller)).view() ?? null;
    if (group === 'skills') {
        const proposals = [];
        try {
            for (const file of (await readdir(join(w.data, 'recipe-proposals'))).filter(file => file.endsWith('.json')).slice(-30)) {
                const p = await readJson<{
                    task?: string;
                }>(join(w.data, 'recipe-proposals', file));
                if (!p.task || p.task === task)
                    proposals.push(p);
            }
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                throw e;
        }
        return { catalog: await new SkillDiscovery(() => loadNativeSkills(w, { agentDir: controller.options.agentDir })).search(query, { includeManual: true, limit: 30 }), paths: await skillPaths(w), recipes: await new RecipeStore(w).list(), runs: await new RecipeStore(w).runs(task), proposals };
    }
    if (group === 'memory')
        return { enabled: controller.snapshot().memory, search: query.trim() ? await (await MemoryStore.open(w)).search(query, access, { includeStale: true }) : { items: [], note: '请输入关键词按需召回记忆。' } };
    if (group === 'observer')
        return askObserver(w.root, query || '当前运行状态', { session: task });
    if (group === 'environment')
        return { services: await new ServiceManager(w).list(), background: await new BackgroundRuns(w).list(task), waits: await new TaskEvents(w).list(task), scenarios: await new BrowserValidation(w).list() };
    if (group === 'collaboration')
        return { delegations: await new Delegations(w).list(task), experiments: await Promise.all((await new Experiments(w).list(task)).map(e => new Experiments(w).report(e.id, task))) };
    if (group === 'timeline')
        return { checkpoints: await w.checkpoints(), operations: await w.operations(), tree: controller.snapshot().tree };
    if (group === 'reading')
        return { graph: await repoGraph(w) };
    if (group === 'review') {
        let ids: string[] = [];
        try {
            ids = await readdir(join(w.data, 'reviews'));
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                throw e;
        }
        const reports = [];
        for (const id of ids.slice(-50))
            try {
                reports.push(await readJson(join(w.data, 'reviews', safeId(id), 'report.json')));
            }
            catch (e) {
                if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                    throw e;
            }
        return reports;
    }
    if (group === 'handoff') {
        const packages = [];
        try {
            for (const id of (await readdir(join(w.data, 'packages'))).slice(-50))
                packages.push({ id, directory: join(w.data, 'packages', id) });
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                throw e;
        }
        return { entries: controller.snapshot().messages, packages };
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
        return { ...overview, recipes: await recipe.list(), recipeRuns: await recipe.runs(task), scenarios: await new BrowserValidation(w).list(), mergePreviews, browserReports };
    }
    throw Error('Unknown panel');
}
