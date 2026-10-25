import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const dataRoot = path.resolve(process.env.ENIGMA_DESKTOP_DATA || path.join(os.homedir(), '.enigma-desktop-dev'));
const info = JSON.parse(await fs.readFile(path.join(dataRoot, 'server-info.json'), 'utf8').catch(() => {
  throw new Error('请先运行 npm run enigma:web，再打开工作台。');
}));
if (info.networkMode !== 'loopback' || info.host !== '127.0.0.1'
  || !Number.isInteger(info.port) || info.port < 1 || info.port > 65535
  || typeof info.token !== 'string' || !info.token) throw new Error('当前入口仅支持本机工作台。');
const base = `http://127.0.0.1:${info.port}`;
const check = await fetch(base + '/api/server/identity', {
  headers: { Authorization: `Bearer ${info.token}` }, signal: AbortSignal.timeout(5000),
});
if (!check.ok) throw new Error('工作台尚未就绪或登录已过期，请重启 npm run enigma:web。');
const url = base + '/desktop/#enigma-local-key=' + encodeURIComponent(info.token);
const command = process.platform === 'darwin' ? ['open', url]
  : process.platform === 'win32' ? ['explorer.exe', url] : ['xdg-open', url];
await new Promise((resolve, reject) => {
  const child = spawn(command[0], command.slice(1), { stdio: 'ignore' });
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolve() : reject(new Error('无法打开浏览器。')));
});
console.log(`已打开 ${base}/desktop/，本机登录自动完成，无需设置密码。`);
