import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from 'enigma-next';
import {runProcess} from 'enigma-next/process';
import {withNativeEngineeringExecution} from '../plugins/enigma/execution-policy.ts';

it.skipIf(process.platform!=='darwin')('development server listening requires explicit opt-in and remains disabled when network is off',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'enigma-loopback-'));
 try{
  const workspace=await Workspace.open(root),native=path.join(root,'home/agents/test/sessions');await fs.mkdir(native,{recursive:true});
  const prefs={sandbox:true,network:true,localServers:false};const engine={hanakoHome:path.join(root,'home'),getEngineeringExecutionPreferences:()=>prefs};
  const execute=(code:string)=>withNativeEngineeringExecution(engine,workspace,path.join(native,'task.jsonl'),()=>runProcess(['python3','-c',code],root,{timeoutMs:5000}));
  const initial=await execute('import socket\ns=socket.socket();s.bind(("127.0.0.1",0))');expect(initial.status).toBe('failed');
  prefs.localServers=true;
  const actual=await execute('import socket,threading\ns=socket.socket();s.bind(("127.0.0.1",0));s.listen()\ndef serve():\n c,a=s.accept();c.sendall(b"LOOPBACK_OK");c.close();s.close()\nt=threading.Thread(target=serve);t.start();c=socket.create_connection(s.getsockname());print(c.recv(100).decode());c.close();t.join()');
  expect(actual.status,actual.output).toBe('passed');expect(actual.output).toContain('LOOPBACK_OK');
  prefs.network=false;
  const disabled=await execute('import socket\ns=socket.socket();s.bind(("127.0.0.1",0))');expect(disabled.status).toBe('failed');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
