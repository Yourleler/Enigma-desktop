import { homedir as userHomeDirectory } from 'node:os';
// Explicit real-model browser acceptance of the actual workbench.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { Workbench } from '../dist/src/workbench.js';
import { ServiceManager } from '../dist/src/services.js';
import { redact } from '../dist/src/storage.js';
import { validationBuild } from './validation-evidence.mjs';
const priorPath = resolve(process.argv[3] ?? userHomeDirectory() + '/Documents/Codex/2026-10-25/enigma-next-validation/full-workflow/report.json');
const prior = JSON.parse(await readFile(priorPath, 'utf8')); assert.equal(prior.status, 'verified', 'Workbench acceptance requires a verified source workflow');
const build = await validationBuild(['gateway-workbench-ui.mjs', 'validation-evidence.mjs']);
const output = resolve(process.argv[2] ?? userHomeDirectory() + '/Documents/Codex/2026-10-25/enigma-next-validation/workbench-ui'); await mkdir(output, { recursive: true });
const host = await Workbench.open(prior.workspace, { agentDir: join(prior.workspace, '.enigma-next', 'pi-agent'), provider: 'gateway', model: prior.model, approval: 'ask', memory: true });
const endpoint = await host.listen(), browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], dialogs = []; page.on('pageerror', error => errors.push(error.message)); let report;
try {
  await page.goto(endpoint.url); await page.getByRole('button', { name: '＋ 新对话' }).click(); await page.locator('#new-title').fill('真实多仓库工作台验收');
  const [created] = await Promise.all([page.waitForResponse(response => response.url().endsWith('/api/chats') && response.request().method() === 'POST'), page.getByRole('button', { name: '创建对话' }).click()]);
  assert(created.ok(), await created.text()); const chat = await created.json();
  await page.getByRole('heading', { name: '真实多仓库工作台验收' }).waitFor();
  const message = '三个仓库已经迁移为 v2。请回读实际 Python API、JS SDK、JS app 和原检查，不修改任何源码或标准。使用现有 serve-accept 配方启动/重启既有服务，真实 browser_validate greeting-ui，再执行全部 workspace_verify。报告实际 app:v2 的浏览器结果与证据。只使用现有工作区工具，获准的操作请等待界面审批。';
  await page.getByRole('textbox', { name: '任务消息' }).fill(message); await page.getByRole('button', { name: '发送', exact: true }).click();
  const deadline = Date.now() + 300000; let completed = false;
  while (Date.now() < deadline) {
    if (await page.locator('#approval-root [role="dialog"]').count()) { dialogs.push(await page.locator('#approval-root h2').innerText()); await page.getByRole('button', { name: '批准', exact: true }).click(); }
    const controller = host.sessions.get(chat.id);
    if (controller?.chat.started && controller.runtime.session.isIdle && page && controller.snapshot().messages.some(message => message.role === 'assistant' && message.text.includes('v2'))) { completed = true; break; }
    await page.waitForTimeout(100);
  }
  assert(completed, 'Real UI model run did not settle'); assert(dialogs.length, 'Actual host actions must require browser approvals'); assert.deepEqual(errors, []);
  const controller = host.sessions.get(chat.id); assert(controller); const workspace = controller.options.workspace, verification = await workspace.exclusive(() => workspace.verify()); assert.equal(verification.status, 'verified');
  await page.reload(); await page.getByRole('heading', { name: '真实多仓库工作台验收' }).waitFor(); await page.getByRole('button', { name: '产物', exact: true }).click(); await page.locator('#panel img').first().waitFor({ timeout: 30000 });
  const screenshot = join(output, 'workbench.png'); await page.screenshot({ path: screenshot, fullPage: true });
  await page.getByRole('button', { name: '代码地图', exact: true }).click(); await page.screenshot({ path: join(output, 'maps.png'), fullPage: true });
  await page.getByRole('button', { name: '项目', exact: true }).click(); await page.getByText('Python API', { exact: true }).first().waitFor();
  report = { status: 'verified', build, sourceWorkflow: priorPath, workspace: workspace.root, model: prior.model, dialogs, errors, verification, chat: controller.chat, messages: controller.snapshot().messages, screenshot, sessionFile: controller.chat.sessionFile, scope: 'Real workbench/browser/Pi model approvals, original checks, reconnect and saved artifacts; final platform/release audit still required' };
} catch (error) { report = { status: 'failed', build, sourceWorkflow: priorPath, workspace: prior.workspace, errors, dialogs, error: String(error), states: [...host.sessions.values()].map(controller => controller.snapshot()) }; process.exitCode = 1; }
finally { await browser.close(); await host.close(); const workspace = host.workspace; await new ServiceManager(workspace).stop('web').catch(() => {}); await new ServiceManager(workspace).stop('api').catch(() => {}); await writeFile(join(output, 'report.json'), redact(JSON.stringify(report, null, 2), workspace.secrets)); console.log(JSON.stringify({ status: report.status, report: join(output, 'report.json') })); }
