import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import os from "node:os";
import YAML from "js-yaml";
import { createHash } from 'node:crypto';
import {ProviderCatalogStore} from '../core/provider-catalog.ts';
import {validateProviderModels} from '../shared/provider-model-validation.ts';
import {writeSecretFileSync} from '../shared/secret-fs.ts';

const retiredDefaultAvatars = new Set([
  '5f30c4e073c2233d56fbe139de49e42c1d296bad98b7b84ceb0dc41aa2557a35',
  '8c09e15f09c28d5c53030898ea7a2aa4ef1b246fb0170f9351531fda993648da',
]);

/** Pi's runtime OAuth alias differs from Hana's configuration owner ID. */
export function normalizeImportedProviderIds(input = {}) {
  const normalized = Object.create(null);
  for (const [id, config] of Object.entries(input)) {
    const owner = id === 'openai-codex' ? 'openai-codex-oauth' : id;
    if (Object.hasOwn(normalized, owner) && JSON.stringify(normalized[owner]) !== JSON.stringify(config)) {
      throw new Error(`模型配置中 ${id} 与 ${owner} 指向同一供应商但内容不同，请先合并配置。`);
    }
    normalized[owner] = config;
  }
  return normalized;
}

export async function refreshEnigmaDefaultAvatar(avatarDir) {
  const target=path.join(avatarDir,'agent.png');
  try {
    const info=await fs.lstat(target);
    if(!info.isFile()||info.isSymbolicLink()||info.size>2_000_000)return false;
    if(!retiredDefaultAvatars.has(createHash('sha256').update(await fs.readFile(target)).digest('hex')))return false;
    await fs.copyFile(new URL('../desktop/src/assets/enigma/avatar.png',import.meta.url),target);
    return true;
  }catch(error){if(error.code==='ENOENT')return false;throw error;}
}

