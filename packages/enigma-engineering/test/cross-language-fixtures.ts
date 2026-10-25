import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Workspace } from '../src/workspace.js';
import { runProcess } from '../src/process.js';

export async function crossLanguageFixture() {
  const root = await mkdtemp(join(tmpdir(), 'enigma-cross-language-')); const workspace = await Workspace.open(root);
  for (const repo of ['server', 'sdk', 'app']) {
    const path = join(root, repo); await mkdir(path);
    assert.equal((await runProcess(['git', 'init', '-b', 'main'], path)).status, 'passed');
    await workspace.exclusive(() => workspace.addRepo(repo, path));
  }
  await writeFile(join(root, 'server', 'model.py'), 'def greet():\n    return {"message": "v1"}\n');
  await writeFile(join(root, 'server', 'server.py'), `from http.server import BaseHTTPRequestHandler, HTTPServer\nimport json\nfrom socketserver import TCPServer\nfrom model import greet as build_message\nclass LocalHTTPServer(HTTPServer):\n    def server_bind(self):\n        TCPServer.server_bind(self)\n        self.server_name = "localhost"\n        self.server_port = self.server_address[1]\nclass Handler(BaseHTTPRequestHandler):\n    def do_GET(self):\n        if self.path == "/greet":\n            body = json.dumps(build_message()).encode()\n            self.send_response(200)\n            self.send_header("Content-Type", "application/json")\n            self.send_header("Content-Length", str(len(body)))\n            self.end_headers()\n            self.wfile.write(body)\n        else:\n            self.send_error(404)\n    def log_message(self, *_):\n        pass\nif __name__ == "__main__":\n    server = LocalHTTPServer(("127.0.0.1", 0), Handler)\n    print(server.server_address[1], flush=True)\n    server.serve_forever()\n`);
  await writeFile(join(root, 'sdk', 'package.json'), '{"name":"cross-sdk","type":"module"}\n');
  await writeFile(join(root, 'sdk', 'index.js'), 'export async function getGreeting(baseURL){const response=await fetch(baseURL + "/greet");if(!response.ok)throw new Error("HTTP "+response.status);return (await response.json()).message;}\n');
  await writeFile(join(root, 'app', 'package.json'), '{"name":"cross-app","type":"module","dependencies":{"cross-sdk":"*"}}\n');
  await writeFile(join(root, 'app', 'index.js'), 'import {getGreeting} from "../sdk/index.js";\nexport async function display(baseURL){return await getGreeting(baseURL);}\n');
  await writeFile(join(root, 'server', '.enigma-contracts.json'), JSON.stringify({ schema: 1, contracts: [{ id: 'greeting', method: 'GET', path: '/greet',
    producer: { repo: 'server', file: 'server.py', symbol: 'do_GET' }, consumers: [{ repo: 'sdk', file: 'index.js', symbol: 'getGreeting' }], checks: [] }] }));
  return { root, workspace };
}

export async function actualGreeting(root: string): Promise<string> {
  const python = process.env.ENIGMA_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
  const child = spawn(python, ['-u', 'server.py'], { cwd: join(root, 'server'), env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let ended = false;
  const exited = new Promise<void>(resolve => { child.once('exit', () => { ended = true; resolve(); }); child.once('error', () => { ended = true; resolve(); }); });
  let output = '', errors = ''; child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { errors += chunk; });
  try {
    const deadline = Date.now() + 15000;
    while (!output.includes('\n') && !ended && Date.now() < deadline) await delay(20);
    const port = Number(output.trim()); assert(Number.isInteger(port) && port > 0, errors || 'Python server did not start');
    const result = await runProcess([process.execPath, '--input-type=module', '-e', 'const {display}=await import("./index.js");process.stdout.write(String(await display(process.argv[1])));', `http://127.0.0.1:${port}`], join(root, 'app'));
    assert.equal(result.status, 'passed', result.output); return result.output;
  } finally { child.kill('SIGTERM'); await exited; }
}

