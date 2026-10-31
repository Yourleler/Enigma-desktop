import type { Action, Field } from './state';

export function checkpointLabel(label: string | undefined): string {
  if (!label) return '代码快照';
  if (label.startsWith('restored:')) return `恢复后 · ${checkpointLabel(label.slice(9))}`;
  if (label.startsWith('fork:')) return `另开方案 · ${checkpointLabel(label.slice(5))}`;
  if (label.startsWith('merge:delegation-')) return `合入独立子任务 · ${label.slice(-6)}`;
  if (label.startsWith('managed integration:')) return `整合子任务后 · ${label.slice(-6)}`;
  if (label.startsWith('manager:')) return `管家分派任务时 · ${label.slice(-6)}`;
  if (label.startsWith('dependency input:')) return `带入前置成果时 · ${label.slice(-6)}`;
  if (label === 'before managed integration') return '整合子任务前';
  if (label === 'before managed recovery') return '管家恢复前';
  if (/^Before assistant step \d+/.test(label)) return label.replace(/^Before assistant step (\d+)/, '助手第 $1 步之前').replace(' after ', ' · 完成工具：');
  return ({ 'turn settled': '本轮结束时', 'session baseline': '对话开始时', manual: '手动保存', 'workbench diff': '查看差异时', 'context switched; code unchanged': '切换思路后（代码未变）', 'before child merge':'预览子任务合并时', 'merge proposal':'子任务提交的方案', 'task package':'导出代码任务包时', 'restored task package':'导入代码任务包后', 'review target':'发起代码审查时', 'task reading target':'生成任务阅读时', 'dependency output':'前置任务完成时', 'selected worker result':'选取工作对话成果时' } as Record<string, string>)[label] || label;
}
export function displayTime(time: string | number | undefined): string {
  if (!time) return '时间未记录';
  const date = new Date(time);
  return Number.isNaN(date.getTime()) ? '时间未记录' : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}
