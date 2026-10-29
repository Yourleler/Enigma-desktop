import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import YAML from 'js-yaml';
import {ModelManager} from '../core/model-manager.ts';
import {parseModelRef} from '../shared/model-ref.ts';

/** Copy only backend configuration into a private, temporary sibling of the
 * test workspace. Model tools cannot read/upload this credentials directory.
 * ModelManager's migrations and cache writes never touch the source profile. */
export async function createInteractionModelRuntime({profile,agentConfig,modelRef}={}) {
  if(!profile)throw new Error('Pass the existing model profile directory');
  const source=path.resolve(profile);
  const config=YAML.load(fs.readFileSync(agentConfig||path.join(source,'agents','hanako','config.yaml'),'utf8'));
  const ref=modelRef||config?.models?.chat;
  if(!ref)throw new Error('The source profile has no selected conversation model');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'enigma-private-model-'));fs.chmodSync(directory,0o700);
  fs.writeFileSync(path.join(directory,'test-owner.json'),JSON.stringify({pid:process.pid}),{mode:0o600});
  const close=()=>fs.rmSync(directory,{recursive:true,force:true});
  try {
    const catalog=JSON.parse(fs.readFileSync(path.join(source,'provider-catalog.json'),'utf8'));
    const selectedProvider=parseModelRef(ref)?.provider;
    const selected=catalog.providers?.[selectedProvider];
    catalog.providers=selected?{[selectedProvider]:selected}:{};
    fs.writeFileSync(path.join(directory,'provider-catalog.json'),JSON.stringify(catalog),{mode:0o600});
    const observations=path.join(source,'model-capability-observations.json');
    if(fs.existsSync(observations))fs.copyFileSync(observations,path.join(directory,'model-capability-observations.json'));
    const definitions=path.join(source,'provider-plugins');
    if(fs.existsSync(definitions))fs.cpSync(definitions,path.join(directory,'provider-plugins'),{recursive:true});
    // Existing API-key profiles resolve credentials from the catalog. OAuth
    // credentials, if required, are copied into the same private temp root.
    if(!selected?.api_key&&fs.existsSync(path.join(source,'auth.json')))fs.copyFileSync(path.join(source,'auth.json'),path.join(directory,'auth.json'));
    if(fs.existsSync(path.join(directory,'auth.json')))fs.chmodSync(path.join(directory,'auth.json'),0o600);
    const manager=new ModelManager({hanakoHome:directory});manager.init();await manager.syncAndRefresh();
    const resolved=await manager.resolveModelWithCredentialsFresh(ref);
    return {directory,manager,model:resolved.model,close};
  } catch(error){close();throw error;}
}
