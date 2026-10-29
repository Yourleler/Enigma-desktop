import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createBrowserLabRuntime} from './interaction-browser-runtime.mjs';

const runtime = await createBrowserLabRuntime({parent: process.argv[2]});
const {lab, sessionPath, tool} = runtime;
let state = '';
const results = [];
const identity = () => ({tabId: state.match(/Browser tabId \(copy exactly\): "([^"]+)"/)?.[1], snapshotId: state.match(/SnapshotId: ([\w-]+)/)?.[1]});
const ref = label => {
  const row = state.split('\n').find(line => line.includes(`"${label}"`));
  assert(row, `Missing observed control: ${label}`);
  return Number(row.match(/\[(\d+)\]/)[1]);
};
async function call(input, {error = false, signal, errorPattern} = {}) {
  const at = Date.now();
  const response = await tool.execute(`recovery-${results.length}`, input, signal, undefined, {sessionPath, sessionId: 'new-test-session', model: {input: ['text', 'image']}});
  const failed = !!(response.isError || response.details?.error);
  const text = response.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') || '';
  results.push({action: input.action, elapsedMs: Date.now() - at, failed, text});
  console.log(JSON.stringify({step:results.length,action:input.action,elapsedMs:Date.now()-at,failed}));
  assert.equal(failed, error, text);
  if (errorPattern) assert.match(text, errorPattern);
  if (!failed && text.includes('SnapshotId:')) state = text;
  return response;
}

try {
  await call({action: 'navigate', url: lab.url});
  const originalTab = identity().tabId;
  await call({action: 'click', ...identity(), ref: ref('稍后显示输入框')});
  await call({action: 'wait', tabId: originalTab, text: '延迟出现的输入框', timeout: 4000});
  await call({action: 'type', ...identity(), ref: ref('延迟出现的输入框'), text: '第一段'});
  await call({action: 'type', ...identity(), ref: ref('延迟出现的输入框'), text: '，追加中文', mode: 'append'});
  assert(state.includes('第一段，追加中文'));
  const beforeReplacement = {...identity(), ref: ref('保存测试记录')};
  await call({action: 'click', ...identity(), ref: ref('替换操作按钮')});
  await call({action: 'click', ...beforeReplacement}, {error: true, errorPattern: /STALE_SNAPSHOT/});
  await call({action: 'click', ...identity(), ref: ref('清除测试记录')});
  assert(state.includes('清除按钮已点击'));
  await call({action: 'click', ...identity(), ref: ref('打开说明弹窗')});
  await call({action: 'click', ...identity(), ref: ref('固定定位按钮')}, {error: true, errorPattern: /ELEMENT_COVERED/});
  await call({action: 'click', ...identity(), ref: ref('关闭说明')});
  await call({action: 'hover', ...identity(), ref: ref('双击测试区域')});
  assert(state.includes('悬停成功'));
  await call({action:'drag',...identity(),ref:ref('可拖动的测试卡片'),targetRef:ref('把卡片拖到这里')});
  assert(state.includes('拖拽成功'));
  await call({action: 'click', ...identity(), ref: ref('固定定位按钮')});
  assert(state.includes('固定按钮已点击'));
  await call({action: 'click', ...identity(), ref: ref('第二页')});
  assert(state.includes('第二个测试页面'));
  await call({action: 'back', tabId: originalTab});
  assert(state.includes('新建交互验收页'));
  await call({action: 'forward', tabId: originalTab});
  assert(state.includes('第二个测试页面'));
  await call({action: 'reload', tabId: originalTab});
  await call({action: 'new_tab', url: lab.url});
  const temporary = identity().tabId;
  await call({action: 'close_tab', tabId: temporary});
  await call({action: 'snapshot', tabId: originalTab});
  assert(state.includes('第二个测试页面'));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Explicit test cancellation')), 300);
  const started = Date.now();
  try {
    const result = await tool.execute('cancel-navigation', {action: 'navigate', tabId: originalTab, url: lab.url + '/delayed.html'}, controller.signal, undefined, {sessionPath, model: {input: ['text', 'image']}});
    assert(result.isError || result.details?.error);
  } catch (error) { assert(/cancel|abort/i.test(error.message)); }
  finally {clearTimeout(timer);}
  assert(Date.now() - started < 5000, 'Cancelled navigation should not wait for the delayed response');
  await call({action: 'navigate', url: lab.url, tabId: originalTab});
  assert(state.includes('新建交互验收页'));
  fs.writeFileSync(path.join(lab.root, 'recovery-result.json'), JSON.stringify({passed: true, results, scope: 'Real plugin/manager/browser actions, no model or production app UI'}, null, 2));
  console.log(JSON.stringify({passed: true, steps: results.length, root: lab.root}));
} catch(error) {
  fs.writeFileSync(path.join(lab.root, 'recovery-result.json'), JSON.stringify({passed: false, error: error.message, results}, null, 2));
  console.error(JSON.stringify({passed: false, root: lab.root, error: error.message}));process.exitCode = 1;
} finally {await runtime.close();}
