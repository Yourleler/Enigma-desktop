import fs from 'node:fs';
import path from 'node:path';
import { ModelRuntime, ModelRegistry, getAgentDir } from '@earendil-works/pi-coding-agent';
type ProviderConfigInput = Parameters<ModelRegistry['registerProvider']>[1];
import type { Credential, OAuthCredential } from '@earendil-works/pi-ai';
import type { OAuthLoginCallbacks } from '@earendil-works/pi-ai/oauth';
// 1.4 keeps its file-store implementation private. Reuse this single pinned
// storage boundary so forced OAuth refresh and ordinary SDK refresh share a lock.
// All provider/login/request orchestration below uses the public ModelRuntime.
import {
  AuthStorage as SdkCredentialStore,
  FileAuthStorageBackend as SdkFileAuthStorageBackend,
  InMemoryAuthStorageBackend,
  type AuthStorageBackend,
} from '../../node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js';

export { InMemoryAuthStorageBackend };
export class FileAuthStorageBackend extends SdkFileAuthStorageBackend {
  readonly filePath:string;
  constructor(authPath=path.join(getAgentDir(),'auth.json')) {super(authPath);this.filePath=authPath;}
}

/** Hana's display/storage facade over the SDK 1.4 credential and model runtime. */
export class AuthStorage {
  readonly backend:AuthStorageBackend|string;
  readonly store: SdkCredentialStore;
  private runtimePromise?: Promise<ModelRuntime>;
  private runtimeValue?: ModelRuntime;
  private modelsPath?: string | null;
  private operations: Promise<void> = Promise.resolve();
  private readonly runtimeKeys = new Map<string,string>();
  private readonly oauthDeclarations = new Map<string,NonNullable<ProviderConfigInput['oauth']>>();
  constructor(backend: AuthStorageBackend | string = new InMemoryAuthStorageBackend()) {
    this.backend=backend;
    if (typeof backend === 'string') {
      const authPath = fs.existsSync(backend) && fs.statSync(backend).isDirectory() ? path.join(backend,'auth.json') : backend;
      this.backend = new FileAuthStorageBackend(authPath);
    }
    this.store = SdkCredentialStore.fromStorage(this.backend as AuthStorageBackend);
  }
  static create(authPath?: string) { return new AuthStorage(new FileAuthStorageBackend(authPath)); }
  static fromStorage(backend: AuthStorageBackend) { return new AuthStorage(backend); }
  static inMemory(data: Record<string,Credential> = {}) {
    const backend = new InMemoryAuthStorageBackend();
    backend.withLock(()=>({result:undefined,next:JSON.stringify(data)}));
    return new AuthStorage(backend);
  }
  configureRuntime(modelsPath: string | null = this.modelsPath ?? null) {
    if (this.runtimePromise && modelsPath !== this.modelsPath) throw new Error('One credential facade cannot own two model catalogs');
    if (!this.runtimePromise) {
      this.modelsPath=modelsPath;
      this.runtimePromise=ModelRuntime.create({credentials:this.store,modelsPath,refreshOnCreate:false}).then(async runtime=>{
        for (const [provider,key] of this.runtimeKeys) await runtime.setRuntimeApiKey(provider,key);
        this.runtimeValue=runtime;return runtime;
      });
      void this.runtimePromise.catch(()=>{});
    }
    return this.runtimePromise;
  }
  async ready() { const runtime=await this.configureRuntime();await this.operations;return runtime; }
  private queue(action:(runtime:ModelRuntime)=>Promise<void>) {
    this.operations=this.operations.catch(()=>{}).then(async()=>action(await this.configureRuntime()));
    void this.operations.catch(()=>{});
    return this.operations;
  }
  private stored(): Record<string,Credential> {
    if(this.backend instanceof FileAuthStorageBackend) {
      // UI/status reads do not take the writer lock. A synchronous lock here
      // would block an in-flight async refresh in this very event loop.
      try{return JSON.parse(fs.readFileSync(this.backend.filePath,'utf8'));}
      catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {};throw error;}
    }
    return (this.backend as AuthStorageBackend).withLock(current=>({result:current?JSON.parse(current):{}}));
  }
  get(provider:string) { return this.stored()[provider]; }
  has(provider:string) { return this.get(provider)!==undefined; }
  getAll() { return this.stored(); }
  reload() { this.store.reload(); }
  remove(provider:string) {
    return this.queue(async runtime=>{await this.store.delete(provider);this.reload();await runtime.refresh({allowNetwork:false,providers:[provider]});});
  }
  logout(provider:string) { return this.queue(async runtime=>{await runtime.logout(provider);this.reload();}); }
  setRuntimeApiKey(provider:string,key:string) {
    this.runtimeKeys.set(provider,key);
    // Called during Hana's synchronous configuration phase before a model
    // catalog is attached. The keys are applied once the runtime is created.
    if(this.runtimePromise)return this.queue(runtime=>runtime.setRuntimeApiKey(provider,key));
  }
  removeRuntimeApiKey(provider:string) {
    this.runtimeKeys.delete(provider);
    if(this.runtimePromise)return this.queue(runtime=>runtime.removeRuntimeApiKey(provider));
  }
  getOAuthProviders() {
    const providers = (this.runtimeValue?.getProviders()||[]).flatMap(provider=>{
      const oauth=provider.auth?.oauth;if(!oauth)return [];
      const legacy=this.runtimeValue?.getRegisteredProviderConfig(provider.id)?.oauth;
      return [{id:provider.id,name:oauth.name,
        usesCallbackServer:typeof legacy==='object'&&legacy!==null?legacy.usesCallbackServer:provider.id==='openai-codex',
        refreshToken:(credential:OAuthCredential,signal?:AbortSignal)=>oauth.refresh(credential,signal||new AbortController().signal),
        getApiKey:async(credential:OAuthCredential)=>(await oauth.toAuth(credential)).apiKey,
      }];
    });
    const byId=new Map(providers.map(provider=>[provider.id,provider]));
    for(const [id,oauth] of this.oauthDeclarations)if(typeof oauth==='object')byId.set(id,{id,name:oauth.name,usesCallbackServer:oauth.usesCallbackServer,refreshToken:oauth.refreshToken,getApiKey:oauth.getApiKey} as any);
    return [...byId.values()];
  }
  registerOAuth(provider:string,config:ProviderConfigInput) { if(config.oauth)this.oauthDeclarations.set(provider,config.oauth);else this.oauthDeclarations.delete(provider); }
  unregisterOAuth(provider:string) { this.oauthDeclarations.delete(provider); }
  async getApiKey(provider:string,options:{includeFallback?:boolean}={}) {
    const runtime=await this.ready();
    if(options.includeFallback===false&&!this.get(provider)&&!this.runtimeKeys.has(provider))return undefined;
    return (await runtime.getAuth(provider))?.auth.apiKey;
  }
  async login(provider:string,callbacks:OAuthLoginCallbacks) {
    const runtime=await this.ready();
    await runtime.login(provider,'oauth',{
      signal:callbacks.signal,
      prompt:async prompt=>{
        if(prompt.type==='select') {
          const selected=await callbacks.onSelect({message:prompt.message,options:prompt.options.map(o=>({id:o.id,label:o.label}))});
          if(!selected)throw new Error('OAuth login cancelled');return selected;
        }
        if(prompt.type==='manual_code'&&callbacks.onManualCodeInput)return callbacks.onManualCodeInput();
        return callbacks.onPrompt({message:prompt.message,placeholder:prompt.placeholder});
      },
      notify:event=>{
        if(event.type==='auth_url')callbacks.onAuth({url:event.url,instructions:event.instructions});
        else if(event.type==='device_code')callbacks.onDeviceCode({userCode:event.userCode,verificationUri:event.verificationUri,intervalSeconds:event.intervalSeconds,expiresInSeconds:event.expiresInSeconds});
        else callbacks.onProgress?.(event.message);
      },
    });
    this.reload();
  }
}

