import { expect, it, vi } from 'vitest';
import { exchangeLocalWorkbenchCredential } from '../../mobile/local-workbench-login';

it('removes the local credential before exchanging it through normal browser auth', async () => {
  const calls: string[] = [];
  const replaceState = vi.fn(() => { calls.push('remove-fragment'); });
  const fetchImpl = vi.fn(async () => { calls.push('authenticate'); return { ok: true }; });
  await exchangeLocalWorkbenchCredential({
    location: { href: 'http://127.0.0.1:38392/desktop/#enigma-local-key=test-secret&panel=code' },
    history: { state: null, replaceState }, fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  expect(calls).toEqual(['remove-fragment', 'authenticate']);
  expect(replaceState).toHaveBeenCalledWith(null, '', '/desktop/#panel=code');
  expect(fetchImpl).toHaveBeenCalledWith('/api/web-auth/login', expect.objectContaining({
    method: 'POST', credentials: 'same-origin', body: JSON.stringify({ credential: 'test-secret' }),
  }));
});

it('never sends a local credential to a remote page or a different surface', async () => {
  for (const href of ['https://example.com/desktop/#enigma-local-key=secret', 'http://localhost/mobile/#enigma-local-key=secret']) {
    const fetchImpl = vi.fn(), replaceState = vi.fn();
    await expect(exchangeLocalWorkbenchCredential({ location: { href }, history: { state: null, replaceState }, fetchImpl })).rejects.toThrow('本机');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(replaceState).toHaveBeenCalledOnce();
  }
});

it('does not log in without a launcher credential, and reports rejected credentials without including them', async () => {
  const fetchImpl = vi.fn(async () => ({ ok: false }));
  const history = { state: null, replaceState: vi.fn() };
  await exchangeLocalWorkbenchCredential({ location: { href: 'http://localhost/desktop/' }, history, fetchImpl: fetchImpl as unknown as typeof fetch });
  expect(fetchImpl).not.toHaveBeenCalled();
  await expect(exchangeLocalWorkbenchCredential({ location: { href: 'http://localhost/desktop/#enigma-local-key=test-secret' }, history, fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow('enigma:open');
});
