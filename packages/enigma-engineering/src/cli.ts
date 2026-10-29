#!/usr/bin/env node
import { inspectPortableHandoff } from './differential-handoff.js';
import { spawn } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoGraph } from './reading.js';
import { Workspace } from './workspace.js';
import { configureGateway } from './model-config.js';
import { readJson, redact } from './storage.js';
import { PlanStore, type PlanInput, type PlanStep } from './planning.js';
import { observeChanges } from './changes.js';
import { compareSolutions, previewRestore } from './solutions.js';
import { readObserverStatus } from './observer.js';
import { MemoryStore, type MemoryInput } from './memory.js';
import { discoverContracts } from './contracts.js';
import { exportHandoff, type HandoffInput } from './handoff.js';
import { askObserver } from './observer-questions.js';
import { ReadingStore } from './reading-store.js';

const help = `Enigma-next — Pi-based multi-repository coding

enigma-next [--workspace DIR] repos add ID PATH [--read-only]
enigma-next [--workspace DIR] repos list | graph
enigma-next [--workspace DIR] repos depends ID DEP...
enigma-next [--workspace DIR] checks add ID REPO [--joint] -- COMMAND ARG...
enigma-next [--workspace DIR] verify
enigma-next [--workspace DIR] plan show | create JSON
enigma-next [--workspace DIR] plan step PLAN_ID STEP REVISION PHASE [EVIDENCE]
enigma-next [--workspace DIR] connect gateway [--model MODEL] [--base-url URL]
enigma-next [--workspace DIR] read SYMBOL [REPO]
enigma-next [--workspace DIR] reading-open SYMBOL [NODE_ID]
enigma-next [--workspace DIR] contracts [QUERY]
enigma-next [--workspace DIR] source-index QUERY [Go|Python|TypeScript]
enigma-next [--workspace DIR] project add JSON | list QUERY | read ID | bundle QUERY
enigma-next [--workspace DIR] project refresh ID [JSON] | remove ID
enigma-next [--workspace DIR] project fetch URL [JSON] | refresh-source ID [JSON]
enigma-next [--workspace DIR] project raw ID | trust-host HOST
enigma-next [--workspace DIR] schemas [QUERY]
enigma-next [--workspace DIR] skills paths [PATHS_JSON] | search INTENT | list | open ID VERSION
enigma-next [--workspace DIR] recipes list | save JSON [REVISION] | read ID | run ID [PARAMETERS_JSON]
enigma-next [--workspace DIR] recipes runs | report ID | propose
enigma-next [--workspace DIR] recipes reconcile OBSERVED_EFFECTS
enigma-next [--workspace DIR] package export JSON [DIRECTORY] | inspect DIRECTORY
enigma-next [--workspace DIR] package restore DIRECTORY DESTINATION [OPTIONS_JSON]
enigma-next [--workspace DIR] delegates start JSON | list [TASK] | status ID | wait ID | cancel ID
enigma-next [--workspace DIR] delegates preview ID | merge PREVIEW_ID
enigma-next [--workspace DIR] delegates drain ID
enigma-next [--workspace DIR] experiments create JSON | list [TASK] | evaluate ID | report ID | select ID CANDIDATE
enigma-next [--workspace DIR] knowledge draft JSON | organize | search QUERY [ACCESS_JSON]
enigma-next [--workspace DIR] services add JSON | list | start ID | status ID | stop ID | restart ID
enigma-next [--workspace DIR] background start JSON | list | status ID | wait ID | cancel ID
enigma-next [--workspace DIR] background drain ID
enigma-next [--workspace DIR] background acknowledge ID OBSERVED_EFFECTS
enigma-next [--workspace DIR] browser add JSON | list | run ID | report RUN_ID
enigma-next [--workspace DIR] events wait JSON | list [TASK] | waits [TASK] | status ID | cancel ID
enigma-next [--workspace DIR] artifacts add JSON | list [TASK] | read ID [TASK]
enigma-next [--workspace DIR] overview [TASK]
enigma-next [--workspace DIR] task-map build JSON | open ID [TASK]
enigma-next [--workspace DIR] task-map annotate ID REVISION JSON [TASK]
enigma-next [--workspace DIR] task-map coverage ID [EVIDENCE] [TASK]
enigma-next [--workspace DIR] checkpoint LABEL
enigma-next [--workspace DIR] timeline
enigma-next [--workspace DIR] compare LEFT RIGHT
enigma-next [--workspace DIR] restore-preview TARGET EXPECTED
enigma-next [--workspace DIR] restore TARGET EXPECTED
enigma-next [--workspace DIR] fork CHECKPOINT DESTINATION
enigma-next [--workspace DIR] operations | recover
enigma-next [--workspace DIR] changes BASELINE
enigma-next [--workspace DIR] status [OBSERVER_ID]
enigma-next [--workspace DIR] why-slow [OBSERVER_ID]
enigma-next [--workspace DIR] ask-status QUESTION [--explain]
enigma-next [--workspace DIR] memory search QUERY | read ID | save JSON | forget ID
enigma-next [--workspace DIR] memory organize | reindex | recover
enigma-next [--workspace DIR] handoff export DESTINATION JSON
enigma-next [--workspace DIR] handoff inspect DIRECTORY | import-pi DIRECTORY
enigma-next [--workspace DIR] handoff codex DIRECTORY [--write] [--model MODEL]
enigma-next [--workspace DIR] review BASELINE GOAL
enigma-next [--workspace DIR] acknowledge OPERATION_ID OBSERVED_EFFECTS
enigma-next [--workspace DIR] agent [--approval ask|auto|never] [Pi arguments...]
enigma-next [--workspace DIR] workbench [--port PORT] [--memory] [--approval ask|auto|never]

Agent uses Pi's native TUI, provider configuration, sessions and --print/--mode json.
Command execution is approved host execution, not an OS sandbox.
`;