/** Keep Hana's synchronous catalog projection after the async SDK initialization. */
export class HanaModelRegistry {
  readonly authStorage:AuthStorage;
  readonly modelsJsonPath?:string;
  private registry?: ModelRegistry;
  private pending:Promise<void>=Promise.resolve();
  private readonly registeredProviders=new Set<string>();
  private previousProviders=new Set<string>();
  constructor(authStorage:AuthStorage,modelsJsonPath?:string) {
    this.authStorage=authStorage;this.modelsJsonPath=modelsJsonPath;
    this.pending=authStorage.configureRuntime(modelsJsonPath??null).then(runtime=>{this.registry=new ModelRegistry(runtime);});
    void this.pending.catch(()=>{});
  }
  async ready() { await this.pending;return this.authStorage.ready(); }
  getAll() { return this.registry?.getAll()||[]; }
  find(provider:string,model:string) { return this.registry?.find(provider,model); }
  private providers() {const config=this.modelsJsonPath&&fs.existsSync(this.modelsJsonPath)?JSON.parse(fs.readFileSync(this.modelsJsonPath,'utf8')):{};const current=new Set([...Object.keys(config.providers||{}),...this.registeredProviders]);const affected=new Set([...this.previousProviders,...current]);this.previousProviders=current;return [...affected];}
  async getAvailable() { const runtime=await this.ready();await this.refresh();return runtime.getAvailableSnapshot(); }
  async refresh() { const runtime=await this.ready();const result=await runtime.refresh({allowNetwork:false,providers:this.providers()});if(runtime.getError())throw new Error(runtime.getError());return result; }
  getError() { return this.registry?.getError(); }
  getApiKeyAndHeaders(model:any) { return this.ready().then(()=>this.registry!.getApiKeyAndHeaders(model)); }
  registerProvider(provider:string,config:ProviderConfigInput) {
    this.registeredProviders.add(provider);this.authStorage.registerOAuth(provider,config);
    this.pending=this.pending.catch(()=>{}).then(()=>{this.registry!.registerProvider(provider,config);});void this.pending.catch(()=>{});
  }
  unregisterProvider(provider:string) {
    this.registeredProviders.delete(provider);this.authStorage.unregisterOAuth(provider);
    this.pending=this.pending.catch(()=>{}).then(()=>{this.registry!.unregisterProvider(provider);});void this.pending.catch(()=>{});
  }
}
