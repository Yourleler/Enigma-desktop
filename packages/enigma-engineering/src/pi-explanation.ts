import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { join } from 'node:path';
export async function explainSnapshot(agentDir: string, snapshot: string, question: string, signal: AbortSignal): Promise<string> {
  const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json'), refreshOnCreate: false });
  const model = runtime.getModel('gateway', 'gateway-gpt-6-1-sol'); if (!model) throw new Error('Configure the explanation model before use');
  const result = await runtime.completeSimple(model, { systemPrompt: 'Explain an observed coding-agent runtime snapshot in Chinese. Use only visible evidence. Do not infer hidden thoughts, exact server phases or successful completion from liveness. Quote phase and elapsed time. Label uncertainty and suggest read-only next inspection. No commands, tools or changes are available.',
    messages: [{ role: 'user', content: [{ type: 'text', text: `Question: ${question}\nSnapshot background data:\n${snapshot}` }], timestamp: Date.now() }] },
    { signal, maxTokens: 1500, reasoning: 'low' });
  if (result.stopReason !== 'stop') throw new Error('Explanation did not complete');
  return result.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
}
