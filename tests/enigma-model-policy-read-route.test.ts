import {beforeEach,expect,it,vi} from 'vitest';
import {createEnigmaRoute} from '../server/routes/enigma';
const state=vi.hoisted(()=>({allowed:true,read:vi.fn(),authorize:vi.fn()}));
vi.mock('../plugins/enigma/host',()=>({engineeringHost:()=>({getDefaultModelPolicy:state.read})}));
vi.mock('../server/http/boundary',()=>({createRequestContext:()=>({authorize:(...args:unknown[])=>{state.authorize(...args);return {allowed:state.allowed};}})}));
beforeEach(()=>{state.allowed=true;state.authorize.mockReset();state.read.mockReset().mockResolvedValue({mode:'single',execution:{provider:'configured',id:'model'}});});
it('reads only the default model policy through the authenticated settings scope',async()=>{
  const response=await createEnigmaRoute({}).request('/enigma/model-policy-default');
  expect(response.status).toBe(200);expect(await response.json()).toEqual({policy:{mode:'single',execution:{provider:'configured',id:'model'}}});expect(state.authorize).toHaveBeenCalledWith('settings.read');
});
it('does not read defaults without settings permission',async()=>{
  state.allowed=false;const response=await createEnigmaRoute({}).request('/enigma/model-policy-default');expect(response.status).toBe(403);expect(state.read).not.toHaveBeenCalled();
});
