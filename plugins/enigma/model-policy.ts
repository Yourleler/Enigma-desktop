export interface ModelRole { provider: string; id: string; thinking?: 'off' | 'low' | 'medium' | 'high' | 'max' }
export interface ModelPolicy {
  mode: 'single' | 'plan-execute' | 'adaptive';
  execution: ModelRole; planning?: ModelRole; review?: ModelRole;
  phase: 'planning' | 'execution' | 'review'; requests: number; failures: number; maxRequests?: number;
}

export function validateModelPolicy(input: unknown): ModelPolicy {
  const value = input as ModelPolicy;
  if (!value || !['single','plan-execute','adaptive'].includes(value.mode)) throw new Error('Select a model policy');
  for (const role of [value.execution,value.planning,value.review].filter(Boolean)) {
    if (typeof role?.provider !== 'string' || !role.provider.trim() || typeof role.id !== 'string' || !role.id.trim()
      || role.provider.length > 100 || role.id.length > 200 || role.thinking && !['off','low','medium','high','max'].includes(role.thinking)) throw new Error('Provide configured model identities and supported thinking levels');
  }
  if (!value.execution || value.mode !== 'single' && !value.planning) throw new Error('Execution and planning models are required for model separation');
  if (value.maxRequests !== undefined && (!Number.isSafeInteger(value.maxRequests) || value.maxRequests < 1 || value.maxRequests > 1000)) throw new Error('Model-call budget must be 1–1000');
  const role=(input:ModelRole|undefined)=>input?{provider:input.provider,id:input.id,...(input.thinking?{thinking:input.thinking}:{})}:undefined;
  return {mode:value.mode,execution:role(value.execution)!,planning:role(value.planning),review:role(value.review),maxRequests:value.maxRequests,phase: value.mode === 'single' ? 'execution' : 'planning', requests: 0, failures: 0 };
}

export function modelForPhase(policy: ModelPolicy): ModelRole {
  return policy.phase === 'planning' ? policy.planning || policy.execution : policy.phase === 'review' ? policy.review || policy.planning || policy.execution : policy.execution;
}
