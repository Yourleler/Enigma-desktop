import {spawn} from 'node:child_process';
import {describe,it,expect} from 'vitest';
import {createCommandRunner} from '../core/computer-use/providers/command-runner.ts';

describe('computer helper cancellation',()=>{
  it.skipIf(process.platform==='win32')('lets a real helper release input before returning cancellation',async()=>{
    const controller=new AbortController();
    const runner=createCommandRunner({spawnImpl:((...args:Parameters<typeof spawn>)=>{
      const child=spawn(...args);
      child.stdout?.once('data',()=>controller.abort());
      return child;
    }) as typeof spawn});
    const result:any=await runner.run(process.execPath,['-e',"process.on('SIGTERM',()=>{process.stdout.write('released');process.exit(0)});console.log('ready');setInterval(()=>{},1000)"],{signal:controller.signal,timeoutMs:4000});
    expect(result.stdout).toContain('released');
    expect(result.exitCode).toBe(0);
  });

  it('does not start a helper for an already cancelled call',async()=>{
    const controller=new AbortController();controller.abort(new Error('cancel before dispatch'));
    let spawned=false;
    const runner=createCommandRunner({spawnImpl:(()=>{spawned=true;throw new Error('must not start')}) as any});
    await expect(runner.run('unused',[],{signal:controller.signal})).rejects.toThrow('cancel before dispatch');
    expect(spawned).toBe(false);
  });
});
