import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EngineeringHost} from '../plugins/enigma/host.ts';

const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'enigma-conversation-models-'));roots.push(root);
 const native={isIdle:false,isCompacting:false,model:{provider:'test',id:'original'},agent:{prepareRequest:vi.fn(async(_request:any,_signal:AbortSignal)=>({kept:true}))},sessionManager:{getBranch:()=>[{id:'user-one',type:'message',message:{role:'user',content:'Review this response'}}],appendCustomEntry:vi.fn()}};
 const engine={hanakoHome:root,getSessionIdForPath:(sp:string)=>sp==='chat-a'?'session-a':'session-b',getSessionByPath:()=>native,resolveModelWithCredentialsFresh:vi.fn(async role=>({model:role})),setSessionThinkingLevel:vi.fn(),switchSessionModel:vi.fn(async(_sp,id,provider)=>{native.model={id,provider};}),emitBoundSessionEvent:vi.fn(),modelRegistry:{ready:async()=>({streamSimple:vi.fn(()=>({result:async()=>({content:[{type:'text',text:'reviewed only the visible conversation'}],stopReason:'stop',usage:{}})}))})}};
 return {root,native,engine,host:new EngineeringHost(engine)};
}
it('stores model roles for an ordinary chat and switches only at its next request without creating a workspace',async()=>{
 const {host,native,engine,root}=await fixture();host.attachConversationModelRouting('chat-a',native);
 await host.configureModelPolicy('chat-a',{mode:'delegated',execution:{provider:'test',id:'main'},worker:{provider:'test',id:'child',thinking:'low'},maxRequests:4});
 expect(await host.binding('chat-a')).toBeNull();expect(engine.switchSessionModel).not.toHaveBeenCalled();
 expect(await native.agent.prepareRequest({},new AbortController().signal)).toEqual({kept:true});
 expect(native.model.id).toBe('main');expect((await host.modelBinding('chat-a'))?.modelPolicy?.requests).toBe(1);
 expect(await host.resolveChildOptions('chat-a')).toEqual({model:'test/child',thinkingLevel:'low'});expect(await host.resolveChildOptions('chat-b')).toEqual({model:undefined});
 expect((await fs.readdir(root)).sort()).toEqual(['user']);
 const reloaded=new EngineeringHost(engine);expect((await reloaded.modelBinding('chat-a'))?.modelPolicy?.worker?.id).toBe('child');
 expect(await reloaded.binding('chat-a')).toBeNull();
});
it('provides portable planning and explicit conversation review without inventing a source-code check',async()=>{
 const {host,native}=await fixture();await host.configureModelPolicy('chat-a',{mode:'plan-execute',planning:{provider:'test',id:'planner'},execution:{provider:'test',id:'main'},review:{provider:'test',id:'reviewer'}});
 const extension=host.conversationModelExtension('chat-a')!;
 expect(await extension.handlers.get('tool_call')![0]({toolName:'subagent',input:{task:'write'}})).toMatchObject({block:true});
 const execute=extension.tools.get('agent_phase')!.definition.execute;
 await expect(execute('one',{action:'execute'},new AbortController().signal)).rejects.toThrow('规划');
 await execute('two',{action:'execute',reason:'Read the requested inputs, then produce a verified response'},new AbortController().signal);
 expect(native.sessionManager.appendCustomEntry).toHaveBeenCalled();expect((await host.modelBinding('chat-a'))?.modelPolicy?.phase).toBe('execution');
 const review=await host.reviewConversation('chat-a','check requirements',new AbortController().signal);
 expect(review).toMatchObject({kind:'conversation-review',messageIds:['user-one'],model:{id:'reviewer'},runtimeTestsPerformed:false});
});
it('cannot use a bare child model alias to bypass a managed model grant',async()=>{
 const {host,root}=await fixture();await host.saveBinding('chat-a',{root,memory:false,managedGrant:{managerPath:'manager',root,models:['test/child']}});
 await expect(host.resolveChildOptions('chat-a','child')).rejects.toThrow('完整');
 await expect(host.resolveChildOptions('chat-a','test/unapproved')).rejects.toThrow('outside');
 expect(await host.resolveChildOptions('chat-a','test/child')).toEqual({model:'test/child'});
});
it('keeps model grants on a native-only worker without enabling engineering tool restrictions',async()=>{
 const {host,root,native,engine}=await fixture();Object.assign(native.sessionManager,{getCwd:()=>root});
 await host.setManagedModels('chat-a','manager',['test/child'],root);
 expect(await host.binding('chat-a')).toBeNull();expect((await host.modelBinding('chat-a'))?.managedGrant?.root).toBe(root);
 await expect(host.assertManagedModel('chat-a','test','unapproved')).rejects.toThrow('outside');
 await expect(host.connect('chat-a',root)).rejects.toThrow('不转换');
 const restored=new EngineeringHost(engine);await restored.assertManagedModel('chat-a','test','child');await expect(restored.assertManagedModel('chat-a','test','other')).rejects.toThrow('outside');
});
