import { join } from 'node:path';
import { ensureDir, readJson, writeJson } from './storage.js';

export async function configureGateway(dataDir: string, options: { baseUrl?: string; model?: string } = {}): Promise<string> {
  const dir = await ensureDir(join(dataDir, 'pi-agent'));
  const baseUrl = options.baseUrl ?? 'http://127.0.0.1:8790/v1';
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP(S) gateway URL without embedded credentials');
  const model = options.model ?? 'gateway-gpt-6-1-sol';
  if (!/^[a-zA-Z0-9._:[\]-]+$/.test(model)) throw new Error('Invalid model id');
  const modelsPath = join(dir, 'models.json'), settingsPath = join(dir, 'settings.json');
  const load = async (path: string): Promise<Record<string, unknown>> => {
    try {
      const value = await readJson<Record<string, unknown>>(path);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Model configuration must be a JSON object');
      return value;
    }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; return {}; }
  };
  const models = await load(modelsPath), settings = await load(settingsPath);
  const providers = (models.providers ?? {}) as Record<string, unknown>;
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) throw new Error('Provider configuration must be a JSON object');
  providers.gateway = { baseUrl: baseUrl.replace(/\/$/, ''), api: 'openai-responses', apiKey: 'gateway',
    models: [{ id: model, name: model, reasoning: true, input: ['text', 'image'],
      // Only the default model's limits were verified against this gateway.
      contextWindow: model === 'gateway-gpt-6-1-sol' ? 475_000 : 32_768,
      maxTokens: model === 'gateway-gpt-6-1-sol' ? 32_000 : 4096 }] };
  models.providers = providers;
  await writeJson(modelsPath, models);
  await writeJson(settingsPath, { ...settings, defaultProvider: 'gateway', defaultModel: model });
  return dir;
}
