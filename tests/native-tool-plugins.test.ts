import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventBus } from '../hub/event-bus.ts';
import { PluginManager } from '../core/plugin-manager.ts';

let root: string, builtin: string, community: string, disabled: string[];
const managers: PluginManager[] = [];
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'enigma-native-plugins-'));
  builtin = path.join(root, 'builtin'); community = path.join(root, 'community');
  fs.mkdirSync(builtin); fs.mkdirSync(community); disabled = [];
});
afterEach(async () => {
  for (const pm of managers.splice(0)) for (const entry of pm.listPlugins()) await pm.unloadPlugin(entry.id, { pluginKey: entry.pluginKey });
  fs.rmSync(root, { recursive: true, force: true });
});

function writePlugin(directory: string, id: string, extra: Record<string, unknown> = {}) {
  const folder = path.join(directory, id); fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({ id, version: '1.0.0', trust: 'full-access', userToggleable: true,
    contributes: { nativeTools: { browser: 'browser.js' } }, ...extra }));
  fs.writeFileSync(path.join(folder, 'browser.js'), `export default () => ({
    name: 'browser', parameters: {type:'object'},
    sessionPermission: {resolveInvocation: () => ({action:'snapshot',kind:'read',capability:'browser.snapshot'})},
    async execute(_id, input, signal, _update, ctx) {
      if (input.wait) return new Promise(resolve => signal.addEventListener('abort', () => resolve({cancelled:true}), {once:true}));
      return {content:[{type:'text',text:'ok'}],details:{sessionId:ctx?.sessionId}};
    }
  });`);
  return folder;
}
async function load() {
  const pm = new PluginManager({ pluginsDirs: [builtin, community], dataDir: path.join(root, 'data'), bus: new EventBus(), appVersion: '1.0.0',
    preferencesManager: { getDisabledPlugins: () => disabled, setDisabledPlugins: (next: string[]) => { disabled = next; }, getAllowFullAccessPlugins: () => true } } as any);
  managers.push(pm); pm.scan(); await pm.loadAll(); return pm;
}

it('preserves native policy and session context while revoking tools already held by older sessions', async () => {
  writePlugin(builtin, 'browser-control'); const pm = await load();
  const contribution = pm.getNativeToolContribution('browser');
  const tool = pm.createNativeTool(contribution, []);
  expect(tool.name).toBe('browser');
  expect(tool.sessionPermission.resolveInvocation({})).toMatchObject({kind:'read',capability:'browser.snapshot'});
  expect(await tool.execute('a', {}, undefined, undefined, {sessionId:'test-session'})).toMatchObject({details:{sessionId:'test-session'}});
  await pm.disablePlugin('browser-control', {source:'builtin'});
  expect(pm.getNativeToolContribution('browser')).toBeNull();
  expect(tool.isEnabledForAgentConfig()).toBe(false);
  expect(await tool.execute('b', {})).toMatchObject({isError:true,details:{errorCode:'INTERACTION_PLUGIN_DISABLED'}});
  expect(disabled).toEqual(['builtin:browser-control']);
});

it('aborts active work on unload and creates a new usable contribution on re-enable', async () => {
  writePlugin(builtin, 'browser-control'); const pm = await load();
  const old = pm.getNativeToolContribution('browser'); const tool = pm.createNativeTool(old, []);
  const work = tool.execute('wait', {wait:true});
  await pm.disablePlugin('browser-control', {source:'builtin'});
  expect(await work).toEqual({cancelled:true});
  await pm.enablePlugin('browser-control', {source:'builtin'});
  const fresh = pm.getNativeToolContribution('browser'); expect(fresh).not.toBe(old);
  expect((await pm.createNativeTool(fresh, []).execute('new', {})).content[0].text).toBe('ok');
  expect((await tool.execute('old', {})).content[0].text).toBe('ok');
  expect(disabled).toEqual([]);
  const resumedWork = tool.execute('old-wait', {wait:true});
  await pm.disablePlugin('browser-control', {source:'builtin'});
  expect(await resumedWork).toEqual({cancelled:true});
});

it('does not reactivate an old session tool after its plugin factory has changed', async () => {
  const folder = writePlugin(builtin, 'browser-control'); const pm = await load();
  const old = pm.createNativeTool(pm.getNativeToolContribution('browser'), []);
  await pm.disablePlugin('browser-control', {source:'builtin'});
  fs.appendFileSync(path.join(folder,'browser.js'), '\n// new factory version\n');
  await pm.enablePlugin('browser-control', {source:'builtin'});
  expect((await old.execute('stale', {})).isError).toBe(true);
  expect(pm.createNativeTool(pm.getNativeToolContribution('browser'), []).isEnabledForAgentConfig()).toBe(true);
});

it('restores source-qualified disabled preferences without making mandatory builtins optional', async () => {
  writePlugin(builtin, 'browser-control'); writePlugin(builtin, 'required-core', {userToggleable:false,contributes:{}});
  disabled = ['builtin:browser-control']; const pm = await load();
  expect(pm.getPlugin('browser-control',{source:'builtin'}).status).toBe('disabled');
  expect(pm.getPlugin('required-core',{source:'builtin'}).status).toBe('loaded');
  await expect(pm.disablePlugin('required-core',{source:'builtin'})).rejects.toThrow('cannot be disabled');
  await pm.enablePlugin('browser-control',{source:'builtin'});
  expect(pm.getNativeToolContribution('browser')).not.toBeNull();
});

it('rejects external native factories and community attempts to override host tools', async () => {
  const folder = writePlugin(builtin, 'escaping', {contributes:{nativeTools:{computer:'../outside.js'}}});
  fs.writeFileSync(path.join(folder, '../outside.js'), 'export default () => ({name:"computer",execute(){}})');
  writePlugin(community, 'community-control'); const pm = await load();
  expect(pm.getPlugin('escaping',{source:'builtin'}).status).toBe('failed');
  expect(pm.getPlugin('community-control',{source:'community'}).status).toBe('failed');
  expect(pm.getNativeToolContribution('computer')).toBeNull();
  expect(pm.getNativeToolContribution('browser')).toBeNull();
});

it('loads shipped plugins without a second application source tree and uses the supplied host', async () => {
  for (const id of ['browser-control', 'computer-control']) fs.cpSync(path.join(process.cwd(), 'plugins', id), path.join(builtin, id), {recursive:true});
  const pm = await load();
  const browserFactory = vi.fn(() => ({name:'browser', execute: async () => ({content:[{type:'text',text:'same host transport'}]})}));
  const computerFactory = vi.fn(() => ({name:'computer', execute: async () => ({content:[{type:'text',text:'same computer host'}]})}));
  const getSessionPath = () => '/new/session';
  const browser = pm.createNativeTool(pm.getNativeToolContribution('browser'), [getSessionPath, {test:true}], {createBrowserTool:browserFactory});
  const computer = pm.createNativeTool(pm.getNativeToolContribution('computer'), [{test:true}], {createComputerUseTool:computerFactory});
  expect(browserFactory).toHaveBeenCalledWith(getSessionPath, {test:true});
  expect(computerFactory).toHaveBeenCalledWith({test:true});
  expect((await browser.execute('read', {})).content[0].text).toBe('same host transport');
  await pm.disablePlugin('browser-control', {source:'builtin'});
  expect((await browser.execute('stopped', {})).isError).toBe(true);
  expect((await computer.execute('read', {})).content[0].text).toBe('same computer host');
});
