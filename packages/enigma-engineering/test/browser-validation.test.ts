import assert from 'node:assert/strict';
import { rm, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fixture } from './fixtures.js';
import { ServiceManager } from '../src/services.js';
import { BrowserValidation } from '../src/browser-validation.js';

test('real browser completes repository UI actions and retains screenshots/trace tied to source and scenario versions', { timeout: 60_000 }, async () => {
  const { root, workspace } = await fixture(), services = new ServiceManager(workspace), browser = new BrowserValidation(workspace);
  try {
    await writeFile(join(root, 'app', 'web.mjs'), 'import{createServer}from"node:http";const html=`<input id="name"><button id="go">Go</button><div id="out"></div><script>document.querySelector("#go").onclick=()=>document.querySelector("#out").textContent="hello:"+document.querySelector("#name").value</script>`;const s=createServer((q,r)=>{r.setHeader("Content-Type","text/html");r.end(html)});s.listen(0,"127.0.0.1",()=>console.log("READY: "+s.address().port));');
    await services.add({ id: 'web', repo: 'app', label: 'web', argv: [process.execPath, 'web.mjs'], portPrefix: 'READY: ', readiness: { type: 'http', includes: 'input' } });
    assert((await services.start('web')).ready);
    const scenario = { id: 'greeting-ui', label: 'Greeting UI', service: 'web', steps: [{ action: 'fill' as const, selector: '#name', value: 'Enigma' }, { action: 'click' as const, selector: '#go' }, { action: 'expect' as const, selector: '#out', includes: 'hello:Enigma' }, { action: 'screenshot' as const, label: 'result' }] };
    await browser.add(scenario);
    const report = await browser.run(scenario.id); assert.equal(report.status, 'passed', JSON.stringify(report));
    assert(report.trace && (await stat(report.trace)).size > 0); assert.equal(report.screenshots.length, 1); assert((await stat(report.screenshots[0]!)).size > 0);
    assert((await browser.read(report.id)).sourceCurrent);
    await browser.add({ ...scenario, label: 'Changed scenario' }); assert.equal((await browser.read(report.id)).configurationCurrent, false);
    await writeFile(join(root, 'app', 'note.md'), 'New source context'); assert.equal((await browser.read(report.id)).sourceCurrent, false);
    await browser.add({ id: 'wrong', label: 'Wrong behavior', service: 'web', steps: [{ action: 'expect', selector: '#out', includes: 'impossible' }], timeoutMs: 12000 });
    await services.restart('web');
    const failed = await browser.run('wrong'); assert.equal(failed.status, 'failed'); assert(failed.trace);
  } finally { await services.stop('web').catch(() => {}); await rm(root, { recursive: true, force: true }); }
});
