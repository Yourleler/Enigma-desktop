import { join } from 'node:path';
import { ensureDir, readJson, writeJson } from './storage.js';

export async function configureGateway(dataDir: string, options: { baseUrl?: string; model?: string; apiKey?: string; contextWindow?: number; maxTokens?: number } = {}): Promise<string> {
  const dir = await ensureDir(join(dataDir, 'pi-agent'));
  const baseUrl = options.baseUrl ?? process.env.ENIGMA_GATEWAY_URL;
  if (!baseUrl) throw new Error('Provide --base-url or ENIGMA_GATEWAY_URL');
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP(S) gateway URL without embedded credentials');
  const model = options.model ?? process.env.ENIGMA_GATEWAY_MODEL;
  if (!model) throw new Error('Provide --model or ENIGMA_GATEWAY_MODEL');
  const apiKey = options.apiKey ?? process.env.ENIGMA_GATEWAY_API_KEY ?? 'not-required';
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
  providers.gateway = { baseUrl: baseUrl.replace(/\/$/, ''), api: 'openai-responses', apiKey,
    models: [{ id: model, name: model, reasoning: false, input: ['text', 'image'],
      // Generic defaults are conservative; callers may supply provider limits.
      contextWindow: options.contextWindow ?? 32_768,
      maxTokens: options.maxTokens ?? 4096 }] };
  models.providers = providers;
  await writeJson(modelsPath, models);
  await writeJson(settingsPath, { ...settings, defaultProvider: 'gateway', defaultModel: model });
  return dir;
}
