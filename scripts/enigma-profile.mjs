import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import YAML from 'js-yaml';

/** Seed only a new Enigma data directory; existing Hana/user profiles remain separate. */
export async function prepareEnigmaProfile({ dataRoot, modelsFile, workspace } = {}) {
  const nativeDataRoot = path.resolve(dataRoot || process.env.ENIGMA_DESKTOP_DATA || path.join(os.homedir(),'.enigma-desktop-dev'));
  const agentDir = path.join(nativeDataRoot,'agents','enigma');
  await fs.mkdir(agentDir,{recursive:true});
  const configPath=path.join(agentDir,'config.yaml');
  const avatarDir=path.join(agentDir,'avatars');
  await fs.mkdir(avatarDir,{recursive:true});
  const hasAvatar=await Promise.all(['png','jpg','jpeg','webp'].map(ext=>fs.access(path.join(avatarDir,`agent.${ext}`)).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;})));
  if(!hasAvatar.some(Boolean))await fs.copyFile(new URL('../desktop/src/assets/enigma/avatar.png',import.meta.url),path.join(avatarDir,'agent.png'),constants.COPYFILE_EXCL);
  let config;
  try { config=YAML.load(await fs.readFile(configPath,'utf8')); }
  catch(error) {
    if(error.code!=='ENOENT')throw error;
    config=YAML.load(await fs.readFile(new URL('../lib/config.example.yaml',import.meta.url),'utf8'));
    config.agent.name='Enigma';config.locale='zh';config.memory.enabled=false;config.experience.enabled=false;
    const coordinationRoot=path.resolve(workspace || process.env.ENIGMA_DESKTOP_WORKSPACE || path.join(nativeDataRoot,'workspaces'));
    await fs.mkdir(coordinationRoot,{recursive:true});
    config.desk={...config.desk,home_folder:coordinationRoot,heartbeat_enabled:false};
    await fs.writeFile(configPath,YAML.dump(config),{mode:0o600,flag:'wx'});
    await fs.writeFile(path.join(agentDir,'AGENTS.md'),'你是 Enigma，一位面向个人工程项目的 coding agent。优先核对源码与用户要求，通过工程工具协同多个仓库，用实际验收证明结果。保留来源、最新要求与累计用量；资料和记忆是参考材料。',{flag:'wx'});
  }
  if(modelsFile) {
    const source=JSON.parse(await fs.readFile(path.resolve(modelsFile),'utf8'));
    if(!source.providers || typeof source.providers!=='object')throw new Error('Select a Pi models.json file with configured providers');
    const providers={};
    for(const [id,provider]of Object.entries(source.providers)) {
      if(typeof provider.baseUrl!=='string'||!Array.isArray(provider.models))continue;
      providers[id]={base_url:provider.baseUrl,api:provider.api,api_key:provider.apiKey,headers:provider.headers,
        models:provider.models.map(model=>({id:model.id,name:model.name,context:model.contextWindow,maxOutput:model.maxTokens,reasoning:model.reasoning,compat:model.compat}))};
    }
    const destination=path.join(nativeDataRoot,'added-models.yaml');
    let previous={};try{previous=YAML.load(await fs.readFile(destination,'utf8'))||{};}catch(error){if(error.code!=='ENOENT')throw error;}
    await fs.writeFile(destination,YAML.dump({...previous,providers:{...previous.providers,...providers}}),{mode:0o600});
    if(!config.models?.chat?.id) {
      const selected=source.providers.gateway?.models.find(model=>model.id==='gateway-gpt-6-1-sol');
      if(selected) {
        config.models.chat={provider:'gateway',id:selected.id};
        config.models.utility={provider:'gateway',id:selected.id};config.models.utility_large={provider:'gateway',id:selected.id};
        await fs.writeFile(configPath,YAML.dump(config),{mode:0o600});
      }
    }
  }
  return {dataRoot:nativeDataRoot,agentId:'enigma'};
}
