import { Type } from 'typebox';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Workspace } from './workspace.js';
import { BackgroundRuns, type BackgroundInput } from './background.js';
import { ServiceManager, type ServiceInput } from './services.js';
import { redact } from './storage.js';
import { BrowserValidation } from './browser-validation.js';

const names = ['service_manage', 'background_task', 'browser_validate'];
export function createRuntimeExtension(options: { workspace?: Workspace; approval?: 'ask' | 'auto' | 'never' } = {}) {
  return (pi: ExtensionAPI) => {
    let workspace: Workspace, services: ServiceManager, runs: BackgroundRuns;
    const approval = options.approval ?? process.env.ENIGMA_APPROVAL ?? 'ask';
    if (!['ask', 'auto', 'never'].includes(approval)) throw new Error('Invalid runtime approval policy');
    const allow = async (ctx: ExtensionContext, description: string) => {
      if (ctx.signal?.aborted) throw new Error('Runtime operation cancelled');
      if (approval === 'never' || approval === 'ask' && (!ctx.hasUI || !await ctx.ui.confirm('Host process operation', redact(description, workspace.secrets)))) throw new Error('Host process operation requires approval');
      if (ctx.signal?.aborted) throw new Error('Runtime operation cancelled');
    };
    const result = (data: unknown) => { const safe = JSON.parse(redact(JSON.stringify(data), workspace.secrets)); return { content: [{ type: 'text' as const, text: JSON.stringify(safe, null, 2) }], details: safe, structuredContent: safe }; };
    pi.on('session_start', async (_event, ctx) => {
      workspace = options.workspace ?? await Workspace.open(process.env.ENIGMA_WORKSPACE ?? ctx.cwd);
      services = new ServiceManager(workspace); runs = new BackgroundRuns(workspace);
      pi.events.emit('enigma:managed-tools', { owner: 'runtime', names }); pi.setActiveTools([...new Set([...pi.getActiveTools(), ...names])]);
    });
    pi.on('session_shutdown', () => { pi.events.emit('enigma:managed-tools', { owner: 'runtime', names: [] }); });
    pi.registerTool({ name: 'service_manage', label: 'Project services', description: 'Manage approved local repository services and real readiness. Configure ServiceInput JSON {id,repo,label,argv,dependsOn?,portPrefix?,readiness?,envFromServices?}; dependencies restart invalidates consumers. Readiness is not task acceptance. Commands run on the host; stopping only signals the owned background command, never a process found merely by port.', executionMode: 'sequential',
      parameters: Type.Object({ action: Type.Union(['list', 'add', 'start', 'status', 'stop', 'restart'].map(action => Type.Literal(action))), id: Type.Optional(Type.String()), input: Type.Optional(Type.String()) }),
      async execute(_id, args, signal, _update, ctx) {
        if (args.action === 'list') return result(await services.list());
        if (args.action === 'add') { if (!args.input) throw new Error('Provide service configuration JSON'); return result(await services.add(JSON.parse(args.input) as ServiceInput)); }
        if (!args.id) throw new Error('Provide service id');
        if (args.action === 'status') return result(await services.status(args.id));
        await allow(ctx, `Service ${args.action}: ${JSON.stringify((await services.status(args.id)).service)}`);
        if (args.action === 'stop') return result(await services.stop(args.id));
        if (args.action === 'restart') return result(await services.restart(args.id, { task: ctx.sessionManager.getSessionId(), signal }));
        return result(await services.start(args.id, { task: ctx.sessionManager.getSessionId(), signal }));
      } });
    pi.registerTool({ name: 'background_task', label: 'Background command', description: 'Start an approved durable host command, list/query it, wait briefly or cancel. input is BackgroundInput JSON {repo,label,argv,maxRuntimeMs?,envRefs?}. Only actual exit is terminal; a wait timeout does not stop the command. Unknown effects require user reconciliation before further mutation/verification.', executionMode: 'sequential',
      parameters: Type.Object({ action: Type.Union(['start', 'list', 'status', 'wait', 'cancel'].map(action => Type.Literal(action))), id: Type.Optional(Type.String()), input: Type.Optional(Type.String()) }),
      async execute(_id, args, signal, _update, ctx) {
        const task = ctx.sessionManager.getSessionId();
        if (args.action === 'list') return result(await runs.list(task));
        if (args.action === 'start') { if (!args.input) throw new Error('Provide background command JSON'); const input = JSON.parse(args.input) as BackgroundInput; await allow(ctx, JSON.stringify(input)); return result(await runs.start({ ...input, task })); }
        if (!args.id) throw new Error('Provide background run id');
        if (args.action === 'status') return result(await runs.status(args.id, task));
        if (args.action === 'wait') return result(await runs.wait(args.id, { task, signal, timeoutMs: 5000 }));
        await allow(ctx, `Cancel owned background command ${args.id}`); return result(await runs.cancel(args.id, task));
      } });
    pi.registerTool({ name: 'browser_validate', label: 'Browser scenario', description: 'List/run an operator-defined browser scenario or read its report. Performs real page actions against ready project services, retains local screenshots/trace, and ties results to source/scenario/service versions. Scenario changes are user-owned CLI configuration. A passed scenario is not complete task acceptance; run registered joint checks too.', executionMode: 'sequential',
      parameters: Type.Object({ action: Type.Union(['list', 'run', 'report'].map(action => Type.Literal(action))), id: Type.Optional(Type.String()) }),
      async execute(_id, args, signal, _update, ctx) {
        const browser = new BrowserValidation(workspace);
        if (args.action === 'list') return result(await browser.list());
        if (!args.id) throw new Error('Provide browser scenario/report id');
        if (args.action === 'report') return result(await browser.read(args.id));
        await allow(ctx, `Run browser scenario ${args.id}; page actions may change application state`); return result(await browser.run(args.id, { signal }));
      } });
  };
}
export default createRuntimeExtension();
