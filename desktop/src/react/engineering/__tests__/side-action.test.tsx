// @vitest-environment jsdom
import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSideAction } from '../useSideAction';
import { useEngineering } from '../state';
beforeEach(()=>useEngineering.setState({sessionPath:'/a',connectionId:'one'}));
afterEach(cleanup);
function deferred(){let resolve!:(value:string)=>void,reject!:(error:Error)=>void;const promise=new Promise<string>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
it('ignores old answers after changing conversation and allows work in the new conversation',async()=>{
  const a=deferred(),receive=vi.fn();const {result,rerender}=renderHook(({path})=>useSideAction(path),{initialProps:{path:'/a'}});
  let first!:Promise<void>;act(()=>{first=result.current.run('ask',()=>a.promise,receive);});expect(result.current.busy).toBe('ask');
  act(()=>useEngineering.setState({sessionPath:'/b'}));rerender({path:'/b'});expect(result.current.busy).toBe('');
  await act(async()=>{await result.current.run('ask',async()=>'new',receive);});
  await act(async()=>{a.resolve('old');await first;});expect(receive).toHaveBeenCalledTimes(1);expect(receive).toHaveBeenCalledWith('new');
});
it('ignores a late failure after switching servers, even when the conversation path matches',async()=>{
  const request=deferred();const {result}=renderHook(()=>useSideAction('/a'));let first!:Promise<void>;
  act(()=>{first=result.current.run('start',()=>request.promise);});
  act(()=>useEngineering.setState({connectionId:'two'}));await act(async()=>{request.reject(new Error('old-server'));await first;});expect(result.current.error).toBe('');expect(result.current.busy).toBe('');
});
it('prevents double clicks and leaves an explicit failure available for retry',async()=>{
  const request=deferred(),start=vi.fn(()=>request.promise);const {result}=renderHook(()=>useSideAction('/a'));let first!:Promise<void>;
  act(()=>{first=result.current.run('publish',start);void result.current.run('publish',start);});expect(start).toHaveBeenCalledTimes(1);
  await act(async()=>{request.reject(new Error('连接中断'));await first;});expect(result.current.busy).toBe('');expect(result.current.error).toBe('连接中断');
  await act(async()=>{await result.current.run('publish',async()=>'ok');});expect(result.current.error).toBe('');
});
it('does not attach a completed operation to a view that was unmounted',async()=>{
  const request=deferred(),receive=vi.fn();const {result,unmount}=renderHook(()=>useSideAction('/a'));let first!:Promise<void>;act(()=>{first=result.current.run('ask',()=>request.promise,receive);});unmount();request.resolve('old');await first;expect(receive).not.toHaveBeenCalled();
});