async function main(args: string[]): Promise<void> {
  if (!args.length || args[0] === '--help' || args[0] === '-h') { console.log(help); return; }
  let root = process.cwd();
  if (args[0] === '--workspace') { if (!args[1]) throw new Error('Missing workspace directory'); root = resolve(args[1]); args.splice(0, 2); }
  if (!args.length || args[0] === '--help' || args[0] === '-h') { console.log(help); return; }
  if (args[0] === 'ask-status') {
    if (!args[1]) throw new Error('Provide a runtime question');
    const useModel = args.includes('--explain');
    const explain = useModel ? (snapshot: string, question: string, signal: AbortSignal) => import('./pi-explanation.js').then(module => module.explainSnapshot(resolve(root, '.enigma-next', 'pi-agent'), snapshot, question, signal)) : undefined;
    console.log(JSON.stringify(await askObserver(root, args[1], { explain }), null, 2)); return;
  }
  if (args[0] === 'status' || args[0] === 'why-slow') {
    const status = await readObserverStatus(root, args[1]);
    if (args[0] === 'why-slow' && status.available) console.log(status.explanations.join('\n'));
    else console.log(JSON.stringify(status, null, 2));
    return;
  }
  const workspace = await Workspace.open(root);
  const [command, ...rest] = args;
  const print = (data: unknown) => console.log(redact(JSON.stringify(data, null, 2), workspace.secrets));
  if (command === 'workbench') {
    const portAt = rest.indexOf('--port'), policyAt = rest.indexOf('--approval');
    const host = await (await import('./workbench.js')).Workbench.open(workspace.root, { port: portAt < 0 ? 0 : Number(rest[portAt + 1]), memory: rest.includes('--memory'), approval: policyAt < 0 ? 'ask' : rest[policyAt + 1] as 'ask' | 'auto' | 'never' });
    const endpoint = await host.listen(); console.log(`Enigma-next 工作台：${endpoint.url}`);
    let stopped = false; const stop = () => { if (stopped) return; stopped = true; void host.close(); }; process.once('SIGINT', stop); process.once('SIGTERM', stop); return;
  }
  if (['experiments', 'knowledge'].includes(command ?? '')) {
    const controller = new AbortController(), stop = () => controller.abort(); process.once('SIGINT', stop);
    try { print(await (await import('./learning-cli.js')).learningCommand(workspace, command!, rest, controller.signal)); }
    finally { process.removeListener('SIGINT', stop); } return;
  }
  if (['package', 'delegates'].includes(command ?? '')) {
    const controller = new AbortController(), stop = () => controller.abort(); process.once('SIGINT', stop);
    try { print(await (await import('./collaboration-cli.js')).collaborationCommand(workspace, command!, rest, controller.signal)); }
    finally { process.removeListener('SIGINT', stop); }
    return;
  }
  if (['skills', 'recipes'].includes(command ?? '')) {
    const controller = new AbortController(), stop = () => controller.abort(); process.once('SIGINT', stop);
    try { print(await (await import('./reuse-cli.js')).reuseCommand(workspace, command!, rest, controller.signal)); }
    finally { process.removeListener('SIGINT', stop); }
    return;
  }
  if (['services', 'background', 'browser', 'events', 'artifacts', 'overview'].includes(command ?? '')) {
    const controller = new AbortController(), stop = () => controller.abort(); process.once('SIGINT', stop);
    try { print(await (await import('./runtime-cli.js')).runtimeCommand(workspace, command!, rest, controller.signal)); }
    finally { process.removeListener('SIGINT', stop); }
    return;
  }
  if (['project', 'task-map', 'source-index', 'schemas'].includes(command ?? '')) {
    const controller = new AbortController(), stop = () => controller.abort(); process.once('SIGINT', stop);
    try { print(await (await import('./project-cli.js')).projectCommand(workspace, command, rest, controller.signal)); }
    finally { process.removeListener('SIGINT', stop); }
    return;
  }
  if (command === 'repos') {
    if (rest[0] === 'list') print(workspace.config);
    else if (rest[0] === 'add') {
      if (!rest[1] || !rest[2]) throw new Error('Provide repository id and root');
      print(await workspace.exclusive(() => workspace.addRepo(rest[1]!, rest[2]!, { access: rest.includes('--read-only') ? 'read' : 'write' })));
    } else if (rest[0] === 'depends') {
      if (!rest[1]) throw new Error('Provide repository id');
      await workspace.exclusive(() => workspace.setDependencies(rest[1]!, rest.slice(2))); print(await repoGraph(workspace));
    } else throw new Error('Expected repos add, list, or depends');
  } else if (command === 'handoff') {
    if (rest[0] === 'export' && rest[1] && rest[2]) print(await exportHandoff(workspace, rest[1], JSON.parse(rest[2]) as HandoffInput));
    else if (rest[0] === 'inspect' && rest[1]) print(await inspectPortableHandoff(workspace, rest[1]));
    else if (rest[0] === 'import-pi' && rest[1]) {
      const inspection = await inspectPortableHandoff(workspace, rest[1]);
      print(await (await import('./pi-session.js')).importPiHandoff(workspace, inspection));
    } else if (rest[0] === 'codex' && rest[1]) {
      const controller = new AbortController(), stop = () => controller.abort(); process.once('SIGINT', stop);
      try {
        const at = rest.indexOf('--model'); const model = at >= 0 ? rest[at + 1] : undefined;
        if (at >= 0 && !model) throw new Error('Missing Codex model');
        const run = await (await import('./codex-handoff.js')).runCodexHandoff(workspace, rest[1], { writable: rest.includes('--write'), model, signal: controller.signal });
        print(run); if (run.report.status !== 'passed') process.exitCode = 1;
      } finally { process.removeListener('SIGINT', stop); }
    } else throw new Error('Use handoff export DESTINATION JSON, inspect DIRECTORY, import-pi DIRECTORY, or codex DIRECTORY [--write]');
  } else if (command === 'memory') {
    const memory = await MemoryStore.open(workspace);
    if (rest[0] === 'search' && rest[1]) print(await memory.search(rest.slice(1).join(' ')));
    else if (rest[0] === 'read' && rest[1]) print(await memory.read(rest[1]));
    else if (rest[0] === 'forget' && rest[1]) { await memory.forget(rest[1]); print({ id: rest[1], forgotten: true }); }
    else if (rest[0] === 'organize') print(await memory.organize());
    else if (rest[0] === 'recover') print(await memory.recover());
    else if (rest[0] === 'reindex') { const indexed = await memory.index(true); print({ refreshed: indexed.refreshed, reused: indexed.reused, duplicateGroups: indexed.duplicateGroups }); }
    else if (rest[0] === 'save' && rest[1]) {
      const input = JSON.parse(rest[1]) as MemoryInput & { replaces?: string };
      input.origin = { kind: 'user', reference: 'explicit local CLI request' };
      print(await memory.save(input, { userStated: true, replaces: input.replaces }));
    } else throw new Error('Use memory search QUERY, read ID, save JSON, or forget ID');
  } else if (command === 'graph') print(await repoGraph(workspace));
  else if (command === 'review') {
    if (!rest[0] || !rest[1]) throw new Error('Provide review baseline and goal');
    const { ModelRuntime, SettingsManager, getAgentDir } = await import('@earendil-works/pi-coding-agent');
    const agentDir = process.env.PI_CODING_AGENT_DIR ?? resolve(workspace.data, 'pi-agent');
    let configured = agentDir;
    try { await access(resolve(agentDir, 'models.json')); } catch { configured = getAgentDir(); }
    const runtime = await ModelRuntime.create({ authPath: resolve(configured, 'auth.json'), modelsPath: resolve(configured, 'models.json'), refreshOnCreate: false });
    const settings = SettingsManager.create(workspace.root, configured);
    const provider = settings.getDefaultProvider(), model = settings.getDefaultModel();
    if (!provider || !model) throw new Error('Configure a model before running independent review');
    const controller = new AbortController(), stop = () => controller.abort(); process.once('SIGINT', stop);
    try {
      const review = await (await import('./pi-review.js')).runPiReview(workspace, { baseline: rest[0], goal: rest.slice(1).join(' '), requirements: [] },
        { modelRuntime: runtime, provider, model, agentDir: configured, signal: controller.signal }); print(review);
      if (review.status !== 'completed') process.exitCode = 1;
    } finally { process.removeListener('SIGINT', stop); }
  }
  else if (command === 'contracts') print(await workspace.exclusive(() => discoverContracts(workspace, { query: rest[0] })));
  else if (command === 'plan') {
    const plans = new PlanStore(workspace);
    if (rest[0] === 'show') print(await plans.view() ?? { plan: null });
    else if (rest[0] === 'create' && rest[1]) print(await plans.view(await plans.create(JSON.parse(rest[1]) as PlanInput)));
    else if (rest[0] === 'step' && rest[1] && rest[2] && rest[3] && rest[4]) print(await plans.view(await plans.advance(rest[2], Number(rest[3]), { phase: rest[4] as PlanStep['phase'], evidence: rest[5] }, rest[1])));
    else throw new Error('Use plan show, create JSON, or step PLAN_ID STEP REVISION PHASE [EVIDENCE]');
  }
  else if (command === 'read') {
    if (!rest[0]) throw new Error('Provide source query');
    print(await workspace.exclusive(() => new ReadingStore(workspace).update(rest[0]!, { repo: rest[1] })));
  } else if (command === 'reading-open' && rest[0]) {
    print(await new ReadingStore(workspace).open(rest[0], { node: rest[1] }));
  } else if (command === 'checks' && rest[0] === 'add') {
    const split = rest.indexOf('--');
    if (!rest[1] || !rest[2] || split < 0 || !rest[split + 1]) throw new Error('Provide check id, repository id, and -- command');
    await workspace.exclusive(() => workspace.addCheck({ id: rest[1]!, repo: rest[2]!, argv: rest.slice(split + 1), joint: rest.slice(3, split).includes('--joint') }));
    print(workspace.config.checks);
  } else if (command === 'verify') {
    const controller = new AbortController(); const stop = () => controller.abort(); process.once('SIGINT', stop);
    try { const checked = await workspace.exclusive(() => workspace.verify(controller.signal)); print(checked); if (checked.status !== 'verified') process.exitCode = 1; }
    finally { process.removeListener('SIGINT', stop); }
  } else if (command === 'connect' && rest[0] === 'gateway') {
    const value = (name: string) => { const at = rest.indexOf(name); if (at < 0) return undefined; if (!rest[at + 1]) throw new Error(`Missing value for ${name}`); return rest[at + 1]; };
    const dir = await workspace.exclusive(() => configureGateway(workspace.data, { model: value('--model'), baseUrl: value('--base-url') }));
    print({ provider: 'gateway', api: 'openai-responses', configuration: dir });
  } else if (command === 'checkpoint') print(await workspace.exclusive(() => workspace.checkpoint(rest.join(' ') || 'manual')));
  else if (command === 'timeline') print(await workspace.checkpoints());
  else if (command === 'compare') { if (!rest[0] || !rest[1]) throw new Error('Provide left and right ids'); print(await workspace.exclusive(() => compareSolutions(workspace, rest[0]!, rest[1]!))); }
  else if (command === 'restore-preview') { if (!rest[0] || !rest[1]) throw new Error('Provide target and expected ids'); print(await workspace.exclusive(() => previewRestore(workspace, rest[0]!, rest[1]!))); }
  else if (command === 'restore') { if (!rest[0] || !rest[1]) throw new Error('Provide target and expected current ids'); print(await workspace.exclusive(() => workspace.restore(rest[0]!, rest[1]!))); }
  else if (command === 'fork') {
    if (!rest[0] || !rest[1]) throw new Error('Provide checkpoint id and a new destination directory');
    const checkpoint = await workspace.loadCheckpoint(rest[0]);
    const handoff = checkpoint.session ? await (await import('./pi-session.js')).loadPiForkHandoff(workspace, checkpoint) : undefined;
    const fork = await workspace.exclusive(() => workspace.forkCheckpoint(rest[0]!, rest[1]!, handoff)); print({ workspace: fork.root, repos: fork.config.repos });
    if (checkpoint.session && checkpoint.entry) print(await (await import('./pi-session.js')).seedPiCodeFork(workspace, fork, checkpoint));
  }
  else if (command === 'operations') print(await workspace.operations());
  else if (command === 'changes' && rest[0]) print(await workspace.exclusive(() => observeChanges(workspace, rest[0]!)));
  else if (command === 'recover') print(await workspace.recover());
  else if (command === 'acknowledge') {
    if (!rest[0] || !rest[1]) throw new Error('Provide operation id and an observation of actual effects');
    await workspace.exclusive(() => workspace.acknowledgeOperation(rest[0]!, rest.slice(1).join(' ')));
    print({ operation: rest[0], acknowledged: true });
  }
  else if (command === 'agent') {
    const memoryAt = rest.indexOf('--memory');
    const memory = memoryAt >= 0 && (rest.indexOf('--') < 0 || memoryAt < rest.indexOf('--'));
    if (memory) rest.splice(memoryAt, 1);
    const observerAt = rest.indexOf('--observe');
    const observe = observerAt >= 0 && (rest.indexOf('--') < 0 || observerAt < rest.indexOf('--'));
    if (observe) rest.splice(observerAt, 1);
    let approval = 'ask'; const separator = rest.indexOf('--');
    const optionEnd = separator < 0 ? rest.length : separator;
    const ai = rest.slice(0, optionEnd).indexOf('--approval');
    if (ai >= 0) { approval = rest[ai + 1] ?? ''; rest.splice(ai, 2); }
    if (!['ask', 'auto', 'never'].includes(approval)) throw new Error('Invalid approval policy');
    if (!workspace.config.repos.length) throw new Error('Register at least one repository with repos add');
    const pi = resolve(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))), 'bundle/cli.js');
    const extension = fileURLToPath(new URL('./pi-extension.js', import.meta.url));
    const runDirectory = resolve(workspace.data, 'runs', randomUUID()); await mkdir(runDirectory, { recursive: true });
    const runReport = resolve(runDirectory, 'status.json');
    let agentDir = process.env.PI_CODING_AGENT_DIR;
    if (!agentDir) {
      const local = resolve(workspace.data, 'pi-agent');
      try { await access(resolve(local, 'models.json')); agentDir = local; }
      catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
    }
    const extraExtensions = ['--extension', fileURLToPath(new URL('./pi-handoff.js', import.meta.url)), '--extension', fileURLToPath(new URL('./pi-review.js', import.meta.url)), '--extension', fileURLToPath(new URL('./pi-project.js', import.meta.url)), '--extension', fileURLToPath(new URL('./pi-runtime.js', import.meta.url)), '--extension', fileURLToPath(new URL('./pi-delivery.js', import.meta.url))];
    extraExtensions.push('--extension', fileURLToPath(new URL('./pi-reuse.js', import.meta.url)));
    extraExtensions.push('--extension', fileURLToPath(new URL('./pi-collaboration.js', import.meta.url)));
    extraExtensions.push('--extension', fileURLToPath(new URL('./pi-learning.js', import.meta.url)));
    if (observe) extraExtensions.push('--extension', fileURLToPath(new URL('./pi-observer.js', import.meta.url)));
    if (memory) extraExtensions.push('--extension', fileURLToPath(new URL('./pi-memory.js', import.meta.url)));
    if (!rest.includes('--session') && !rest.includes('--continue') && !rest.includes('-c') && !rest.includes('--resume') && !rest.includes('-r')) {
      try {
        const startup = await readJson<{ schema: number; sessionFile: string }>(resolve(workspace.data, 'session-start.json'));
        if (startup.schema !== 1) throw new Error('Invalid native fork session-start record');
        await access(startup.sessionFile); rest.unshift('--session', startup.sessionFile);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    const child = spawn(process.execPath, [pi, '--extension', extension, ...extraExtensions, ...rest], {
      cwd: workspace.root, stdio: 'inherit', env: { ...process.env, ...(agentDir ? { PI_CODING_AGENT_DIR: agentDir } : {}), ...(observe ? { ENIGMA_OBSERVER: '1' } : {}), ...(memory ? { ENIGMA_MEMORY: '1' } : {}), ENIGMA_WORKSPACE: workspace.root, ENIGMA_APPROVAL: approval, ENIGMA_MANAGED: '1', ENIGMA_RUN_REPORT: runReport },
    });
    const forward = (signal: NodeJS.Signals) => child.kill(signal);
    const int = () => forward('SIGINT'), term = () => forward('SIGTERM');
    process.on('SIGINT', int); process.on('SIGTERM', term);
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject); child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 130 : 1); resolve(); });
    });
    process.removeListener('SIGINT', int); process.removeListener('SIGTERM', term);
    if (!process.exitCode && workspace.config.checks.length) {
      let verification = 'unverified';
      try { verification = (await readJson<{ verification: string }>(runReport)).verification; }
      catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        // Opening and closing the interactive UI without starting a task is not a failed task.
        if (!rest.includes('--print') && !rest.includes('-p')) return;
      }
      if (verification !== 'verified') { console.error(`Task verification: ${verification}`); process.exitCode = 1; }
    }
  } else throw new Error('Unknown command; use --help');
}

main(process.argv.slice(2)).catch(error => { console.error(String(error)); process.exitCode = 1; });
