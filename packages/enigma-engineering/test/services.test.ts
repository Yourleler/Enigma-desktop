import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fixture } from './fixtures.js';
import { ServiceManager } from '../src/services.js';
import { BrowserValidation } from '../src/browser-validation.js';

test('running services cannot validate changed code using an older loaded program', { timeout: 60_000 }, async () => {
  const { root, workspace } = await fixture(), services = new ServiceManager(workspace), file = join(root, 'app', 'version.mjs');
  const program = (version: string) => `import{createServer}from"node:http";const s=createServer((q,r)=>r.end("<div id='result'>${version}</div>"));s.listen(0,"127.0.0.1",()=>console.log("READY: "+s.address().port));`;
  try {
    await writeFile(file, program('v1')); await services.add({ id: 'version', repo: 'app', label: 'versioned application', argv: [process.execPath, 'version.mjs'], portPrefix: 'READY: ', readiness: { type: 'http', includes: 'result' } });
    const initial = await services.start('version'); assert(initial.ready && initial.url); assert((await (await fetch(initial.url)).text()).includes('v1'));
    await new BrowserValidation(workspace).add({ id: 'version', label: 'v2 behavior', service: 'version', steps: [{ action: 'expect', selector: '#result', includes: 'v2' }] });
    await writeFile(file, program('v2')); const stale = await services.status('version'); assert.equal(stale.status, 'source-changed'); assert.equal(stale.ready, false);
    assert((await (await fetch(initial.url)).text()).includes('v1'), 'Actual old process must still serve v1');
    await assert.rejects(new BrowserValidation(workspace).run('version'), /ready owned/); await assert.rejects(services.start('version'), /重启/);
    const restarted = await services.restart('version'); assert(restarted.ready); assert.equal((await new BrowserValidation(workspace).run('version')).status, 'passed');
  } finally { await services.stop('version').catch(() => {}); await rm(root, { recursive: true, force: true }); }
});

test('dependent repository services become ready, communicate over real HTTP, restart and stop owned processes', { timeout: 60_000 }, async () => {
  const { root, workspace } = await fixture(), services = new ServiceManager(workspace);
  try {
    await writeFile(join(root, 'library', 'server.mjs'), 'import{createServer}from"node:http";const s=createServer((q,r)=>r.end("v1"));s.listen(0,"127.0.0.1",()=>console.log("READY: "+s.address().port));');
    await writeFile(join(root, 'app', 'server.mjs'), 'import{createServer}from"node:http";const s=createServer(async(q,r)=>{r.end("app:"+await(await fetch(process.env.API_URL)).text())});s.listen(0,"127.0.0.1",()=>console.log("READY: "+s.address().port));');
    await services.add({ id: 'backend', repo: 'library', label: 'backend', argv: [process.execPath, 'server.mjs'], portPrefix: 'READY: ', readiness: { type: 'http', includes: 'v1' } });
    await services.add({ id: 'frontend', repo: 'app', label: 'frontend', argv: [process.execPath, 'server.mjs'], portPrefix: 'READY: ', dependsOn: ['backend'], envFromServices: { API_URL: { service: 'backend', value: 'url' } }, readiness: { type: 'http', includes: 'app:v1' } });
    const ready = await services.start('frontend'); assert(ready.ready, JSON.stringify(ready)); assert('url' in ready && ready.url);
    assert.equal(await (await fetch(ready.url)).text(), 'app:v1');
    await workspace.exclusive(() => workspace.checkpoint('services active'));
    const prior = (await services.status('backend')).run;
    const restarted = await services.restart('backend'); assert(restarted.ready); assert('run' in restarted && restarted.run !== prior);
    assert.equal((await services.status('frontend')).status, 'dependency-changed');
    const frontAgain = await services.restart('frontend'); assert(frontAgain.ready); assert('url' in frontAgain && frontAgain.url);
    assert.equal(await (await fetch(frontAgain.url)).text(), 'app:v1');
    await services.stop('frontend'); await services.stop('backend');
    assert.equal((await services.status('backend')).ready, false);
  } finally { await services.stop('frontend').catch(() => {}); await services.stop('backend').catch(() => {}); await rm(root, { recursive: true, force: true }); }
});

test('occupied ports and unhealthy readiness never stop an existing user process or imply readiness', async () => {
  const { root, workspace } = await fixture(), services = new ServiceManager(workspace), existing = createServer((_request, response) => response.end('user process'));
  await new Promise<void>(resolve => existing.listen(0, '127.0.0.1', resolve)); const address = existing.address(); assert(address && typeof address !== 'string');
  try {
    await services.add({ id: 'occupied', repo: 'app', label: 'occupied', argv: [process.execPath, '-e', 'setInterval(()=>{},1000)'], readiness: { type: 'http', port: address.port } });
    await assert.rejects(services.start('occupied'), /occupied/);
    assert.equal(await (await fetch(`http://127.0.0.1:${address.port}`)).text(), 'user process');
    await services.add({ id: 'no-ready', repo: 'sdk', label: 'unhealthy', argv: [process.execPath, '-e', 'console.log("nothing");setInterval(()=>{},1000)'], readiness: { type: 'log', includes: 'not-present', timeoutMs: 300 } });
    const waiting = await services.start('no-ready'); assert.equal(waiting.status, 'readiness-timeout'); assert.equal(waiting.ready, false);
    await services.stop('no-ready');
  } finally { await services.stop('no-ready').catch(() => {}); existing.closeAllConnections(); await new Promise<void>(resolve => existing.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});
