import { AsyncLocalStorage } from 'node:async_hooks';
import { resolve, sep, join, dirname, basename } from 'node:path';
import { realpathSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

export interface ProcessBoundary {
  schema: 1;
  kind: 'seatbelt' | 'explicit-host';
  prefix: string[];
  denyReadPaths: string[];
  readOnlyPaths: string[];
  writablePaths?: string[];
}
const boundaries = new AsyncLocalStorage<ProcessBoundary>();
const environmentKey = 'ENIGMA_PROCESS_BOUNDARY';
function canonicalPath(value:string):string{
  let cursor=resolve(value);const suffix:string[]=[];
  while(true){try{return join(realpathSync(cursor),...suffix);}catch(error){
    if(!['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code||''))throw error;
    const parent=dirname(cursor);if(parent===cursor)return resolve(value);suffix.unshift(basename(cursor));cursor=parent;
  }}
}

export function processBoundary(): ProcessBoundary | undefined {
  const active = boundaries.getStore();
  if (active) return active;
  const encoded = process.env[environmentKey];
  if (!encoded) return undefined;
  const value = JSON.parse(encoded) as ProcessBoundary;
  if (value.schema !== 1 || !['seatbelt','explicit-host'].includes(value.kind) || !Array.isArray(value.prefix)
    || !Array.isArray(value.denyReadPaths) || !Array.isArray(value.readOnlyPaths)
    || value.writablePaths!==undefined&&!Array.isArray(value.writablePaths)
    || [...value.prefix,...value.denyReadPaths,...value.readOnlyPaths,...value.writablePaths||[]].some(item => typeof item !== 'string' || item.includes('\0'))) throw new Error('Invalid host execution boundary');
  return value;
}

export async function withProcessBoundary<T>(boundary: ProcessBoundary, action: () => Promise<T>) { return boundaries.run(boundary,action); }

/** Only application-owned workers receive the boundary; model argv cannot grant a bypass. */
export function workerEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const boundary = processBoundary();
  return boundary ? { ...environment, [environmentKey]:JSON.stringify(boundary) } : environment;
}

export function guardedArgv(argv: string[], internalGit = false) {
  const boundary = processBoundary();
  return boundary && !internalGit ? [...boundary.prefix,...argv] : argv;
}

export function assertBoundaryPath(file: string, access: 'read' | 'write') {
  const boundary = processBoundary();
  if (!boundary) return;
  const canonical = canonicalPath;
  const target = canonical(file), inside = (root: string) => { const base=canonical(root); return target === base || target.startsWith(base+sep); };
  if (boundary.denyReadPaths.some(inside)) throw new Error('Native host denies access to this protected path');
  if (access === 'write' && boundary.readOnlyPaths.some(inside)) throw new Error('Native host marks this path read-only');
  if (access === 'write' && boundary.writablePaths && !boundary.writablePaths.some(inside)) throw new Error('Worker write is outside its isolated repository grants');
}

/** A trusted worker derives its command boundary instead of inheriting the
 * parent shell's writable roots. The runner can publish receipts; model-driven
 * commands receive only selected source directories and an owned scratch dir.
 */
export async function isolatedWorkerBoundary(root:string,repos:{root:string;access:string}[]):Promise<ProcessBoundary|undefined>{
  const parent=processBoundary();if(!parent)return undefined;
  const writablePaths=repos.filter(repo=>repo.access==='write').map(repo=>repo.root);
  const protectedPaths=[...repos.filter(repo=>repo.access!=='write').map(repo=>repo.root),...repos.map(repo=>join(repo.root,'.git'))];
  if(parent.kind!=='seatbelt')return {...parent,writablePaths,readOnlyPaths:[...parent.readOnlyPaths,...protectedPaths]};
  if(process.platform!=='darwin'||parent.prefix[0]!=='/usr/bin/sandbox-exec'||parent.prefix[1]!=='-f'||!parent.prefix[2])throw new Error('Unsupported parent worker sandbox; no unrestricted fallback');
  const directory=join(root,'.enigma-next','execution'),scratch=join(directory,'scratch');await mkdir(scratch,{recursive:true});
  const source=await readFile(parent.prefix[2],'utf8');
  // Seatbelt resolves specific subpath rules over a broad deny. Rebuild all
  // write rules, preserving read/network/process restrictions, instead of
  // assuming an appended deny revokes the parent's specific allow rules.
  const profile=source.split('\n').filter(line=>!/^\s*\((?:allow|deny) file-write\*/.test(line)).join('\n');
  const canonical=canonicalPath;
  const scope=`\n;; Isolated worker source writes; parent grants are revoked.\n(deny file-write*)\n${[...writablePaths,scratch].map(file=>`(allow file-write* (subpath ${JSON.stringify(canonical(file))}))`).join('\n')}\n${protectedPaths.map(file=>`(deny file-write* (literal ${JSON.stringify(canonical(file))}) (subpath ${JSON.stringify(canonical(file))}))`).join('\n')}\n`;
  const target=join(directory,'commands.sb');await writeFile(target,profile+scope,{mode:0o600});
  return {schema:1,kind:'seatbelt',prefix:[parent.prefix[0],'-f',target,...parent.prefix.slice(3)],denyReadPaths:parent.denyReadPaths,
    readOnlyPaths:protectedPaths,writablePaths};
}
