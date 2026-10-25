import { readObserverStatus } from './observer.js';

/** Independent deterministic questions. Optional model expansion gets no tools and a bounded snapshot. */
export async function askObserver(root: string, question: string, options: { id?: string; session?: string; explain?: (snapshot: string, question: string, signal: AbortSignal) => Promise<string>; signal?: AbortSignal; timeoutMs?: number } = {}) {
  if (!question.trim() || question.length > 500) throw new Error('Provide a short runtime question');
  const status = await readObserverStatus(root, options.id, options.session);
  if (!status.available) return { question, answer: status.reason, available: false, usedModel: false };
  let answer: string;
  if (/卡|停|活|still|stuck|alive/i.test(question)) answer = `来源进程：${status.sourceProcess.liveness}；观测：${status.observation}。${status.explanations.join(' ')}`;
  else if (/进展|意义|progress|useful/i.test(question)) answer = status.lastProgress
    ? `最近可回查的证据变化：${status.lastProgress.stage} ${status.lastProgress.reference}。必须结合当前任务判断相关性；事件流和 CPU 不证明任务完成。`
    : '没有记录可回查的源码或验收进展。当前无法确认是否在做有意义的工作；响应流和心跳仅表明活动。';
  else if (/重复|循环|重试|retry|repeat/i.test(question)) {
    const retries = status.recent.filter(event => event.stage === 'provider.retry');
    answer = [...status.signals.map(signal => `${signal.type}：${signal.count} 次，${signal.detail}`), ...retries.map(event => event.detail ?? 'Observed provider retry')].join('\n')
      || '没有观察到达到阈值的重复行为；事件镜像有界，不代表所有历史均已检查。';
  }
  else answer = status.explanations.join('\n');
  if (!options.explain) return { question, answer, available: true, usedModel: false, status };
  const controller = new AbortController(), abort = () => controller.abort(); options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, options.timeoutMs ?? 20000);
  try {
    if (options.signal?.aborted) controller.abort();
    const snapshot = JSON.stringify({ capturedAt: new Date().toISOString(), state: status.state, process: status.sourceProcess, observation: status.observation,
      stages: status.stages, lastProgress: status.lastProgress, signals: status.signals, explanations: status.explanations, evidencePath: status.evidencePath }).slice(0, 16000);
    const cancelled = new Promise<never>((_resolve, reject) => { if (controller.signal.aborted) reject(new Error('Explanation cancelled')); else controller.signal.addEventListener('abort', () => reject(new Error('Explanation cancelled')), { once: true }); });
    const explanation = await Promise.race([options.explain(snapshot, question, controller.signal), cancelled]);
    return { question, answer: explanation.slice(0, 6000), available: true, usedModel: true, deterministicAnswer: answer, status, note: 'Model interpretation of a captured snapshot; no access to hidden reasoning or main run controls.' };
  } catch { return { question, answer, available: true, usedModel: false, explanationUnavailable: true, status }; }
  finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', abort); }
}
