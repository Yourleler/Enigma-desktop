import { join } from 'node:path';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { hash, readJson, writeJson } from './storage.js';
export interface CatalogModel {
    id: string;
    display_name?: string;
    max_input_tokens?: number;
    max_tokens?: number;
    capabilities?: {
        image_input?: {
            supported?: boolean;
        };
        effort?: Record<string, {
            supported?: boolean;
        } | boolean>;
        thinking?: {
            supported?: boolean;
        };
    };
}
const levels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
/** Discover only the user's already configured local Gateway gateway, preserving exact gateway model IDs. */
export async function syncGatewayModels(agentDir: string, runtime: ModelRuntime) {
    const path = join(agentDir, 'models.json'), config = await readJson<{
        providers?: Record<string, Record<string, unknown>>;
    }>(path);
    const gateway = config.providers?.gateway;
    if (!gateway || typeof gateway.baseUrl !== 'string')
        throw new Error('当前 Pi 配置没有 Gateway 后端。请先连接已有 Gateway 网关。');
    const url = new URL(gateway.baseUrl);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password)
        throw new Error('模型发现仅使用已配置的本机 Gateway 网关。');
    const response = await fetch(new URL(url.pathname.replace(/\/$/, '') + '/models', url.origin), { signal: AbortSignal.timeout(10000), redirect: 'error' });
    if (!response.ok)
        throw new Error(`Gateway 模型目录读取失败（${response.status}），已有模型保留。`);
    const text = await response.text();
    if (text.length > 1000000)
        throw new Error('模型目录超过读取预算。');
    const body = JSON.parse(text) as {
        data?: CatalogModel[];
    };
    if (!Array.isArray(body.data) || !body.data.length || body.data.length > 200 || new Set(body.data.map(m => m.id)).size !== body.data.length || body.data.some(m => !m.id || !/^[a-zA-Z0-9._:[\]-]+$/.test(m.id)))
        throw new Error('Gateway 返回了无法使用的模型目录。');
    const models = body.data.map(m => {
        if (!Number.isSafeInteger(m.max_input_tokens) || !Number.isSafeInteger(m.max_tokens) || m.max_input_tokens! < 1000 || m.max_input_tokens! > 2000000 || m.max_tokens! < 1 || m.max_tokens! > 256000)
            throw new Error('模型目录缺少有效的输入/输出限制。');
        const supported = levels.filter(level => (m.capabilities?.effort?.[level === 'off' ? 'none' : level] as {
            supported?: boolean;
        })?.supported);
        return { id: m.id, name: m.display_name ?? m.id, reasoning: !!m.capabilities?.effort?.supported || !!m.capabilities?.thinking?.supported,
            thinkingLevelMap: Object.fromEntries(levels.map(level => [level, supported.includes(level) ? level : null])),
            compat: { forceAdaptiveThinking: !!m.capabilities?.effort?.supported },
            input: m.capabilities?.image_input?.supported ? ['text', 'image'] : ['text'], contextWindow: m.max_input_tokens!, maxTokens: m.max_tokens!, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    });
    // /v1/models advertises the Messages-compatible IDs. Keep the existing Responses model/provider intact.
    const provider = { baseUrl: url.origin, api: 'anthropic-messages', apiKey: 'gateway', models };
    if (hash(JSON.stringify(await readJson(path))) !== hash(JSON.stringify(config)))
        throw new Error('读取期间模型配置已更改，请重新刷新。');
    const previous = runtime.getRegisteredProviderConfig('gateway-catalog');
    runtime.registerProvider('gateway-catalog', provider as Parameters<ModelRuntime['registerProvider']>[1]);
    try {
        await runtime.refresh({ allowNetwork: false });
        await writeJson(path, { ...config, providers: { ...config.providers, 'gateway-catalog': provider } });
    }
    catch (error) {
        runtime.unregisterProvider('gateway-catalog');
        if (previous)
            runtime.registerProvider('gateway-catalog', previous);
        throw error;
    }
    return { count: models.length, at: new Date().toISOString(), provider: 'gateway-catalog', note: '模型能力来自本机网关目录，原登录与默认模型保留。网关未提供计费价格，显示的零价格不代表实际费用。' };
}
