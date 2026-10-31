import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createGunzip, createBrotliDecompress, createInflate } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Turndown from 'turndown';
import type { Workspace } from './workspace.js';
import { ProjectContext, type ResourceInput, type ResourceCapture } from './project-context.js';
import { ensureDir, hash, readJson, redact, writeJson } from './storage.js';
import { runProcess } from './process.js';

export interface ResourceFetchOptions {
  title?: string; scope?: ResourceCapture['scope']; keyword?: string; startBlock?: string; endBlock?: string; maxDepth?: number;
  signal?: AbortSignal; larkBinary?: string; larkCommand?: string[];
}
interface FetchConfig { schema: 1; trustedHosts: string[] }
async function trustedHosts(workspace: Workspace): Promise<string[]> {
  try {
    const config = await readJson<FetchConfig>(join(workspace.data, 'fetch-config.json'));
    if (config.schema !== 1 || !Array.isArray(config.trustedHosts) || config.trustedHosts.length > 100 || config.trustedHosts.some(host => typeof host !== 'string' || !/^[\w.:[\]-]{1,253}$/.test(host))) throw new Error('Invalid document fetch host configuration');
    return config.trustedHosts.map(host => host.toLowerCase());
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}
function privateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized.includes(':')) {
    if (normalized.startsWith('::ffff:')) { const tail = normalized.slice(7); return isIP(tail) === 4 ? privateAddress(tail) : true; }
    return normalized === '::' || normalized === '::1' || /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(normalized);
  }
  const bytes = normalized.split('.').map(Number);
  return bytes[0] === 0 || bytes[0] === 10 || bytes[0] === 127 || bytes[0]! >= 224 || bytes[0] === 169 && bytes[1] === 254
    || bytes[0] === 172 && bytes[1]! >= 16 && bytes[1]! <= 31 || bytes[0] === 192 && bytes[1] === 168 || bytes[0] === 100 && bytes[1]! >= 64 && bytes[1]! <= 127;
}
function validateUri(uri: string) {
  const url = new URL(uri);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Document source needs HTTP(S) without embedded credentials');
  return url;
}
async function getHttp(url: URL, trusted: string[], signal?: AbortSignal) {
  const host = url.hostname.replace(/^\[|\]$/g, ''), addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  if (!addresses.length || !trusted.includes(host.toLowerCase()) && addresses.some(item => privateAddress(item.address))) throw new Error('Private document hosts require explicit operator trust configuration');
  const address = addresses[0]!;
  return await new Promise<{ status: number; location?: string; etag?: string; type: string; body: Buffer }>((resolve, reject) => {
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const timer = setTimeout(() => req.destroy(new Error('Document fetch timed out')), 20_000);
    const abort = () => req.destroy(new Error('Document fetch cancelled'));
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const req = request(url, { headers: { 'User-Agent': 'Enigma-next document reader', 'Accept-Encoding': 'gzip, deflate, br' },
      lookup: (_hostname, options, callback) => { if (options.all) callback(null, [{ address: address.address, family: address.family }]); else callback(null, address.address, address.family); } }, response => {
      void (async () => {
        try {
          const status = response.statusCode ?? 0, location = response.headers.location;
          if (status !== 200) { response.destroy(); cleanup(); resolve({ status, location, type: '', body: Buffer.alloc(0) }); return; }
          const encoding = response.headers['content-encoding'];
          const stream = encoding === 'gzip' ? response.pipe(createGunzip()) : encoding === 'br' ? response.pipe(createBrotliDecompress()) : encoding === 'deflate' ? response.pipe(createInflate()) : response;
          const chunks: Buffer[] = []; let length = 0;
          for await (const chunk of stream) { const bytes = Buffer.from(chunk); length += bytes.length;
            if (length > 1_000_000) { stream.destroy(); req.destroy(); throw new Error('Document exceeds the 1 MB text budget'); } chunks.push(bytes); }
          cleanup(); resolve({ status, type: String(response.headers['content-type'] ?? 'text/plain'), etag: response.headers.etag, body: Buffer.concat(chunks) });
        } catch (error) { cleanup(); reject(error); }
      })();
    });
    req.once('error', error => { cleanup(); reject(error); });
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort(); else req.end();
  });
}
async function saveRaw(workspace: Workspace, value: unknown) {
  const text = redact(JSON.stringify(value), workspace.secrets), digest = hash(text);
  const directory = await ensureDir(join(workspace.data, 'source-captures'));
  await writeJson(join(directory, `${digest}.json`), JSON.parse(text)); return digest;
}
function selection(options: ResourceFetchOptions) {
  const scope = options.scope ?? (options.keyword ? 'keyword' : 'outline');
  if (!['full', 'outline', 'keyword', 'section', 'range'].includes(scope) || options.keyword && options.keyword.length > 500
    || options.maxDepth !== undefined && (!Number.isInteger(options.maxDepth) || options.maxDepth < -1 || options.maxDepth > 10)) throw new Error('Invalid document selection');
  for (const block of [options.startBlock, options.endBlock]) if (block && !/^[\w-]{1,200}$/.test(block)) throw new Error('Invalid document block id');
  if (scope === 'keyword' && !options.keyword || scope === 'section' && !options.startBlock || scope === 'range' && !options.startBlock && !options.endBlock) throw new Error('Document selection needs a keyword or block anchor');
  return scope;
}
export async function fetchResource(workspace: Workspace, uri: string, options: ResourceFetchOptions = {}): Promise<ResourceInput> {
  let url = validateUri(uri); const originalUri = url.href, at = new Date().toISOString();
  if (/\/(docx|wiki)\/[^/]+/.test(url.pathname)) {
    const scope = selection(options), argv = [...options.larkCommand ?? [options.larkBinary ?? 'lark-cli'], 'docs', '+fetch', '--as', 'user', '--doc', url.href, '--doc-format', 'markdown', '--detail', 'with-ids', '--scope', scope];
    if (options.keyword) argv.push('--keyword', options.keyword);
    if (options.startBlock) argv.push('--start-block-id', options.startBlock);
    if (options.endBlock) argv.push('--end-block-id', options.endBlock);
    if (options.maxDepth !== undefined) argv.push('--max-depth', String(options.maxDepth));
    const result = await runProcess(argv, workspace.root, { signal: options.signal, timeoutMs: 60_000, limit: 4_000_000 });
    if (result.status !== 'passed' || result.truncated) throw new Error(`Lark document fetch ${result.status}: ${redact(result.output, workspace.secrets).slice(0, 1500)}`);
    const response = JSON.parse(result.output) as { ok?: boolean; error?: unknown; data?: { document?: { content?: string; revision_id?: number; tips?: string } } };
    const document = response.data?.document;
    if (response.ok !== true || typeof document?.content !== 'string' || !document.content.trim()) throw new Error(`Lark document unavailable; inspect identity/scopes and response: ${redact(JSON.stringify(response.error ?? {}), workspace.secrets)}`);
    const raw = await saveRaw(workspace, response);
    return { title: options.title ?? document.content.split('\n').find(line => line.trim())?.replace(/^#+\s*/, '').slice(0, 180) ?? url.hostname,
      source: { kind: 'imported', uri: url.href, capture: { provider: 'lark', at, scope, version: String(document.revision_id ?? 'unknown'), raw, format: 'markdown', selector: { keyword: options.keyword, startBlock: options.startBlock, endBlock: options.endBlock, maxDepth: options.maxDepth } } }, content: document.content,
      description: `Lark ${scope} selection. Linked resources/comments remain in the raw response; remote freshness is verified only at fetch time.` };
  }
  const trusted = await trustedHosts(workspace);
  for (let count = 0; count <= 4; count++) {
    if (options.signal?.aborted) throw new Error('Document fetch cancelled');
    const response = await getHttp(url, trusted, options.signal);
    if ([301, 302, 303, 307, 308].includes(response.status) && response.location) { url = validateUri(new URL(response.location, url).href); continue; }
    if ([401,403].includes(response.status)) throw new Error(`来源需要认证或没有访问权限（HTTP ${response.status}）。未保存资料，请使用已授权的链接或先配置来源接入。`);
    if (response.status !== 200) throw new Error(`来源读取失败（HTTP ${response.status}），未保存资料。请确认链接后重试。`);
    if (!/^text\/|application\/(json|xml|xhtml\+xml)/i.test(response.type)) throw new Error('Source is not a supported text document');
    const charset = /charset=([^;]+)/i.exec(response.type)?.[1]?.trim() ?? 'utf-8', text = new TextDecoder(charset, { fatal: true }).decode(response.body);
    const html = /html/i.test(response.type), title = options.title ?? (html ? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1]?.replace(/<[^>]+>/g, '').trim() : undefined) ?? url.hostname;
    const content = html ? new Turndown({ headingStyle: 'atx', codeBlockStyle: 'fenced' }).turndown(text.replace(/<(script|style|nav)[^>]*>[\s\S]*?<\/\1>/gi, '')) : text;
    if (!content.trim()) throw new Error('Document has no readable text');
    const raw = await saveRaw(workspace, { url: url.href, type: response.type, etag: response.etag, content: text });
    return { title: title.slice(0, 180), content, source: { kind: 'imported', uri: originalUri, capture: { provider: 'http', at, scope: 'full', version: response.etag, raw, resolvedUri: url.href, format: html ? 'markdown' : response.type } } };
  }
  throw new Error('Document redirect limit exceeded');
}
export async function readResourceCapture(workspace: Workspace, digest: string) {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid source capture id');
  const bytes = await readFile(join(workspace.data, 'source-captures', `${digest}.json`));
  if (bytes.length > 4_000_000) throw new Error('Source capture exceeds budget');
  const value = JSON.parse(bytes.toString()); if (hash(JSON.stringify(value)) !== digest) throw new Error('Source capture integrity mismatch'); return value;
}
export async function refreshResource(workspace: Workspace, resource: string, options: ResourceFetchOptions & { task?: string } = {}) {
  const project = new ProjectContext(workspace), prior = await project.read(resource, { task: options.task });
  if (prior.resource.source.kind !== 'imported') return await project.refresh(resource, { task: options.task });
  const fetched = await fetchResource(workspace, prior.resource.source.uri, { ...prior.resource.source.capture?.selector, scope: prior.resource.source.capture?.scope, ...options, title: prior.resource.title });
  return await project.refresh(resource, { task: options.task }, fetched.content, fetched.source);
}
