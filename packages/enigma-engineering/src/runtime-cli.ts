import type { Workspace } from './workspace.js';
import { ServiceManager } from './services.js';
import { BackgroundRuns } from './background.js';
import { BrowserValidation } from './browser-validation.js';
import { TaskEvents } from './task-events.js';
import { Artifacts } from './artifacts.js';
import { projectOverview } from './project-overview.js';

export async function runtimeCommand(workspace: Workspace, command: string, args: string[], signal: AbortSignal) {
  if (command === 'overview') return await projectOverview(workspace, { task: args[0] });
  if (command === 'events') {
    const events = new TaskEvents(workspace);
    if (args[0] === 'wait' && args[1]) return await events.start(JSON.parse(args[1]));
    if (args[0] === 'list') return await events.events(args[1]);
    if (args[0] === 'waits') return await events.list(args[1]);
    if (args[0] === 'status' && args[1]) return await events.status(args[1]);
    if (args[0] === 'cancel' && args[1]) return await events.cancel(args[1]);
  }
  if (command === 'artifacts') {
    const artifacts = new Artifacts(workspace);
    if (args[0] === 'add' && args[1]) return await artifacts.add(JSON.parse(args[1]));
    if (args[0] === 'list') return await artifacts.list(args[1]);
    if (args[0] === 'read' && args[1]) return await artifacts.read(args[1], args[2]);
  }
  if (command === 'browser') {
    const browser = new BrowserValidation(workspace);
    if (args[0] === 'list') return await browser.list();
    if (args[0] === 'add' && args[1]) return await browser.add(JSON.parse(args[1]));
    if (args[0] === 'run' && args[1]) { const report = await browser.run(args[1], { signal }); if (report.status !== 'passed') process.exitCode = 1; return report; }
    if (args[0] === 'report' && args[1]) return await browser.read(args[1]);
  }
  if (command === 'services') {
    const services = new ServiceManager(workspace);
    if (args[0] === 'list') return await services.list();
    if (args[0] === 'add' && args[1]) return await services.add(JSON.parse(args[1]));
    if (!args[1]) throw new Error('Provide service id');
    if (args[0] === 'start') return await services.start(args[1], { signal });
    if (args[0] === 'stop') return await services.stop(args[1]);
    if (args[0] === 'restart') return await services.restart(args[1], { signal });
    if (args[0] === 'status') return await services.status(args[1]);
  }
  if (command === 'background') {
    const runs = new BackgroundRuns(workspace);
    if (args[0] === 'list') return await runs.list();
    if (args[0] === 'start' && args[1]) return await runs.start(JSON.parse(args[1]));
    if (!args[1]) throw new Error('Provide background run id');
    if (args[0] === 'status') return await runs.status(args[1]);
    if (args[0] === 'wait') return await runs.wait(args[1], { signal, timeoutMs: 30_000 });
    if (args[0] === 'drain') return await runs.drain(args[1], { signal });
    if (args[0] === 'cancel') return await runs.cancel(args[1]);
    if (args[0] === 'acknowledge' && args[2]) { await runs.acknowledge(args[1], args.slice(2).join(' ')); return { reconciled: args[1] }; }
  }
  throw new Error('Use services add/list/start/status/stop/restart or background start/list/status/wait/cancel/acknowledge');
}
