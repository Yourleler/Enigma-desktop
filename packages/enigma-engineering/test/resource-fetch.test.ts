import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fixture } from './fixtures.js';
import { fetchResource, readResourceCapture, refreshResource } from '../src/resource-fetch.js';
import { ProjectContext } from '../src/project-context.js';
import { writeJson } from '../src/storage.js';

test('HTTP source capture preserves readable content and enforces redirects, budgets and cancellation', async () => {
  const { root, workspace } = await fixture(); let pending: (() => void) | undefined;
  const server = createServer((request, response) => {
    if (request.url === '/private') { response.writeHead(302, { location: 'http://127.0.0.2/private' }); response.end(); return; }
    if (request.url === '/large') { response.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' }); response.end(gzipSync('a'.repeat(1_000_001))); return; }
    if (request.url === '/slow') { pending?.(); return; }
    response.writeHead(200, { 'content-type': 'text/html', etag: '"v1"' }); response.end('<html><head><title>Project docs</title></head><body><h1>API</h1><p>Current contract.</p><script>unexpected()</script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string'); const uri = `http://127.0.0.1:${address.port}`;
  try {
    await assert.rejects(fetchResource(workspace, uri), /explicit operator trust/);
    await writeJson(join(workspace.data, 'fetch-config.json'), { schema: 1, trustedHosts: ['127.0.0.1'] });
    const document = await fetchResource(workspace, uri); assert.equal(document.title, 'Project docs'); assert(document.content?.includes('# API')); assert(!document.content?.includes('unexpected()'));
    assert(document.source.kind === 'imported' && document.source.capture);
    const raw = await readResourceCapture(workspace, document.source.capture.raw) as { content: string };
    assert(raw.content.includes('<script>'));
    await assert.rejects(fetchResource(workspace, uri + '/private'), /explicit operator trust/);
    await assert.rejects(fetchResource(workspace, uri + '/large'), /budget/);
    const controller = new AbortController(); pending = () => controller.abort();
    await assert.rejects(fetchResource(workspace, uri + '/slow', { signal: controller.signal }), /cancelled/);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});

test('Lark source capture retains exact selection, revision and comments sidecar across refresh', async () => {
  const { root, workspace } = await fixture();
  try {
    const script = join(root, 'lark-fixture.mjs'), response = join(root, 'document.json');
    await writeFile(script, 'import{readFile}from"node:fs/promises";const args=process.argv.slice(2);if(!args.includes("user")||!args.includes("keyword")||!args.includes("memory"))throw new Error("Missing selection");process.stdout.write(await readFile(new URL("./document.json",import.meta.url),"utf8"));');
    const write = async (version: number) => writeJson(response, { ok: true, identity: 'user', data: { document: { revision_id: version, content: `# Selected memory\nVersion ${version}`, reference_map: { comments: { c1: { data: 'source comment' } } } } } });
    await write(1);
    const options = { scope: 'keyword' as const, keyword: 'memory', larkCommand: [process.execPath, script] };
    const fetched = await fetchResource(workspace, 'https://example.larkoffice.com/docx/doc-token', options);
    assert(fetched.source.kind === 'imported' && fetched.source.capture); assert.equal(fetched.source.capture.version, '1'); assert.equal(fetched.source.capture.scope, 'keyword');
    const raw = await readResourceCapture(workspace, fetched.source.capture.raw) as { data: { document: { reference_map: object } } };
    assert(raw.data.document.reference_map);
    const project = new ProjectContext(workspace), resource = await project.add(fetched);
    await write(2);
    const refreshed = await refreshResource(workspace, resource.id, { larkCommand: options.larkCommand });
    assert.equal(refreshed.revision, 2); assert(refreshed.source.kind === 'imported' && refreshed.source.capture?.version === '2');
    assert((await project.read(resource.id)).content.includes('Version 2')); assert.equal((await project.read(resource.id)).current, null);
    await writeJson(response, { ok: false, error: { code: 'missing_scope' } });
    await assert.rejects(fetchResource(workspace, 'https://example.larkoffice.com/docx/doc-token', options), /identity\/scopes/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
