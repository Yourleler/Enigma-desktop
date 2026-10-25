import { TaskPackages } from './task-package.js';
import { Delegations, type DelegationInput } from './delegation.js';
import type { Workspace } from './workspace.js';
import type { TaskPackageInput } from './task-package.js';

const context = (input: Partial<TaskPackageInput> & { goal: string }): TaskPackageInput => ({ ...input, goal: input.goal,
  source: input.source ?? { agent: 'enigma-next-cli' }, notes: input.notes ?? [{ role: 'user', kind: 'requirement', text: input.goal, reference: 'explicit operator CLI request' }] });
export async function collaborationCommand(workspace: Workspace, command: string, args: string[], signal: AbortSignal) {
  if (command === 'package') {
    if (args[0] === 'export' && args[1]) return await new TaskPackages(workspace).export(context(JSON.parse(args[1])), { directory: args[2], signal });
    if (args[0] === 'inspect' && args[1]) return (await TaskPackages.inspect(args[1])).manifest;
    if (args[0] === 'restore' && args[1] && args[2]) { const result = await TaskPackages.restore(args[1], args[2], { ...(args[3] ? JSON.parse(args[3]) : {}), signal }); return { workspace: result.workspace.root, resources: result.resources, handoff: result.handoff, piSession: result.piSession, runtimeActivated: result.runtimeActivated, taskScope: result.taskScope }; }
    throw new Error('Use package export JSON [DIRECTORY], inspect DIRECTORY, or restore DIRECTORY DESTINATION [OPTIONS_JSON]');
  }
  const delegations = new Delegations(workspace);
  if (args[0] === 'list') return await delegations.list(args[1]);
  if (args[0] === 'start' && args[1]) { const input = JSON.parse(args[1]) as DelegationInput; return await delegations.start({ ...input, ...context(input) }); }
  if (args[0] === 'status' && args[1]) return await delegations.status(args[1]);
  if (args[0] === 'wait' && args[1]) return await delegations.wait(args[1], { signal, timeoutMs: 30000 });
  if (args[0] === 'cancel' && args[1]) return await delegations.cancel(args[1]);
  if (args[0] === 'drain' && args[1]) return await delegations.drain(args[1], { signal });
  if (args[0] === 'preview' && args[1]) return await delegations.preview(args[1]);
  if (args[0] === 'merge' && args[1]) return await delegations.merge(args[1], { signal });
  throw new Error('Use delegates start JSON, list [TASK], status ID, wait ID, cancel ID, preview ID, or merge PREVIEW_ID');
}
