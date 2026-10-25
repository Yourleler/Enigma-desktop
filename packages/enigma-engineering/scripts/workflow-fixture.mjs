import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { crossLanguageFixture } from '../dist/test/cross-language-fixtures.js';
import { ServiceManager } from '../dist/src/services.js';
import { BrowserValidation } from '../dist/src/browser-validation.js';
import { RecipeStore } from '../dist/src/recipes.js';
import { ProjectContext } from '../dist/src/project-context.js';
import { configureSkillPaths } from '../dist/src/skill-discovery.js';

export async function workflowFixture() {
  const { root, workspace } = await crossLanguageFixture(), python = process.env.ENIGMA_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
  await workspace.exclusive(() => workspace.setDependencies('sdk', ['server'])); await workspace.exclusive(() => workspace.setDependencies('app', ['sdk']));
  const serverPath = join(root, 'server', 'server.py'); await writeFile(serverPath, (await readFile(serverPath, 'utf8')).replace('print(server.server_address[1], flush=True)', 'print("READY: " + str(server.server_address[1]), flush=True)'));
  await writeFile(join(root, 'app', 'USER.md'), 'USER-OWNED-WORKFLOW-9142\n');
  await writeFile(join(root, 'server', 'DESIGN.md'), '# API 迁移要求\nGET /greet 返回 {"data":{"message":"v2"}}。SDK getGreeting 读取 data.message；应用 display 返回 app:v2。公共函数名称保留，三仓库同步修改。原验收、服务启动、网页、用户文件都不能被改写。\n');
  await writeFile(join(root, 'server', 'response.schema.json'), JSON.stringify({ title: 'GreetingResponseV2', type: 'object', required: ['data'], properties: { data: { type: 'object', required: ['message'], properties: { message: { type: 'string', const: 'v2' } } } } }));
  await writeFile(join(root, 'app', 'web.mjs'), 'import{createServer}from"node:http";import{display}from"./index.js";const html=`<button id="go">Load</button><div id="out"></div><script>document.querySelector("#go").onclick=async()=>document.querySelector("#out").textContent=await(await fetch("/value")).text()</script>`;const s=createServer(async(q,r)=>{try{r.setHeader("Content-Type",q.url==="/value"?"text/plain":"text/html");r.end(q.url==="/value"?await display(process.env.API_URL):html)}catch(e){r.statusCode=500;r.end(String(e))}});s.listen(0,"127.0.0.1",()=>console.log("READY: "+s.address().port));');
  const services = new ServiceManager(workspace);
  await services.add({ id: 'api', repo: 'server', label: 'Python API', argv: [python, '-u', 'server.py'], portPrefix: 'READY: ', readiness: { type: 'http', path: '/greet', includes: 'message' } });
  await services.add({ id: 'web', repo: 'app', label: 'JS web', argv: [process.execPath, 'web.mjs'], dependsOn: ['api'], envFromServices: { API_URL: { service: 'api', value: 'url' } }, portPrefix: 'READY: ', readiness: { type: 'http', includes: 'button' } });
  await new BrowserValidation(workspace).add({ id: 'greeting-ui', label: 'User button flow', service: 'web', steps: [{ action: 'click', selector: '#go' }, { action: 'expect', selector: '#out', includes: 'app:v2' }, { action: 'screenshot', label: 'result' }] });
  const httpCheck = `const {spawn}=await import('node:child_process');const {setTimeout:delay}=await import('node:timers/promises');const child=spawn(${JSON.stringify(python)},['-u','server.py'],{cwd:'../server',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore','pipe','pipe']});let output='',ended=false;child.stdout.on('data',b=>output+=b);const exit=new Promise(r=>child.once('close',()=>{ended=true;r()}));try{const until=Date.now()+15000;while(!/READY: (\\d+)/.test(output)&&!ended&&Date.now()<until)await delay(20);const port=Number(/READY: (\\d+)/.exec(output)?.[1]);if(!port)throw Error('API did not become ready');const{display}=await import('./index.js');const value=await display('http://127.0.0.1:'+port);console.log(value);if(value!=='app:v2')throw Error('Actual HTTP contract mismatch: '+value)}finally{child.kill('SIGTERM');await exit}`;
  await workspace.exclusive(async () => {
    await workspace.addCheck({ id: 'python-syntax', repo: 'server', argv: [python, '-I', '-c', 'import ast,pathlib;ast.parse(pathlib.Path("model.py").read_text())'] });
    await workspace.addCheck({ id: 'sdk-syntax', repo: 'sdk', argv: [process.execPath, '--check', 'index.js'] });
    await workspace.addCheck({ id: 'app-syntax', repo: 'app', argv: [process.execPath, '--check', 'index.js'] });
    await workspace.addCheck({ id: 'http-joint', repo: 'app', joint: true, argv: [process.execPath, '--input-type=module', '-e', httpCheck], timeoutMs: 25000 });
    await workspace.addCheck({ id: 'browser-joint', repo: 'app', joint: true, argv: [process.execPath, resolve('dist/src/cli.js'), '--workspace', root, 'browser', 'run', 'greeting-ui'], timeoutMs: 30000 });
  });
  await new RecipeStore(workspace).save({ id: 'serve-accept', label: 'Serve and accept actual user flow', timeoutMs: 120000, steps: [{ id: 'start', kind: 'service', service: 'web', action: 'start' }, { id: 'browser', kind: 'browser', scenario: 'greeting-ui' }, { id: 'acceptance', kind: 'verify' }] });
  const material = await new ProjectContext(workspace).add({ title: 'API migration requirements', repos: ['server', 'sdk', 'app'], source: { kind: 'file', repo: 'server', file: 'DESIGN.md' } });
  const skill = join(root, 'skills', 'SKILL.md'); await mkdir(join(root, 'skills')); await writeFile(skill, '---\nname: migration-workflow\ndescription: 多仓库 API 迁移、源码地图、方案比较与真实浏览器验收\n---\nRead requirements, schema and source-backed task map. Preserve server.py, web.mjs, USER.md and original checks. Prepare independent code approaches, compare common checks, merge with fresh parent checks. Start or restart configured services for the resulting code, run the real browser scenario and the original complete checks. Keep source results separate from acceptance.\n'); await configureSkillPaths(workspace, [skill]);
  return { root, workspace, services, material, commonChecks: ['python-syntax', 'sdk-syntax', 'app-syntax', 'http-joint'] };
}
