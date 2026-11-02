import { Type } from 'typebox';
import { planningBlocksTool } from './model-policy.ts';
import type { EngineeringHost } from './host.ts';
import { injectSessionTurnContextMessages } from '../../core/session-turn-context.ts';

/** Inline extension: no workspace, skill rescan or separate main Agent Loop. */
export function conversationModelPolicyExtension(host: EngineeringHost, sessionPath: string) {
  const definition = {
    name: 'agent_phase', label: '模型角色与阶段',
    description: 'Read configured model roles. execute records the completed plan and changes to execution at the next request; replan returns to read-only planning. review asks the configured reviewer to examine the visible conversation in a separate, tool-free context. It is not a source-code or runtime test certification. Permissions and original requirements remain unchanged.',
    parameters: Type.Object({ action: Type.Union(['status','execute','replan','review'].map(value=>Type.Literal(value))), reason: Type.Optional(Type.String()) }),
    execute: async (_id: string, args: {action:string;reason?:string}, signal: AbortSignal) => {
      if (!host.isEnabled()) throw new Error('模型编排功能已关闭');
      const policy = (await host.modelBinding(sessionPath))?.modelPolicy;
      let value: unknown;
      if (!policy) {
        if (args.action !== 'status') throw new Error('请先配置本对话的模型分工');
        value = {configured:false, mode:'single', phase:'execution'};
      } else if (args.action === 'status') value = policy;
      else if (args.action === 'review') value = await host.reviewConversation(sessionPath, args.reason || '', signal);
      else {
        if (args.action === 'execute') {
          if (!args.reason?.trim()) throw new Error('请先说明已经完成的规划和执行步骤');
          const native = host.engine.getSessionByPath(sessionPath);
          native?.sessionManager?.appendCustomEntry?.('enigma.model-plan', {plan:args.reason.trim(),at:Date.now()});
        }
        value = await host.modelPhase(sessionPath, args.action === 'execute' ? 'execution' : 'planning');
      }
      return {content:[{type:'text',text:JSON.stringify(value)}],details:value};
    },
  };
  return {
    path:'enigma-conversation-model-policy',
    tools:new Map([['agent_phase',{definition,sourceInfo:{path:'enigma-conversation-model-policy',origin:'extension',scope:'session'}}]]),
    handlers:new Map<string,Array<(event:any)=>Promise<any>>>([
      ['tool_call',[async event=>{
        if(!host.isEnabled())return;
        const policy=(await host.modelBinding(sessionPath))?.modelPolicy;
        if(policy?.phase==='planning'&&planningBlocksTool(event.toolName,event.input))return {block:true,reason:'当前是只读规划阶段。完成计划后调用 agent_phase execute，再开始写入或派发执行任务。'};
      }]],
      ['context',[async event=>{
        if(!host.isEnabled())return;
        const policy=(await host.modelBinding(sessionPath))?.modelPolicy;if(!policy)return;
        const {mode,phase,planning,execution,review,worker}=policy;
        return {messages:injectSessionTurnContextMessages(event.messages,{beforeUser:'Configured conversation model policy: '+JSON.stringify({mode,phase,planning,execution,review,worker})+'. Planning is read-only; use agent_phase execute with a completed plan before making changes. Child tasks inherit the configured worker model unless explicitly overridden within existing permissions. Verify results against the original user requirements.'})};
      }]],
      ['tool_execution_end',[async event=>{await host.recordModelPolicyOutcome(sessionPath,event);}]],
    ]),
    flags:new Map(),shortcuts:new Map(),commands:new Map(),messageRenderers:new Map(),
  };
}