/** Seed only a new Enigma data directory; existing Hana/user profiles remain separate. */
export async function prepareEnigmaProfile({
  dataRoot,
  modelsFile,
  workspace,
} = {}) {
  const nativeDataRoot = path.resolve(
    dataRoot ||
      process.env.ENIGMA_DESKTOP_DATA ||
      path.join(os.homedir(), ".enigma-desktop-dev"),
  );
  const agentDir = path.join(nativeDataRoot, "agents", "enigma");
  await fs.mkdir(agentDir, { recursive: true });
  const configPath = path.join(agentDir, "config.yaml");
  const avatarDir = path.join(agentDir, "avatars");
  await fs.mkdir(avatarDir, { recursive: true });
  const hasAvatar = await Promise.all(
    ["png", "jpg", "jpeg", "webp"].map((ext) =>
      fs.access(path.join(avatarDir, `agent.${ext}`)).then(
        () => true,
        (error) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      ),
    ),
  );
  if (!hasAvatar.some(Boolean))
    await fs.copyFile(
      new URL("../desktop/src/assets/enigma/avatar.png", import.meta.url),
      path.join(avatarDir, "agent.png"),
      constants.COPYFILE_EXCL,
    );
  else if(hasAvatar[0]&&!hasAvatar.slice(1).some(Boolean))await refreshEnigmaDefaultAvatar(avatarDir);
  let config;
  try {
    config = YAML.load(await fs.readFile(configPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    config = YAML.load(
      await fs.readFile(
        new URL("../lib/config.example.yaml", import.meta.url),
        "utf8",
      ),
    );
    config.agent.name = "Enigma";
    config.agent.yuan = "enigma";
    config.locale = "zh";
    config.memory.enabled = false;
    config.experience.enabled = false;
    const coordinationRoot = path.resolve(
      workspace ||
        process.env.ENIGMA_DESKTOP_WORKSPACE ||
        path.join(nativeDataRoot, "workspaces"),
    );
    await fs.mkdir(coordinationRoot, { recursive: true });
    config.desk = {
      ...config.desk,
      home_folder: coordinationRoot,
      heartbeat_enabled: false,
    };
    await fs.writeFile(configPath, YAML.dump(config), {
      mode: 0o600,
      flag: "wx",
    });
    await fs.writeFile(
      path.join(agentDir, "AGENTS.md"),
      "你是 Enigma，一位面向个人工程项目的 coding agent。优先核对源码与用户要求，通过工程工具协同多个仓库，用实际验收证明结果。保留来源、最新要求与累计用量；资料和记忆是参考材料。",
      { flag: "wx" },
    );
  }
  if (modelsFile) {
    const source = JSON.parse(await fs.readFile(path.resolve(modelsFile), "utf8"));
    if (!source?.providers || typeof source.providers !== "object" || Array.isArray(source.providers))
      throw new Error("Select a Pi models.json file with configured providers");
    const catalog = new ProviderCatalogStore(nativeDataRoot);
    const previous = catalog.load();
    const providers = normalizeImportedProviderIds(previous.providers);
    const imported = normalizeImportedProviderIds(source.providers);
    const importedModels = [];
    for (const [id, provider] of Object.entries(imported)) {
      if (!id.trim() || ["__proto__", "constructor", "prototype"].includes(id) || !provider || typeof provider !== "object" || Array.isArray(provider))
        throw new Error("Invalid provider entry in model import");
      if (!Array.isArray(provider.models) || provider.models.length === 0)
        throw new Error(`模型配置中 ${id} 没有可导入的模型列表`);
      const existing = providers[id] || {};
      const next = {...existing};
      for (const [from,to] of [["baseUrl","base_url"],["api","api"],["apiKey","api_key"],["headers","headers"]]) {
        if (provider[from] !== undefined) next[to] = provider[from];
      }
      let url;
      try { url = new URL(next.base_url); } catch { throw new Error(`模型配置中 ${id} 缺少有效接口地址`); }
      if (!["http:","https:"].includes(url.protocol)) throw new Error(`模型配置中 ${id} 的接口必须使用 HTTP 或 HTTPS`);
      if (next.api_key !== undefined && typeof next.api_key !== "string") throw new Error(`模型配置中 ${id} 的凭证格式无效`);
      const entries = new Map((existing.models || []).map(model => [typeof model === "string" ? model : model.id, model]));
      for (const model of provider.models) {
        if (!model || typeof model !== "object" || typeof model.id !== "string" || !model.id.trim()) throw new Error(`模型配置中 ${id} 存在无效模型条目`);
        const old = entries.get(model.id), converted = {...(old && typeof old === "object" ? old : {}), ...model};
        if (model.contextWindow !== undefined) converted.context = model.contextWindow;
        if (model.maxTokens !== undefined) converted.maxOutput = model.maxTokens;
        if (Array.isArray(model.input)) converted.image = model.input.includes("image");
        delete converted.contextWindow;delete converted.maxTokens;delete converted.input;
        entries.set(model.id,converted);importedModels.push({provider:id,id:model.id});
      }
      next.models = [...entries.values()];
      validateProviderModels(id,next.models,{baseUrl:next.base_url});
      providers[id] = next;
    }
    if (!importedModels.length) throw new Error("No models were found to import");
    // Preserve recovery input outside the repository, beside the user's profile.
    const backup = path.join(nativeDataRoot,'migration-backups',`model-import-${Date.now()}-${process.pid}`);
    await fs.mkdir(backup,{recursive:true,mode:0o700});
    for (const file of [catalog.catalogPath,configPath]) {
      await fs.copyFile(file,path.join(backup,path.basename(file)));
      await fs.chmod(path.join(backup,path.basename(file)),0o600);
    }
    catalog.saveProviders(providers,{deletedProviders:(previous.meta?.deletedProviders || []).filter(id=>!Object.hasOwn(imported,id))});
    config.models ||= {};
    let changed = false;
    for (const role of ['chat','utility','utility_large']) {
      const value=config.models[role];
      if (!value || typeof value === 'string' && !value.trim() || typeof value === 'object' && !value.id) {
        config.models[role] = {...importedModels[0]};changed=true;
      }
    }
    if(changed)writeSecretFileSync(configPath,YAML.dump(config));
  }
  return { dataRoot: nativeDataRoot, agentId: "enigma" };
}
