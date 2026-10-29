import { expect, it, vi } from 'vitest';
import { BrowserManager } from '../lib/browser/browser-manager.ts';

it('cancels only the matching operation and removes pending commands', async () => {
  const manager=new BrowserManager();const send=vi.fn();
  manager._transport={connected:true,send};
  const first=new AbortController(),second=new AbortController();
  const a=manager.runWithSignal(first.signal,()=>manager._sendCmd('snapshot',{sessionPath:'new-test-a'}));
  const b=manager.runWithSignal(second.signal,()=>manager._sendCmd('snapshot',{sessionPath:'new-test-b'}));
  expect(manager._pending.size).toBe(2);
  first.abort(new Error('cancel a'));await expect(a).rejects.toThrow('cancel a');
  expect(manager._pending.size).toBe(1);
  expect(send.mock.calls.at(-1)?.[0]).toEqual({type:'browser-cancel',id:send.mock.calls[0][0].id});
  second.abort(new Error('cancel b'));await expect(b).rejects.toThrow('cancel b');
  expect(manager._pending.size).toBe(0);
});

it('cleans up commands when the transport fails synchronously', async () => {
  const manager=new BrowserManager();manager._transport={connected:true,send:()=>{throw new Error('transport lost');}};
  await expect(manager._sendCmd('snapshot')).rejects.toThrow('transport lost');
  expect(manager._pending.size).toBe(0);
});
