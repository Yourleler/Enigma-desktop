import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fixture } from './fixtures.js';
import { readSchemas } from '../src/schema-reading.js';
import { declaredContracts } from '../src/contracts.js';
import { repoGraph } from '../src/reading.js';

test('Thrift and protobuf source reading keeps exact field anchors and scoped type relations', async () => {
  const { root, workspace } = await fixture();
  try {
    await writeFile(join(root, 'library', 'shared.thrift'), 'namespace go shared\nstruct Message {1: required string text}\n');
    await writeFile(join(root, 'library', 'api.thrift'), 'include "shared.thrift"\nservice API {shared.Message greet(1: string name)}\n');
    await writeFile(join(root, 'sdk', 'message.proto'), 'syntax="proto3";\npackage sample;\nmessage Message { string foo_bar = 1; }\nmessage Outer { message Message { int32 code = 1; } Message local = 1; .sample.Message other = 2; }\n');
    const schema = await readSchemas(workspace);
    const api = schema.definitions.find(definition => definition.name === 'API')!;
    assert(api.members.some(member => member.name === 'greet' && member.source.line === 2));
    assert(schema.relations.some(edge => edge.from === api.id && edge.to === 'library:shared.thrift:Message'));
    const message = schema.definitions.find(definition => definition.qualified === 'sample.Message')!;
    assert.equal(message.members[0]?.name, 'foo_bar'); assert.equal(message.members[0]?.source.line, 3);
    const outer = schema.definitions.find(definition => definition.qualified === 'sample.Outer')!;
    assert(schema.relations.some(edge => edge.from === outer.id && edge.to === 'sdk:message.proto:sample.Outer.Message' && edge.source.symbol === 'local'));
    assert(schema.relations.some(edge => edge.from === outer.id && edge.to === message.id && edge.source.symbol === 'other'));
    assert.equal(schema.diagnostics.length, 0, JSON.stringify(schema.diagnostics));
    const evidence = await workspace.exclusive(() => workspace.evidence('reading', schema));
    await writeFile(join(root, 'library', 'shared.thrift'), 'struct Message {1: required i32 text}\n');
    assert.equal((await workspace.evidenceStatus(evidence.id)).valid, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('JSON schema references and declared configuration contracts retain real sources and checks', async () => {
  const { root, workspace } = await fixture();
  try {
    await writeFile(join(root, 'library', 'api.json'), JSON.stringify({ components: { schemas: { Message: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } }, Envelope: { type: 'object', properties: { data: { $ref: '#/components/schemas/Message' } } } } } }, null, 2));
    await writeFile(join(root, 'library', '.enigma-contracts.json'), JSON.stringify({ schema: 1, contracts: [{ id: 'message-model', kind: 'schema', name: 'Message', producer: { repo: 'library', file: 'api.json' }, consumers: [{ repo: 'sdk', file: 'index.js' }], checks: [] }, { id: 'runtime-setting', kind: 'configuration', name: 'API_BASE', producer: { repo: 'sdk', file: 'package.json' }, consumers: [{ repo: 'app', file: 'index.js' }], checks: [] }] }));
    const schema = await readSchemas(workspace);
    const message = schema.definitions.find(definition => definition.name === 'Message')!, envelope = schema.definitions.find(definition => definition.name === 'Envelope')!;
    assert(message.members.some(member => member.name === 'text' && member.required));
    assert(schema.relations.some(edge => edge.from === envelope.id && edge.to === message.id));
    const declared = await declaredContracts(workspace); assert.equal(declared.length, 2); assert.equal(declared[1]?.kind, 'configuration');
    assert((await repoGraph(workspace)).edges.some(edge => edge.from === 'sdk' && edge.to === 'library' && edge.reason === 'declared contract: message-model'));
    await writeFile(join(root, 'sdk', 'invalid.proto'), 'message Bad { invalid syntax');
    assert((await readSchemas(workspace)).diagnostics.some(message => message.includes('invalid.proto')));
  } finally { await rm(root, { recursive: true, force: true }); }
});
