/** A local launcher hands the existing credential to the browser; normal server auth still applies. */
export async function exchangeLocalWorkbenchCredential({
  location = window.location,
  history = window.history,
  fetchImpl = fetch,
}: {
  location?: Pick<Location, 'href'>;
  history?: Pick<History, 'replaceState' | 'state'>;
  fetchImpl?: typeof fetch;
} = {}): Promise<void> {
  const url = new URL(location.href);
  const params = new URLSearchParams(url.hash.slice(1));
  const credential = params.get('enigma-local-key');
  if (!credential) return;
  // Remove the credential before any request or application initialization.
  params.delete('enigma-local-key');
  url.hash = params.toString();
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || !['http:', 'https:'].includes(url.protocol) || !/^\/desktop(?:\/|$)/.test(url.pathname)) {
    throw new Error('本机登录入口只能在本机工作台使用。');
  }
  const response = await fetchImpl('/api/web-auth/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential }),
  });
  if (!response.ok) throw new Error('本机登录已失效，请重新运行 npm run enigma:open。');
}
