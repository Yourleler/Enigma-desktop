import { Hono } from 'hono';
import { expect, it } from 'vitest';
import { createUsageRoute } from '../server/routes/usage';
import { createUsageLedger } from '../lib/llm/usage-ledger';
import { authorizeHttpRoute } from '../server/http/route-security';

it('restricts history retention to the studio owner and requires write access', async () => {
  expect(authorizeHttpRoute({ method: 'PUT', path: '/api/usage/retention', principal: { kind: 'device', credentialKind: 'device_credential', connectionKind: 'lan', scopes: ['settings.write'] } }).allowed).toBe(false);
  const ledger = createUsageLedger();
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('authPrincipal' as never, { kind: 'device', scopes: ['settings.read'] } as never); await next(); });
  app.route('/', createUsageRoute({ usageLedger: ledger }));
  const res = await app.request('/usage/retention', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ maximum: 10000 }) });
  expect(res.status).toBe(403); expect(ledger.coverage().maximum).toBe(5000);
});

it('validates and updates retention and makes the active cap visible to summary queries', async () => {
  const app = createUsageRoute({ usageLedger: createUsageLedger() });
  expect((await (await app.request('/usage/retention')).json()).maximum).toBe(5000);
  for (const maximum of ['100', 0, 10.5, null, 100001]) {
    expect((await app.request('/usage/retention', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ maximum }) })).status).toBe(400);
  }
  const res = await app.request('/usage/retention', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ maximum: 10000 }) });
  expect(res.status).toBe(200);
  expect((await (await app.request('/usage/summary')).json()).coverage.maximum).toBe(10000);
});
