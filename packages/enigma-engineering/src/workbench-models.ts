import { join } from 'node:path';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { hash, readJson, writeJson } from './storage.js';

/** Standard compatible /models discovery for a configured local gateway.
 * Existing authentication, protocol and model metadata remain authoritative.
 */
export async function syncGatewayModels(agentDir: string, runtime: ModelRuntime, providerId?: string) {
  const path = join(agentDir, 'models.json');
  const config = await readJson<{providers?:Record<string, Record<string, any>>}>(path);
  const configured = Object.entries(config.providers ?? {});
  const selected = providerId ? configured.find(([id]) => id === providerId) : configured.find(([, provider]) => {
    try { return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(provider.baseUrl).hostname); } catch { return false; }
  });
  if (!selected) throw new Error('请先配置本机兼容 API 网关。');
  const [id, existing] = selected;
  const url = new URL(existing.baseUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password)
    throw new Error('模型发现仅使用已配置的本机网关。');
  const headers = new Headers(existing.headers ?? {});
  if (typeof existing.apiKey === 'string' && existing.apiKey) {
    const key = process.env[existing.apiKey] || existing.apiKey;
    if (existing.api === 'anthropic-messages') { headers.set('x-api-key', key); headers.set('anthropic-version', '2023-06-01'); }
    else headers.set('Authorization', `Bearer ${key}`);
  }
  const basePath = url.pathname.replace(/\/$/, '') || '/v1';
  const response = await fetch(new URL(basePath + '/models', url.origin), { headers, signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!response.ok) throw new Error(`模型目录读取失败（${response.status}），已有模型保留。`);
  const text = await response.text();
  if (text.length > 1_000_000) throw new Error('模型目录超过读取预算。');
  const body = JSON.parse(text) as {data?:{id:string}[]};
  if (!Array.isArray(body.data) || !body.data.length || body.data.length > 200
    || body.data.some(model => typeof model.id !== 'string' || !/^[a-zA-Z0-9._:[\]-]+$/.test(model.id))
    || new Set(body.data.map(model => model.id)).size !== body.data.length)
    throw new Error('网关返回了无法使用的模型目录。');
  const models = [...(Array.isArray(existing.models) ? existing.models : [])];
  for (const model of body.data) if (!models.some(saved => saved.id === model.id)) {
    models.push({ id: model.id, name: model.id, reasoning: false, input: ['text'], contextWindow: 32768, maxTokens: 4096, cost: {input:0,output:0,cacheRead:0,cacheWrite:0} });
  }
  const provider = {...existing, models};
  if (hash(JSON.stringify(await readJson(path))) !== hash(JSON.stringify(config))) throw new Error('读取期间模型配置已更改，请重新刷新。');
  const previous = runtime.getRegisteredProviderConfig(id);
  runtime.registerProvider(id, provider as Parameters<ModelRuntime['registerProvider']>[1]);
  try {
    await runtime.refresh({allowNetwork:false});
    await writeJson(path, {...config, providers:{...config.providers,[id]:provider}});
  } catch (error) {
    runtime.unregisterProvider(id);
    if (previous) runtime.registerProvider(id,previous);
    throw error;
  }
  return {count:body.data.length,at:new Date().toISOString(),provider:id,note:'保留原认证、协议及已配置模型；新模型使用保守默认限制，请按服务文档核对能力与价格，SDK 占位价格不代表免费。'};
}
