import { Type } from 'typebox';
import type { ExtensionAPI,ExtensionContext } from '@earendil-works/pi-coding-agent';
import { MemoryStore } from './memory.js';
import { MemoryDreams } from './memory-dream.js';
import { Workspace } from './workspace.js';
import { redact } from './storage.js';

export function createMemoryDreamExtension(options:{workspace?:Workspace;enabled?:boolean;generate?:(ctx:ExtensionContext,payload:string,signal:AbortSignal)=>Promise<string>}={}){
  return (pi:ExtensionAPI)=>{
    let workspace:Workspace,dreams:MemoryDreams,enabled=false;
    const access=(ctx:ExtensionContext)=>({session:ctx.sessionManager.getSessionId(),entries:ctx.sessionManager.getBranch().map(entry=>entry.id)});
    const result=(value:unknown)=>{const safe=JSON.parse(redact(JSON.stringify(value),workspace.secrets));return {content:[{type:'text' as const,text:JSON.stringify(safe)}],details:safe,structuredContent:safe};};
    pi.on('session_start',async(_event,ctx)=>{enabled=options.enabled??(process.env.ENIGMA_MEMORY==='1'||pi.getFlag('enigma-memory')===true);if(!enabled)return;workspace=options.workspace||await Workspace.open(ctx.cwd);dreams=new MemoryDreams(workspace);pi.events.emit('enigma:managed-tools',{owner:'memory-dream',names:['memory_dream','memory_feedback']});pi.setActiveTools([...new Set([...pi.getActiveTools(),'memory_dream','memory_feedback'])]);});
    pi.on('session_shutdown',()=>pi.events.emit('enigma:managed-tools',{owner:'memory-dream',names:[]}));
    const generate=async(ctx:ExtensionContext,payload:string,signal:AbortSignal)=>{
      if(options.generate)return options.generate(ctx,payload,signal);
      if(!ctx.model)throw new Error('Select a configured memory model');
      const stream=ctx.modelRegistry.streamSimple(ctx.model,{messages:[{role:'user',timestamp:Date.now(),content:[{type:'text',text:payload}]}]},{signal,maxTokens:4000});
      const response=await stream.result();if(response.stopReason==='error'||response.stopReason==='aborted')throw new Error(response.errorMessage||'Memory model did not complete');return response.content.filter(part=>part.type==='text').map(part=>part.text).join('\n');
    };
    pi.registerTool({name:'memory_dream',label:'Incremental project memory',defaultActive:false,executionMode:'sequential',description:'Organize selected scoped memories with a bounded independent model call. prepare selects current memory IDs; run creates candidates and relation suggestions, keeping source notes unchanged; publish rechecks parents and saves candidate memories. pause/cancel/run preserve usage. recover only settles an interrupted worker proven to have exited; it never automatically repeats a model request or partial publication. Forgotten/changed parents invalidate derived results. No personal preferences, automatic deletion or new authority.',parameters:Type.Object({action:Type.Union(['prepare','run','list','read','pause','cancel','publish','recover'].map(action=>Type.Literal(action))),id:Type.Optional(Type.String()),sources:Type.Optional(Type.Array(Type.String())),maxRequests:Type.Optional(Type.Integer())}),execute:async(_id,args,signal,_update,ctx)=>{
      if(!enabled)throw new Error('Enable scoped engineering memory before using sleep-time work');const scope=access(ctx);
      if(args.action==='prepare')return result(await dreams.prepare(args.sources||[],scope,args.maxRequests));
      if(args.action==='list')return result(await dreams.list(scope));if(!args.id)throw new Error('Select a memory dream');
      if(args.action==='read')return result(await dreams.read(args.id,scope));
      if(args.action==='recover')return result(await dreams.recover(args.id,scope));
      if(args.action==='pause'||args.action==='cancel')return result(await dreams.control(args.id,args.action,scope));
      if(args.action==='publish')return result(await dreams.publish(args.id,scope,signal));
      return result(await dreams.execute(args.id,scope,(payload,abort)=>generate(ctx,payload,abort),signal));
    }});
    pi.registerTool({name:'memory_feedback',label:'Memory usefulness evidence',description:'Record a bounded usefulness observation with current task evidence. This is feedback, not proof of causation or authority to change source memories.',defaultActive:false,parameters:Type.Object({id:Type.String(),verdict:Type.Union([Type.Literal('helpful'),Type.Literal('irrelevant'),Type.Literal('wrong')]),evidence:Type.String()}),execute:async(_id,args,_signal,_update,ctx)=>{
      if(!enabled)throw new Error('Engineering memory is disabled');const evidence=await workspace.evidenceStatus(args.evidence);if(!evidence.valid)throw new Error('Feedback requires current task evidence');
      return result(await(await MemoryStore.open(workspace)).feedback(args.id,args.verdict,access(ctx),`model-observation:${ctx.sessionManager.getSessionId()}:${args.evidence}`));
    }});
    pi.registerCommand('memory-dream',{description:'Idle memory consolidation of selected IDs: JSON {sources,maxRequests?}',handler:async(text,ctx)=>{
      if(!enabled||!ctx.isIdle()||ctx.hasPendingMessages())throw new Error('Sleep-time consolidation needs enabled memory and an idle task');const args=JSON.parse(text),scope=access(ctx),run=await dreams.prepare(args.sources,scope,args.maxRequests);
      const finished=await dreams.execute(run.id,scope,(payload,signal)=>generate(ctx,payload,signal),ctx.signal);ctx.ui.notify(JSON.stringify(finished),'info');
    }});
  };
}
export default createMemoryDreamExtension();
