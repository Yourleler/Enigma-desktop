import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const hash = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
export const id = (prefix: string): string => `${prefix}-${randomUUID()}`;
/** Windows may briefly deny replacement while a reader or scanner owns the old file. */
export async function replaceFile(source: string, destination: string): Promise<void> {
  const pauses = [25, 50, 100, 200, 400, 600];
  for (let attempt = 0; ; attempt++) {
    try { await rename(source, destination); return; }
    catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EBUSY', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '') || attempt >= pauses.length) throw error;
      await delay(pauses[attempt]);
    }
  }
}
export async function writeJson(path: string, value: unknown): Promise<void> {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) throw new TypeError('Value cannot be serialized as JSON');
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(tmp, 'wx', 0o600);
    try { await file.writeFile(serialized + '\n'); await file.sync(); } finally { await file.close(); }
    await replaceFile(tmp, path);
  }
  finally { await rm(tmp, { force: true }); }
}
export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}
export async function ensureDir(path: string): Promise<string> {
  await mkdir(path, { recursive: true });
  if ((await lstat(path)).isSymbolicLink()) throw new Error('Runtime state directory cannot be a symbolic link');
  return await realpath(path);
}
export function safeId(value: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value)) throw new Error('Invalid identifier');
  return value;
}
export function redact(text: string, secrets: string[] = []): string {
  for (const secret of secrets.filter(x => x.length >= 8).sort((a, b) => b.length - a.length)) text = text.split(secret).join('[REDACTED]');
  return text.replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]');
}
export const storePath = (root: string, category: string, entry: string): string => join(root, category, `${safeId(entry)}.json`);
