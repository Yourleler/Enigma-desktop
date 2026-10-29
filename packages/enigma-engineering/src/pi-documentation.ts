import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { DocumentationStore,type DocumentationInput } from './documentation.js';
import { Workspace } from './workspace.js';
import { redact } from './storage.js';

export function createDocumentationExtension(options:{workspace?:Workspace;enabled?:boolean}={}){
  return(pi:ExtensionAPI)=>{
    let workspace:Workspace,store:DocumentationStore;
    pi.registerFlag('enigma-documents',{type:'boolean',default:false,description:'Enable source-grounded document claims and executable examples'});
    pi.on('session_start',async(_event,ctx)=>{workspace=options.workspace||await Workspace.open(ctx.cwd);store=new DocumentationStore(workspace);if(options.enabled??pi.getFlag('enigma-documents')===true){pi.events.emit('enigma:managed-tools',{owner:'documentation',names:['document_work']});pi.setActiveTools([...new Set([...pi.getActiveTools(),'document_work'])]);}});
    pi.on('session_shutdown',()=>pi.events.emit('enigma:managed-tools',{owner:'documentation',names:[]}));
    pi.registerTool({name:'document_work',label:'Source-grounded documentation',defaultActive:false,executionMode:'sequential',description:'Register/read source-grounded Markdown declarations, inspect stale sections and version-specific cross-document contradictions, run explicitly approved executable examples, or update one exact section with an expected current document hash. JSON register input {repo,file,title,claims:[{id,section,text,authority:source|user-decision|inference|unverified,sources:[{repo,file,start,end}],fact?:{key,version,value}}],examples:[{id,section,repo,argv,expected,timeoutMs?}]}. Source facts do not prove motives; example success requires actual output. update preserves other sections; re-register changed claims and examples afterwards.',parameters:Type.Object({action:Type.Union(['register','read','list','consistency','example','update'].map(action=>Type.Literal(action))),id:Type.Optional(Type.String()),input:Type.Optional(Type.String()),example:Type.Optional(Type.String()),section:Type.Optional(Type.String()),expectedHash:Type.Optional(Type.String()),replacement:Type.Optional(Type.String())}),execute:async(_id,args,signal,_update,ctx)=>{
      let value:unknown;
      if(args.action==='register'){if(!args.input)throw new Error('Provide document declarations');value=await store.register(JSON.parse(args.input) as DocumentationInput);}
      else if(args.action==='list')value=await store.list();else if(args.action==='consistency')value=await store.consistency();
      else{
        if(!args.id)throw new Error('Select a registered document');
        if(args.action==='read')value=await store.read(args.id);
        else if(args.action==='example'){
          const document=await store.read(args.id),example=document.record.examples?.find(example=>example.id===args.example);if(!example)throw new Error('Select an example');
          if(!ctx.hasUI||!await ctx.ui.confirm('验证文档步骤',JSON.stringify({repo:example.repo,argv:example.argv,expected:example.expected})))throw new Error('Executable document example was not approved');
          value=await store.runExample(args.id,example.id,signal);
        }else{if(!args.section||!args.expectedHash||args.replacement===undefined)throw new Error('Provide exact section, expected current hash and replacement');value=await store.updateSection(args.id,args.section,args.expectedHash,args.replacement);}
      }
      const safe=JSON.parse(redact(JSON.stringify(value),workspace.secrets));return{content:[{type:'text' as const,text:JSON.stringify(safe)}],details:safe,structuredContent:safe};
    }});
  };
}
export default createDocumentationExtension();
