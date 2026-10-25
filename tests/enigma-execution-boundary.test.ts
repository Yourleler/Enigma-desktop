import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from 'enigma-next';
import { runProcess } from '../packages/enigma-engineering/dist/src/process.js';
import { workerEnvironment, withProcessBoundary, isolatedWorkerBoundary,assertBoundaryPath } from 'enigma-next/execution-boundary';
import { nativeEngineeringPolicy, withNativeEngineeringExecution } from '../plugins/enigma/execution-policy.ts';
import { generateProfile } from '../lib/sandbox/seatbelt.ts';

const cleanup: string[] = [];
afterEach(async () => { for (const root of cleanup.splice(0)) await fs.rm(root,{recursive:true,force:true}); });

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'enigma-native-policy-')); cleanup.push(root);
  const repo = path.join(root,'repo\"fixture'), home = path.join(root,'home');
  // Hana intentionally allows temporary writes; use an owned directory outside TMPDIR for the denial probe.
  const outside = await fs.mkdtemp(path.join(os.homedir(),'.enigma-native-policy-probe-')); cleanup.push(outside);
  await Promise.all([repo,home,outside].map(dir => fs.mkdir(dir,{recursive:true})));
  await runProcess(['git','init','-q',repo],root);
  const workspace = await Workspace.open(repo);
  await workspace.addRepo('main',repo,{access:'write'});
  const sessionPath = path.join(home,'agents','coder','sessions','one.jsonl');
  const engine = { hanakoHome:home, getEngineeringExecutionPreferences:() => ({sandbox:true,network:true}) };
  return {root,repo,home,outside,workspace,sessionPath,engine};
}

describe('Enigma native execution boundary', () => {
  it('preserves exact argv and applies the Mac sandbox to real command effects', async () => {
    if (process.platform !== 'darwin') return;
    const f = await fixture(), inside = path.join(f.repo,'inside.txt'), outside = path.join(f.outside,'outside.txt');
    const literal = '$(touch should-not-exist) `echo nope` quoted "text"';
    const allowed = await withNativeEngineeringExecution(f.engine,f.workspace,f.sessionPath,() => runProcess([process.execPath,'-e','require("fs").writeFileSync(process.argv[1],process.argv[2])',inside,literal],f.repo));
    expect(allowed.status).toBe('passed'); expect(await fs.readFile(inside,'utf8')).toBe(literal);
    const denied = await withNativeEngineeringExecution(f.engine,f.workspace,f.sessionPath,() => runProcess([process.execPath,'-e','require("fs").writeFileSync(process.argv[1],"blocked")',outside],f.repo));
    expect(denied.status).toBe('failed'); await expect(fs.access(outside)).rejects.toMatchObject({code:'ENOENT'});
    await expect(fs.access(path.join(f.repo,'should-not-exist'))).rejects.toMatchObject({code:'ENOENT'});
  });
  it('keeps native credential paths inaccessible and read-only repo paths unwritable', async () => {
    const f = await fixture(); await fs.writeFile(path.join(f.home,'auth.json'),'fixture-credential');
    nativeEngineeringPolicy(f.engine,f.workspace,f.sessionPath);
    const current = f.workspace.config.repos[0]; current.access='read';
    await expect(f.workspace.path('main','file.ts','write')).rejects.toThrow('read-only');
    if (process.platform === 'darwin') {
      const result = await withNativeEngineeringExecution(f.engine,f.workspace,f.sessionPath,() => runProcess([process.execPath,'-e','process.stdout.write(require("fs").readFileSync(process.argv[1],"utf8"))',path.join(f.home,'auth.json')],f.repo));
      expect(result.status).toBe('failed'); expect(result.output).not.toContain('fixture-credential');
    }
  });
  it('carries the boundary to application workers without granting argv a bypass', async () => {
    const f=await fixture();
    const inherited = await withProcessBoundary({schema:1,kind:'explicit-host',prefix:[],denyReadPaths:[],readOnlyPaths:[]},async () => workerEnvironment({ENIGMA_PROCESS_BOUNDARY:'forged',CUSTOM:'kept'}));
    expect(JSON.parse(inherited.ENIGMA_PROCESS_BOUNDARY).schema).toBe(1); expect(inherited.CUSTOM).toBe('kept');
    const environment = await withNativeEngineeringExecution(f.engine,f.workspace,f.sessionPath,async () => workerEnvironment());
    expect(JSON.parse(environment.ENIGMA_PROCESS_BOUNDARY).kind).toBe('seatbelt');
  });
  it('escapes user paths in the Seatbelt profile instead of interpreting them as policy', () => {
    const generated = generateProfile({writablePaths:['/tmp/folder"\n(allow default)'],protectedPaths:[],denyReadPaths:[]});
    expect(generated).toContain('/tmp/folder\\"\\n(allow default)');
    expect(generated).not.toContain('\n(allow default)');
  });
  it('derived worker command sandbox allows scoped code and denies parent files, receipts and sibling repos',async()=>{
    if(process.platform!=='darwin')return;
    const f=await fixture(),child=path.join(f.repo,'.enigma-next','delegations','worker','workspace'),owned=path.join(child,'repos','owned'),readonly=path.join(child,'repos','readonly');
    await fs.mkdir(owned,{recursive:true});await fs.mkdir(readonly,{recursive:true});
    const worker=await withNativeEngineeringExecution(f.engine,f.workspace,f.sessionPath,()=>isolatedWorkerBoundary(child,[{root:owned,access:'write'},{root:readonly,access:'read'}]));
    expect(worker?.kind).toBe('seatbelt');
    const write=async(file:string)=>withProcessBoundary(worker!,()=>runProcess([process.execPath,'-e','require("fs").writeFileSync(process.argv[1],"probe")',file],owned));
    expect((await write(path.join(owned,'ok.txt'))).status).toBe('passed');
    for(const target of [path.join(f.repo,'parent.txt'),path.join(readonly,'blocked.txt'),path.join(child,'.enigma-next','workspace.json'),path.join(owned,'.git'),path.join(f.home,'agents','coder','sessions','injected.jsonl')]){
      const result=await write(target);expect(result.status,target).toBe('failed');await expect(fs.access(target)).rejects.toMatchObject({code:'ENOENT'});
    }
    await expect(withProcessBoundary(worker!,async()=>assertBoundaryPath(path.join(f.repo,'parent.txt'),'write'))).rejects.toThrow('isolated repository');
  });
  it('native paths allow explicit managed code inside the home while retaining sibling and credential restrictions',async()=>{
    const f=await fixture(),child=path.join(f.home,'workspaces','managed','child');await fs.mkdir(child,{recursive:true});
    await runProcess(['git','init','-q',child],f.root);const workspace=await Workspace.open(child);await workspace.addRepo('child',child,{access:'write'});
    nativeEngineeringPolicy(f.engine,workspace,f.sessionPath);
    await expect(workspace.path('child','MODULE.md','write')).resolves.toBe(path.join(await fs.realpath(child),'MODULE.md'));
    const {guard}=nativeEngineeringPolicy(f.engine,workspace,f.sessionPath);
    expect(guard.check(path.join(f.home,'workspaces','managed','other','file'),'write').allowed).toBe(false);
    expect(guard.check(path.join(f.home,'auth.json'),'read').allowed).toBe(false);
  });
});