export function checkpointChoice(point: any): string {
  return `${checkpointLabel(point.label)} · ${displayTime(point.createdAt)} · ${String(point.id).slice(-6)}`;
}
export function explainConflict(text: string) {
  return text.replace('external edits differ from expected state', '当前文件与核对基准不一致，可能有其他修改；已阻止覆盖')
    .replace('Git history differs; use an independent code fork', 'Git 分支或提交历史不同；请使用「另开代码方案」')
    .replace('repository is read-only', '仓库只有读取权限，不能恢复文件')
    .replace('missing expected state', '核对基准缺少此仓库，无法确认当前状态');
}
export function explainEvidenceProblem(text:string) {
  return text.replace('Original requirement has no current assessment','这条原要求还没有与当前版本对应的处理说明')
    .replace('Evidence stale:','验收证据已过期：').replace('Evidence unavailable:','验收证据暂不可用：')
    .replace('Artifact source changed:','成果对应的源码已变化：').replace('Artifact unavailable:','成果暂不可用：')
    .replace('Document content changed','文档内容已变化').replace('Source changed:','源码已变化：').replace('Source unavailable:','源码暂不可用：');
}
export function executionHint(output:string|undefined){
  if(output&&/socket\.bind|server_bind|listen.*(?:EPERM|EACCES)/i.test(output)&&/Operation not permitted|PermissionError|EPERM|EACCES/i.test(output))return '服务器监听被系统拒绝。若原检查需要启动开发服务器，请核对“设置 → 安全 → 工程开发服务器”；启用前确认项目的监听地址。原检查尚未通过。';
  return undefined;
}
export function operationLabel(state: string | undefined) {
  const observerLabels:Record<string,string>={terminated:'来源进程已退出','pid-reused':'来源进程身份变化','source-stopped':'采集来源已停止',error:'执行失败',closed:'已结束',aborted:'已停止',budget:'调用额度已用完',passed:'检查通过',verified:'检查通过',unverified:'尚未验证',blocked:'待处理阻塞'};
  if(state&&observerLabels[state])return observerLabels[state];
  return ({ running: '正在执行', starting:'正在启动', ready:'服务已就绪', 'not-started':'尚未启动', 'configuration-changed':'服务配置已变化', 'dependency-changed':'上游依赖已变化', 'source-changed':'源码版本已变化', 'readiness-timeout':'就绪等待超时', completed: '已完成', failed: '执行失败', cancelled: '已取消', timeout:'执行超时', unknown: '结果待核对', pending: '等待结果', settled: '已结束', acknowledged: '已核对', 'rolled-back': '已撤销', idle: '空闲', active: '运行中', stale: '观测已过期', alive: '进程存活', dead: '进程已退出', fresh: '观测正常', unavailable: '暂不可用', 'missing': '未获取到' } as Record<string,string>)[state || ''] || state || '待核对';
}
/** Process exit status alone does not certify project acceptance. */
export function processResultLabel(state:string|undefined) {
  return state==='passed'?'执行成功':operationLabel(state);
}
const timeCopy: Record<string, [string, string]> = {
  checkpoint: ['保存当前代码快照', '记录各仓库当前文件和关联对话位置。之后可以比较或恢复这份代码；不会创建 Git 提交。'],
  'restore-preview': ['查看恢复预览', '比较目标快照与核对基准，检查当前文件是否有冲突。这一步不修改代码。'],
  restore: ['确认恢复代码', '将各仓库文件恢复到所选快照。执行前会再次检查当前文件，发现冲突则停止；恢复后需要重新运行验收。'],
  'code-fork': ['另开代码方案', '在一个新的目录创建独立代码工作区，并从所选快照开始；原目录保留。适合比较另一条实现路线。'],
};
export function presentAction(action: Action): Action {
  if(action.id==='artifact-add')return {...action,fields:action.fields.map(field=>field.name==='kind'?{...field,items:[{value:'document',label:'文档'},{value:'code',label:'代码'},{value:'report',label:'报告'},{value:'screenshot',label:'截图'},{value:'trace',label:'运行轨迹'},{value:'package',label:'压缩包'}]}:field.name==='evidence'?{...field,kind:'multi',source:'checkEvidence',label:'关联当前有效检查（可选）',help:'选择相关检查。保存成果不等于任务验收完成。'}:field.name==='file'?{...field,help:'选择上方仓库后填写相对路径，例如 docs/guide.md。'}:field.name==='runtime'?{...field,help:'与仓库文件二选一；用于本工作区内生成的报告、截图等文件。'}:field)};
  if(action.id==='material-fetch')return {...action,fields:action.fields.map(field=>field.name==='scope'?{...field,label:'飞书读取范围',help:'此选择用于飞书文档。普通网页读取可获取的完整正文，不会登录网页或展开嵌入内容。'}:field)};
  if(action.id==='service-add')return {...action,fields:action.fields.filter(field=>field.name!=='version'||typeof field.value==='string'&&!!field.value)};
  if(action.id==='handoff-export')return {...action,fields:action.fields.map(field=>field.name==='mode'?{...field,label:'交接用途',items:[{value:'background',label:'沿用背景，开始新目标'},{value:'continue',label:'继续原任务'},{value:'alternative',label:'比较另一种方案'}],help:'沿用背景不启动旧计划；继续原任务和比较方案会携带保留的原要求与计划。'}:field)};
  const copy = timeCopy[action.id];
  if (!copy) return action;
  return { ...action, title: copy[0], description: copy[1], fields: action.fields.map((field): Field => {
    if (field.name === 'target' || field.name === 'checkpoint') return { ...field, label: '想回到的代码快照' };
    if (field.name === 'expected') return { ...field, label: '核对当前文件的基准', help: '通常选择最近记录的快照。当前文件必须与它一致，否则会阻止恢复，避免覆盖其他修改。' };
    if (field.name === 'context') return { ...field, label: '同时切回快照关联的对话位置', help: '默认只恢复代码。勾选后还会切换助手上下文，仅支持当前对话内的关联位置。' };
    if (field.name === 'label') return { ...field, label: '快照名称', help: '例如：接口升级前、验证通过后的版本。' };
    return field;
  }) };
}
