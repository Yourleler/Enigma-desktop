import {describe,it,expect,vi}from 'vitest';
import {AuthStorage,createModelRegistry,createAgentSession,ModelRuntime,SessionManager,SettingsManager,DefaultResourceLoader}from '../lib/pi-sdk/index.ts';
import {fauxProvider}from '@earendil-works/pi-ai';
import {normalizePiSdkThinkingLevel,normalizeThinkingLevelForModel,getModelThinkingLevels}from '../core/session-thinking-level.ts';

describe('Pi 1.4 model/runtime recovery',()=>{
  it('uses native max on an actual SDK session whose model supports that level',async()=>{
    const models=await ModelRuntime.create({credentials:AuthStorage.inMemory().store,modelsPath:null,refreshOnCreate:false});
    const faux=fauxProvider({models:[{id:'native-max',reasoning:true,contextWindow:10000,maxTokens:1000}]});
    const model={...faux.getModel(),thinkingLevelMap:{off:null,high:'high',max:'max'}};
    expect(getModelThinkingLevels(model)).toContain('max');
    expect(normalizeThinkingLevelForModel('max',model)).toBe('max');
    models.registerNativeProvider({...faux.provider,getModels:()=>[model],getAllModels:()=>[model]});
    const settings=SettingsManager.inMemory();
    const loader=new DefaultResourceLoader({cwd:process.cwd(),agentDir:process.cwd(),settingsManager:settings,noExtensions:true,noSkills:true,noContextFiles:true,noPromptTemplates:true});await loader.reload();
    const {session}=await createAgentSession({cwd:process.cwd(),modelRuntime:models,model,thinkingLevel:normalizePiSdkThinkingLevel('max'),settingsManager:settings,resourceLoader:loader,sessionManager:SessionManager.inMemory(),noTools:'all'});
    try{expect(session.thinkingLevel).toBe('max');}finally{session.dispose();}
  });
  it('reports invalid registration, then permits an explicit remove and repair',async()=>{
    const registry=createModelRegistry(AuthStorage.inMemory(),undefined);
    registry.registerProvider('broken',{api:'openai-completions',models:[{id:'fixture',name:'Fixture',reasoning:false,input:['text'],contextWindow:1000,maxTokens:100,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]});
    await expect(registry.getAvailable()).rejects.toThrow(/baseUrl/);
    registry.unregisterProvider('broken');
    registry.registerProvider('repaired',{baseUrl:'http://127.0.0.1:1/v1',api:'openai-completions',apiKey:'isolated-fixture',models:[{id:'fixture',name:'Fixture',reasoning:false,input:['text'],contextWindow:1000,maxTokens:100,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]});
    const models=await registry.getAvailable();
    expect(models.some(model=>model.provider==='repaired'&&model.id==='fixture')).toBe(true);
    expect(registry.find('broken','fixture')).toBeUndefined();
  });
  it('keeps a failed credential operation explicit and allows an explicit retry',async()=>{
    const auth=AuthStorage.inMemory(),runtime=await auth.ready();
    const failure=new Error('isolated credential write failure');
    const logout=vi.spyOn(runtime,'logout').mockRejectedValueOnce(failure);
    await expect(auth.logout('missing-provider')).rejects.toBe(failure);
    await expect(auth.ready()).rejects.toBe(failure);
    await expect(auth.logout('missing-provider')).resolves.toBeUndefined();
    await expect(auth.ready()).resolves.toBe(runtime);
    expect(logout).toHaveBeenCalledTimes(2);
    logout.mockRestore();
  });
});
