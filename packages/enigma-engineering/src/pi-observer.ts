import { randomUUID } from 'node:crypto';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { RunObserver, readObserverStatus } from './observer.js';
import { hash } from './storage.js';
import { telemetryChannel, telemetryStateChannel, type ActivityEvent } from './telemetry.js';

export function createObserverExtension(options: { enabled?: boolean; heartbeatMs?: number; root?: string } = {}) {
  return (pi: ExtensionAPI): void => {
    pi.registerFlag('enigma-observe', { description: 'Mirror run activity for independent status queries', type: 'boolean', default: false });
    let observer: RunObserver | undefined, root = '', runId = '', modelId = '', streamId = '', lastOutcome = 'completed', streaming = false, lastProviderError: number | string | undefined;
    let unsubscribe: (() => void) | undefined;
    const secrets = Object.entries(process.env).filter(([name]) => /KEY|TOKEN|SECRET|PASSWORD/.test(name)).map(([, value]) => value ?? '').filter(value => value.length >= 8);
    const record = (event: ActivityEvent) => observer?.record(event);
    pi.on('session_start', async (_event, ctx) => {
      unsubscribe?.(); unsubscribe = undefined;
      if (observer) { await boundedFlush(observer.close()); observer = undefined; }
      root = options.root ?? process.env.ENIGMA_WORKSPACE ?? ctx.cwd;
      if (!(options.enabled ?? (pi.getFlag('enigma-observe') === true || process.env.ENIGMA_OBSERVER === '1'))) return;
      try {
        observer = await RunObserver.create(root, ctx.sessionManager.getSessionId(), { sessionFile: ctx.sessionManager.getSessionFile() ?? undefined, secrets, heartbeatMs: options.heartbeatMs });
        unsubscribe = pi.events.on(telemetryChannel, data => {
          if (data && typeof data === 'object' && ['start', 'end', 'update', 'fact'].includes((data as ActivityEvent).kind) && typeof (data as ActivityEvent).stage === 'string') record(data as ActivityEvent);
        });
        pi.events.emit(telemetryStateChannel, true);
        ctx.ui.setStatus('enigma-observer', `observer ${observer.state.id.slice(0, 8)}`);
      } catch { ctx.ui.notify('Run observer is unavailable; main task execution is unchanged.', 'warning'); }
    });
    const boundedFlush = async (pending: Promise<void> | undefined) => {
      if (!pending) return;
      let timer: NodeJS.Timeout | undefined;
      try { await Promise.race([pending, new Promise<void>(resolve => { timer = setTimeout(resolve, 250); timer.unref(); })]); }
      finally { if (timer) clearTimeout(timer); }
    };
    pi.on('session_shutdown', async () => { pi.events.emit(telemetryStateChannel, false); unsubscribe?.(); unsubscribe = undefined; await boundedFlush(observer?.close()); observer = undefined; });
    pi.on('before_agent_start', () => {
      runId = randomUUID(); lastOutcome = 'completed'; lastProviderError = undefined;
      record({ kind: 'start', stage: 'run', id: runId }); record({ kind: 'start', stage: 'context', id: `${runId}:context`, parent: runId });
    });
    pi.on('before_provider_request', () => {
      streaming = false;
      record({ kind: 'end', stage: 'settling', id: `${runId}:settling` });
      record({ kind: 'end', stage: 'context', id: `${runId}:context` });
      // Baseline capture hooks might delay actual dispatch. This means preparing/waiting, not proof the server received it.
      modelId = randomUUID(); streamId = `${modelId}:stream`;
      if (lastProviderError !== undefined) {
        record({ kind: 'fact', stage: 'provider.retry', reference: modelId, detail: `Another provider request after observed provider failure ${lastProviderError}. This shows a retry attempt, not its success.` });
        lastProviderError = undefined;
      }
      record({ kind: 'start', stage: 'model', id: modelId, parent: runId, detail: 'Provider request prepared; waiting for a visible response. Server receipt and internal phases are unknown.' });
    });
    pi.on('after_provider_response', event => {
      lastProviderError = event.status >= 400 ? event.status : undefined;
      record({ kind: 'end', stage: 'model', id: modelId, status: String(event.status) });
      streaming = true;
      record({ kind: 'start', stage: 'model.stream', id: streamId, parent: runId, detail: `Provider response status ${event.status}` });
    });
    pi.on('message_update', event => {
      if (event.message.role !== 'assistant') return;
      record({ kind: 'end', stage: 'model', id: modelId });
      if (!streaming) { record({ kind: 'start', stage: 'model.stream', id: streamId, parent: runId }); streaming = true; }
      record({ kind: 'update', stage: 'model.stream', id: streamId, parent: runId, count: 1 });
    });
    pi.on('message_end', event => {
      if (event.message.role !== 'assistant') return;
      record({ kind: 'end', stage: 'model.stream', id: streamId });
      if (event.message.stopReason === 'error') {
        lastProviderError = 'assistant error response';
        record({ kind: 'end', stage: 'model', id: modelId, status: 'failed' });
      }
    });
    pi.on('tool_execution_start', event => record({ kind: 'start', stage: 'tool', id: event.toolCallId, parent: event.parentToolCallId ?? runId,
      repo: typeof event.args?.repo === 'string' ? event.args.repo : undefined, detail: event.toolName }));
    pi.on('tool_execution_update', event => record({ kind: 'update', stage: 'tool', id: event.toolCallId, count: 1 }));
    pi.on('tool_execution_end', event => {
      record({ kind: 'end', stage: 'tool', id: event.toolCallId, durationMs: event.durationMs, status: event.isError ? 'failed' : 'completed', detail: event.toolName });
      if (event.isError) record({ kind: 'fact', stage: 'tool.failed', reference: event.toolName, fingerprint: hash(JSON.stringify(event.result?.content ?? event.toolName)), detail: `${event.toolName} returned an error; inspect its original tool result.` });
      const data = event.result?.structuredContent ?? event.result?.details;
      if (!event.isError && event.toolName === 'repo_read' && data?.hash) record({ kind: 'fact', stage: 'source.read', reference: `${data.repo}:${data.file}`, fingerprint: `${data.repo}:${data.file}:${data.hash}`, detail: 'Source content was read; task relevance still needs interpretation.' });
      if (!event.isError && event.toolName === 'code_trace' && Array.isArray(data?.sources)) for (const source of data.sources.slice(0, 160)) record({ kind: 'fact', stage: 'source.read', reference: `${source.repo}:${source.file}`, fingerprint: `${source.repo}:${source.file}:${source.hash}`, detail: 'Source inspected during static code analysis.' });
      if (!event.isError && event.toolName === 'workspace_verify' && data?.status === 'verified') record({ kind: 'fact', stage: 'check.passed', reference: data.evidence, fingerprint: data.evidence, detail: 'Registered checks passed against their captured source/configuration/environment.' });
    });
    pi.on('ui_prompt_start', event => record({ kind: 'start', stage: 'approval', id: `${runId}:ui`, parent: runId, detail: event.kind }));
    pi.on('ui_prompt_end', () => record({ kind: 'end', stage: 'approval', id: `${runId}:ui` }));
    pi.on('session_before_compact', () => record({ kind: 'start', stage: 'compaction', id: `${runId}:compact`, parent: runId }));
    pi.on('session_compact', () => record({ kind: 'end', stage: 'compaction', id: `${runId}:compact`, status: 'completed' }));
    pi.on('session_compact_failed', () => record({ kind: 'end', stage: 'compaction', id: `${runId}:compact`, status: 'failed' }));
    pi.on('agent_before_settle', event => { lastOutcome = event.outcome; record({ kind: 'start', stage: 'settling', id: `${runId}:settling`, parent: runId }); });
    pi.on('agent_settled', async event => {
      record({ kind: 'end', stage: 'settling', id: `${runId}:settling` });
      record({ kind: 'end', stage: 'run', id: runId, status: event.aborted ? 'aborted' : lastOutcome }); await boundedFlush(observer?.flush());
    });
    pi.registerCommand('enigma-status', { description: 'Read observer state without waiting for the main agent or acquiring a workspace lock', async handler(_args, ctx) {
      ctx.ui.notify(JSON.stringify(await readObserverStatus(root, observer?.state.id), null, 2), 'info');
    } });
  };
}

export default createObserverExtension();
