import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {randomBytes} from 'node:crypto';
import { fileURLToPath } from 'node:url';

/** Every invocation creates a fresh directory. The HTTP server can only read
 * the fixture allowlist and append fake receipts inside that new directory. */
export async function createInteractionLab({ parent = os.tmpdir() } = {}) {
  fs.mkdirSync(parent,{recursive:true});
  const root=fs.mkdtempSync(path.join(parent,'enigma-interaction-'));
  const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../tests/fixtures/interaction-lab');
  for(const file of ['index.html','lab.js'])fs.copyFileSync(path.join(source,file),path.join(root,file));
  fs.writeFileSync(path.join(root,'second.html'),'<!doctype html><meta charset="utf-8"><title>第二个测试页面</title><h1>第二个测试页面</h1><p>导航成功</p><a href="/">返回交互页</a>');
  fs.writeFileSync(path.join(root,'sample.txt'),'Enigma 新建测试文本\n只用于本次交互验收。\n');
  fs.writeFileSync(path.join(root,'sample.md'),'# 新建预览文档\n\n这是 **Markdown** 测试。\n\n| 名称 | 数量 |\n| --- | --- |\n| 测试项 | 3 |\n\n```js\nconst result = 3;\n```\n\n[测试网页](./second.html)\n\n![测试图片](./sample.svg)\n');
  fs.writeFileSync(path.join(root,'sample.csv'),'名称,数量\n蓝色,3\n绿色,2\n');
  fs.writeFileSync(path.join(root,'sample.json'),JSON.stringify({purpose:'new interaction fixture',count:3},null,2));
  fs.writeFileSync(path.join(root,'sample.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="360" height="180"><rect width="360" height="180" rx="18" fill="#ece4f7"/><circle cx="180" cy="90" r="50" fill="#8664b1"/></svg>');
  const visionCode=randomBytes(4).toString('hex').toUpperCase();
  fs.writeFileSync(path.join(root,'vision.html'),`<!doctype html><meta charset="utf-8"><title>新建视觉测试页</title><body style="margin:0;background:#f7f5fb;font:32px system-ui;display:grid;place-items:center;height:95vh"><main style="padding:70px;background:#e4d5f5;border-radius:32px;text-align:center"><div>视觉校验</div><strong style="font:72px monospace;letter-spacing:12px">${visionCode}</strong></main>`);
  fs.writeFileSync(path.join(root,'vision-oracle.json'),JSON.stringify({code:visionCode}));
  const types={ 'index.html':'text/html', 'second.html':'text/html', 'vision.html':'text/html', 'frames.html':'text/html', 'frame.html':'text/html', 'lab.js':'text/javascript', 'sample.txt':'text/plain', 'sample.md':'text/markdown', 'sample.csv':'text/csv', 'sample.json':'application/json', 'sample.svg':'image/svg+xml' };
  const server=http.createServer(async (req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if (req.method === 'GET' && pathname === '/delayed.html') {
      const timer = setTimeout(() => {res.setHeader('Content-Type', 'text/html');res.end('<h1>Delayed new test page</h1>');}, 8000);
      res.once('close', () => clearTimeout(timer));
      return;
    }
    if(req.method==='POST'&&pathname==='/receipt'){
      let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>16000){res.writeHead(413);res.end();return;}}
      try{const data=JSON.parse(body);const receipt={id:`lab-${Date.now()}`,data};fs.appendFileSync(path.join(root,'receipts.jsonl'),JSON.stringify(receipt)+'\n');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(receipt));}catch{res.writeHead(400);res.end('Invalid test request');}return;
    }
    const file=pathname==='/'?'index.html':pathname.slice(1);
    if(req.method!=='GET'||!Object.hasOwn(types,file)){res.writeHead(404);res.end('Not found');return;}
    res.setHeader('Content-Type',types[file]+'; charset=utf-8');res.setHeader('Cache-Control','no-store');
    if(file==='sample.txt')res.setHeader('Content-Disposition','attachment; filename="enigma-lab-download.txt"');
    fs.createReadStream(path.join(root,file)).pipe(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  fs.writeFileSync(path.join(root,'frames.html'),`<!doctype html><meta charset="utf-8"><title>新建子页面测试</title><h1>新建子页面测试</h1><p>两个表单属于不同来源。</p><iframe title="同源表单" name="same" src="/frame.html?kind=same" style="margin:40px 80px;width:600px;height:330px;border:4px solid #8764ad"></iframe><iframe title="跨源表单" name="cross" src="http://localhost:${server.address().port}/frame.html?kind=cross" style="margin:40px 130px;width:560px;height:340px;border:6px solid #58a899"></iframe>`);
  fs.writeFileSync(path.join(root,'frame.html'),`<!doctype html><meta charset="utf-8"><title>嵌入表单</title><style>body{font:18px system-ui;padding:20px}label{display:block;margin:12px 0}input,button,select{font:inherit}</style><h1>嵌入表单</h1><label>子页面姓名<input></label><label>子页面颜色<select><option value="blue">蓝色</option><option value="green">绿色</option></select></label><button>保存子页面</button><output></output><script>document.querySelector('button').onclick=e=>document.querySelector('output').textContent='已保存：'+document.querySelector('input').value+'；'+document.querySelector('select').value+'；可信点击：'+e.isTrusted;</script>`);
  fs.appendFileSync(path.join(root,'frame.html'),`<script>if(new URLSearchParams(location.search).get('kind')==='cross'){const frame=document.createElement('iframe');frame.title='嵌套表单';frame.name='nested';frame.src='/frame.html?kind=nested';frame.style='display:block;margin:60px 20px;width:420px;height:350px;border:3px solid purple';document.body.append(frame);}</script>`);
  fs.appendFileSync(path.join(root,'frame.html'),`<label>子页面上传<input type="file" id="frame-file"></label><output id="frame-upload-result"></output><script>document.querySelector('#frame-file').onchange=async e=>document.querySelector('#frame-upload-result').textContent='子页面已读取：'+(await e.target.files[0].text());</script>`);
  fs.appendFileSync(path.join(root,'frame.html'),`<div draggable="true" id="drag-source">子页面卡片</div><div id="drop-target" style="padding:20px;border:2px dashed purple">子页面落点</div><output id="drag-result"></output><script>document.querySelector('#drag-source').ondragstart=e=>e.dataTransfer.setData('text/plain','frame-card');document.querySelector('#drop-target').ondragover=e=>e.preventDefault();document.querySelector('#drop-target').ondrop=e=>{e.preventDefault();document.querySelector('#drag-result').textContent=e.dataTransfer.getData('text/plain')==='frame-card'?'子页面拖拽成功':'错误数据';};</script>`);
  fs.appendFileSync(path.join(root,'frames.html'),`<button id="remove-frames">移除所有子页面</button><script>document.querySelector('#remove-frames').onclick=()=>document.querySelectorAll('iframe').forEach(frame=>frame.remove());</script>`);
  fs.appendFileSync(path.join(root,'index.html'),`<section><button id="alert-test">打开 alert 测试</button><button id="confirm-test">打开 confirm 测试</button><button id="prompt-test">打开 prompt 测试</button><output id="dialog-result"></output></section><script>
document.querySelector('#alert-test').onclick=()=>{alert('新建测试提示');document.querySelector('#dialog-result').textContent='提示已关闭';};
document.querySelector('#confirm-test').onclick=()=>{const ok=confirm('确认新建测试？');document.querySelector('#dialog-result').textContent=ok?'确认已接受':'确认已拒绝';};
document.querySelector('#prompt-test').onclick=()=>{const value=prompt('输入新建测试备注','默认备注');document.querySelector('#dialog-result').textContent=value===null?'输入已取消':'备注：'+value;};
</script>`);
  fs.writeFileSync(path.join(root,'lab-info.json'),JSON.stringify({root,url},null,2));
  return {root,url,close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.();})};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const lab=await createInteractionLab({parent:process.argv[2]||os.tmpdir()});
  console.log(JSON.stringify({root:lab.root,url:lab.url}));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await lab.close();process.exit(0);});
}
