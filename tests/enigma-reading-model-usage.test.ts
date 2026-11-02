import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EngineeringHost} from '../plugins/enigma/host.ts';
import {SessionManager} from '../lib/pi-sdk/index.ts';
import {Workspace} from 'enigma-next';
import {createUsageLedger} from '../lib/llm/usage-ledger.ts';

const captured=vi.hoisted(()=>({options:null as any}));
vi.mock('enigma-next/pi-change-reading',()=>({createChangeReadingExtension:(options:any)=>{captured.options=options;return()=>{};}}));
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});

it('accounts for each tool reading request and stops at the existing model limit',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'reading-model-usage-'));roots.push(root);
 const workspace=await Workspace.open(root),home=path.join(root,'home');await fs.mkdir(path.join(home,'user'),{recursive:true});
 const manager=SessionManager.create(root,path.join(home,'sessions'));manager.appendMessage({role:'user',content:'Inspect sources',timestamp:Date.now()});
 const session=manager.getSessionFile()!,ledger=createUsageLedger();let readOnly=false;
 const engine:any={hanakoHome:home,modelsJsonPath:path.join(home,'models.json'),getEngineeringExecutionPreferences:()=>({sandbox:false}),getSessionIdForPath:()=>manager.getSessionId(),getSessionPermissionMode:()=>readOnly?'read_only':'operate',modelRegistry:{ready:async()=>({})},usageLedger:ledger};
 const host=new EngineeringHost(engine);await host.saveBinding(session,{root:workspace.root,memory:false,modelPolicy:{requests:0,maxRequests:2} as any});await host.prepare(session);
 const stream=vi.fn(()=>({result:async()=>({stopReason:'stop',usage:{input:12,output:3},content:[{type:'text',text:'{"chapters":[],"insights":[]}' }]})}));
 const ctx:any={signal:new AbortController().signal,model:{id:'reader',provider:'fixture'},modelRegistry:{streamSimple:stream},sessionManager:manager};
 const input={signal:ctx.signal,prompt:'Only generated fixture data',index:0,total:2,maxTokens:1000};
 await captured.options.onRequest(ctx);await captured.options.request(ctx,input,()=>{});
 await captured.options.onRequest(ctx);await expect(captured.options.request(ctx,{...input,index:1},()=>{throw Error('Invalid source reference');})).rejects.toThrow('Invalid source reference');
 expect(stream).toHaveBeenCalledTimes(2);expect(ledger.list().entries.map((entry:any)=>entry.status).sort()).toEqual(['error','ok']);
 expect(ledger.list().entries.every((entry:any)=>entry.attribution.sessionPath===session)).toBe(true);
 await expect(captured.options.onRequest(ctx)).rejects.toThrow('模型调用限额');expect(stream).toHaveBeenCalledTimes(2);
 readOnly=true;await expect(captured.options.onRequest(ctx)).rejects.toThrow('只读');
});
