import type { Workspace } from './workspace.js';
import { ProjectContext } from './project-context.js';
import { SourceIndex,sourceSelectionView } from './source-index.js';
import { TaskReadingStore } from './task-reading.js';
import { readSchemas } from './schema-reading.js';
import { fetchResource, refreshResource, readResourceCapture } from './resource-fetch.js';
import { readJson, writeJson } from './storage.js';
import { join } from 'node:path';

export async function projectCommand(workspace: Workspace, command: string | undefined, args: string[], signal: AbortSignal): Promise<unknown | undefined> {
  if (command === 'schemas') return await readSchemas(workspace, { query: args[0], signal });
  if (command === 'source-index') {
    const language = args[1]; if (language && !['Go', 'Python', 'TypeScript'].includes(language)) throw new Error('Source index language must be Go, Python or TypeScript');
    const indexed = await new SourceIndex(workspace).select(args[0] ?? '', { language: language as 'Go' | 'Python' | 'TypeScript' | undefined, signal });
    return sourceSelectionView(indexed);
  }
  if (command === 'project') {
    const context = new ProjectContext(workspace), access = { task: args[2] };
    if (args[0] === 'add' && args[1]) return await context.add(JSON.parse(args[1]));
    if (args[0] === 'fetch' && args[1]) return await context.add(await fetchResource(workspace, args[1], { ...(args[2] ? JSON.parse(args[2]) : {}), signal }));
    if (args[0] === 'refresh-source' && args[1]) return await refreshResource(workspace, args[1], { ...(args[2] ? JSON.parse(args[2]) : {}), signal });
    if (args[0] === 'raw' && args[1]) { const resource = await context.read(args[1], access); if (resource.resource.source.kind !== 'imported' || !resource.resource.source.capture) throw new Error('Resource has no captured source envelope'); return await readResourceCapture(workspace, resource.resource.source.capture.raw); }
    if (args[0] === 'trust-host' && args[1]) {
      const host = args[1].toLowerCase(); if (!/^[\w.:[\]-]{1,253}$/.test(host)) throw new Error('Provide a host name or IP without URL/port');
      return await workspace.exclusive(async () => {
        const path = join(workspace.data, 'fetch-config.json'); let trustedHosts: string[] = [];
        try { trustedHosts = (await readJson<{ trustedHosts: string[] }>(path)).trustedHosts; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        await writeJson(path, { schema: 1, trustedHosts: [...new Set([...trustedHosts, host])] }); return { trustedHost: host };
      });
    }
    if (args[0] === 'list') return await context.search(args[1] ?? '', access);
    if (args[0] === 'read' && args[1]) return await context.read(args[1], access);
    if (args[0] === 'bundle') return await context.materialize(args[1] ?? '', access);
    if (args[0] === 'refresh' && args[1]) { const update = args[2] ? JSON.parse(args[2]) as { task?: string; content?: string } : {}; return await context.refresh(args[1], update, update.content); }
    if (args[0] === 'remove' && args[1]) { await context.remove(args[1], access); return { removed: args[1] }; }
    throw new Error('Use project add JSON, list QUERY [TASK], read ID [TASK], bundle QUERY [TASK], refresh ID [JSON], or remove ID [TASK]');
  }
  if (command === 'task-map') {
    const readings = new TaskReadingStore(workspace);
    if (args[0] === 'build' && args[1]) return await readings.build(JSON.parse(args[1]), signal);
    if (args[0] === 'open' && args[1]) return await readings.open(args[1], args[2]);
    if (args[0] === 'coverage' && args[1]) return await readings.coverage(args[1], args[2], args[3]);
    if (args[0] === 'annotate' && args[1] && args[2] && args[3]) return await readings.annotate(args[1], Number(args[2]), JSON.parse(args[3]), args[4]);
    throw new Error('Use task-map build JSON, open ID [TASK], coverage ID [EVIDENCE] [TASK], or annotate ID REVISION JSON [TASK]');
  }
  return undefined;
}
