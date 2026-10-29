import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Workspace } from './workspace.js';
import type { HandoffInspection } from './handoff.js';
import { inspectPortableHandoff } from './differential-handoff.js';
import { id, redact, writeJson } from './storage.js';
import { runProcess } from './process.js';

/** Public Codex CLI input. It creates a real Codex conversation rather than rewriting history. */
export async function runCodexHandoff(workspace: Workspace, directory: string, options: {
  writable?: boolean; signal?: AbortSignal; timeoutMs?: number; model?: string; executable?: string;
} = {}) {
  const inspection = await inspectPortableHandoff(workspace, directory);
  if (options.writable && !inspection.safeToContinue) throw new Error('Cannot start writable continuation with unresolved code or operation conflicts');
  const writableRoot = workspace.config.repos.find(repo => repo.access === 'write');
  if (options.writable && !writableRoot) throw new Error('Register a writable repository before starting a writable target agent');
  const run = id('codex-handoff'), output = join(workspace.data, 'runs', run); await mkdir(output, { recursive: true });
  const finalPath = join(output, 'answer.md');
  const argv = [options.executable ?? 'codex', 'exec', '--cd', options.writable ? writableRoot!.root : workspace.root, '--skip-git-repo-check', '--sandbox', options.writable ? 'workspace-write' : 'read-only', '--json', '--output-last-message', finalPath];
  if (options.model) argv.push('--model', options.model);
  if (options.writable) for (const repo of workspace.config.repos) if (repo.access === 'write') argv.push('--add-dir', repo.root);
  argv.push(inspection.manifest.goal);
  const observed = await workspace.observe();
  const execute = () => runProcess(argv, workspace.root, { stdin: inspection.prompt, signal: options.signal, timeoutMs: options.timeoutMs ?? 240000, limit: 1000000, activity: workspace.activity });
  // Prevent Enigma dispatch during an external writable run and record observed effects in all repos.
  // Codex keeps its own permission boundary; this is coordination, not host confinement.
  const result = options.writable && writableRoot
    ? await workspace.exclusive(async () => {
      const current = await inspectPortableHandoff(workspace, directory);
      if (!current.safeToContinue) throw new Error('Target changed before Codex dispatch; inspect the handoff again');
      return await workspace.mutate(writableRoot.id, 'command', execute);
    })
    : await execute();
  let answer: string | undefined;
  try { answer = redact(await readFile(finalPath, 'utf8'), workspace.secrets); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const threadId = extractThread(result.output);
  const report = { schema: 1, id: run, handoff: inspection.manifest.id, mode: inspection.manifest.mode, target: 'codex', threadId,
    source: inspection.manifest.source, startedFrom: observed, finishedAt: new Date().toISOString(), status: result.status,
    exitCode: result.exitCode, cleanup: result.cleanup, answer, outputTruncated: result.truncated, writable: options.writable ?? false,
    targetVerification: 'unverified', note: 'Codex output is a source observation; run registered target checks to verify code behavior.' };
  await writeJson(join(output, 'report.json'), report);
  return { report, path: output, inspection: briefInspection(inspection) };
}

function extractThread(output: string): string | undefined {
  for (const line of output.split('\n')) {
    try { const event = JSON.parse(line) as { type?: string; thread_id?: string }; if (event.type === 'thread.started') return event.thread_id; }
    catch { /* Non-JSON diagnostics are not thread records. */ }
  }
  return undefined;
}
function briefInspection(inspection: HandoffInspection) { return { code: inspection.code, warnings: inspection.warnings, mode: inspection.manifest.mode }; }
