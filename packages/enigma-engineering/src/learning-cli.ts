import type { Workspace } from './workspace.js';
import { Experiments } from './experiments.js';
import { ProjectKnowledge } from './project-knowledge.js';

export async function learningCommand(workspace: Workspace, command: string, args: string[], signal: AbortSignal) {
  if (command === 'knowledge') {
    const knowledge = new ProjectKnowledge(workspace);
    if (args[0] === 'draft' && args[1]) { const input = JSON.parse(args[1]); return await knowledge.draft(input, { session: input.task, entries: input.entry ? [input.entry] : [] }); }
    if (args[0] === 'organize') return await knowledge.organize({ signal });
    if (args[0] === 'search' && args[1]) return await knowledge.search(args[1], args[2] ? JSON.parse(args[2]) : {});
    throw new Error('Use knowledge draft JSON, organize, or search QUERY [ACCESS_JSON]');
  }
  const experiments = new Experiments(workspace);
  if (args[0] === 'create' && args[1]) return await experiments.create(JSON.parse(args[1]));
  if (args[0] === 'list') return await experiments.list(args[1]);
  if (args[0] === 'evaluate' && args[1]) return await experiments.evaluate(args[1], { signal });
  if (args[0] === 'report' && args[1]) return await experiments.report(args[1]);
  if (args[0] === 'select' && args[1] && args[2]) return await experiments.select(args[1], args[2]);
  throw new Error('Use experiments create JSON, list [TASK], evaluate ID, report ID, or select ID CANDIDATE');
}
