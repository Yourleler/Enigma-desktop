import {Type} from 'typebox';
import {join} from 'node:path';
import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {Workspace} from './workspace.js';
import {TaskAcceptance} from './task-acceptance.js';
import {collectUserNotes} from './pi-session.js';
import {readJson,redact,safeId} from './storage.js';
import {workbenchVerificationEvidence,workbenchRequests} from './operation-history.js';
export function createTaskAcceptanceExtension(options:{workspace?:Workspace}={}){return(pi:ExtensionAPI)=>{
  let workspace:Workspace;
  pi.on('session_start',async(_event,ctx)=>{workspace=options.workspace||await Workspace.open(ctx.cwd);pi.events.emit('enigma:managed-tools',{owner:'task-acceptance',names:['task_acceptance']});pi.setActiveTools([...new Set([...pi.getActiveTools(),'task_acceptance'])]);});
  pi.on('session_shutdown',()=>pi.events.emit('enigma:managed-tools',{owner:'task-acceptance',names:[]}));
  pi.on('before_agent_start',event=>({systemPrompt:event.systemPrompt+'\nFor consequential assumptions, record a concrete failure condition and run a minimal actual test before investing in a route. Before declaring task completion, use task_acceptance to reconcile original user entries, fresh evidence, plan and unresolved effects. Its semantic coverage is your explicit assessment; do not hide unmet requirements with not-applicable.'}));
  pi.registerTool({name:'task_acceptance',label:'Requirements and completion evidence',description:'Inspect original user requirements and completion gaps; resolve an original user entry with reason and current evidence/artifacts; record/test a falsifiable assumption; or generate an evidence-grounded completion receipt. Host resolves source messages, plans and actual verification. input is JSON resolve {id,assessment:addressed|not-applicable,reason,evidence?,artifacts?}; assumption {text,failureCondition}; test {id,status:supported|refuted,evidence,reason}. Does not replace user authorization or certify semantic truth.',executionMode:'sequential',parameters:Type.Object({action:Type.Union(['inspect','resolve','assumption','test','receipt'].map(action=>Type.Literal(action))),input:Type.Optional(Type.String())}),execute:async(_id,args,_signal,_update,ctx)=>{
    const task=ctx.sessionManager.getSessionId(),store=new TaskAcceptance(workspace,task),notes=[...collectUserNotes(ctx.sessionManager).values()],input=args.input?JSON.parse(args.input):{};
    let state:{planFile?:string;lastCheckEvidence?:string}= {};try{state=await readJson(join(workspace.data,`session-${safeId(task)}.json`));}catch{}
    const current={planFile:state.planFile,verification:workbenchVerificationEvidence(ctx.sessionManager.getBranch(),state.lastCheckEvidence),workbenchRequests:workbenchRequests(ctx.sessionManager.getEntries())};
    const value=args.action==='resolve'?await store.resolve(notes,input):args.action==='assumption'?await store.assumption(input):args.action==='test'?await store.testAssumption(input.id,input.status,input.evidence,input.reason):args.action==='receipt'?await store.receipt(notes,current):await store.inspect(notes,current);
    const safe=JSON.parse(redact(JSON.stringify(value),workspace.secrets));return {content:[{type:'text' as const,text:JSON.stringify(safe)}],details:safe,structuredContent:safe};
  }});
};}
export default createTaskAcceptanceExtension();
