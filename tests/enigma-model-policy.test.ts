import {expect,it} from 'vitest';
import {modelForPhase,planningBlocksTool,validateModelPolicy,childModelPolicy,modelPolicyRoles} from '../plugins/enigma/model-policy.ts';

it('planning denies direct and indirect execution while retaining source, planning and status access',()=>{
  for(const [tool,action] of [['repo_write',''],['repo_run',''],['workspace_verify',''],['background_task','start'],['service_manage','restart'],['recipe_manage','run'],['delegate_task','start'],['delegate_task','merge'],['browser_validate','run'],['solution_experiment','evaluate']])expect(planningBlocksTool(tool,{action}),`${tool}:${action}`).toBe(true);
  for(const [tool,action] of [['repo_read',''],['task_plan','create'],['background_task','status'],['service_manage','list'],['recipe_manage','read'],['delegate_task','preview'],['task_events','start'],['memory_search','']])expect(planningBlocksTool(tool,{action}),`${tool}:${action}`).toBe(false);
});
it('sanitizes model policy state, validates roles and selects the configured phase model',()=>{
  const policy=validateModelPolicy({mode:'plan-execute',execution:{provider:'test',id:'fast',arbitrary:'discard'},planning:{provider:'test',id:'planner'},review:{provider:'test',id:'critic'},requests:-1,failures:-1,phase:'review',maxRequests:12,root:'/foreign'});
  expect(policy.requests).toBe(0);expect(policy.phase).toBe('planning');expect(policy.execution).not.toHaveProperty('arbitrary');expect(policy).not.toHaveProperty('root');
  expect(modelForPhase(policy).id).toBe('planner');policy.phase='execution';expect(modelForPhase(policy).id).toBe('fast');policy.phase='review';expect(modelForPhase(policy).id).toBe('critic');
  expect(()=>validateModelPolicy({mode:'adaptive',execution:{provider:'test',id:'fast'}})).toThrow('planning models');
});
it('keeps the main model separate from the default child and does not recursively delegate children',()=>{
  const policy=validateModelPolicy({mode:'delegated',execution:{provider:'test',id:'main'},worker:{provider:'test',id:'worker',thinking:'low'},maxRequests:10});
  expect(policy.phase).toBe('execution');expect(modelForPhase(policy).id).toBe('main');
  expect(modelPolicyRoles(policy).map(role=>role.id)).toEqual(['main','worker']);
  const child=childModelPolicy(policy)!;expect(child.mode).toBe('single');expect(modelForPhase(child)).toEqual({provider:'test',id:'worker',thinking:'low'});expect(child.worker).toBeUndefined();
  expect(()=>validateModelPolicy({mode:'delegated',execution:policy.execution})).toThrow('child model');
});
