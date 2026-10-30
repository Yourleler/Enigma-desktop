import {Hono} from 'hono';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {afterEach,expect,it} from 'vitest';
import {createSessionsRoute} from '../server/routes/sessions';import {matchCenteredSnippet} from '../shared/history-search';
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'history-search-'));roots.push(root);const agentsDir=path.join(root,'agents'),dir=path.join(agentsDir,'test','sessions');await fs.mkdir(dir,{recursive:true});
 const sessionPath=path.join(dir,'search.jsonl'),archivedPath=path.join(dir,'archived','older.jsonl');await fs.mkdir(path.dirname(archivedPath));
 const rows=[{type:'session',version:3,id:'search',cwd:'/test',timestamp:'2026-10-01T00:00:00Z'},{type:'message',id:'a',parentId:null,message:{role:'user',content:'请处理首屏效果，Alpha request',timestamp:1}},{type:'message',id:'b',parentId:'a',message:{role:'assistant',content:[{type:'text',text:'前面的说明。'.repeat(18)+'首屏已经修改。alpha response'}],model:'test-model',provider:'test',timestamp:2}}].map(item=>JSON.stringify(item)).join('\n');await fs.writeFile(sessionPath,rows);await fs.writeFile(archivedPath,rows);
 const engine={agentsDir,listSessions:async()=>[{path:sessionPath,title:'网页修改',projectId:'project-a',modified:new Date('2026-10-20'),agentId:'test',allMessagesText:'请处理首屏效果 Alpha request 首屏已经修改 alpha response'}],listArchivedSessions:async()=>[{path:archivedPath,title:'旧网页',archivedAt:'2026-10-10'}],getSessionWorkspaceMount:()=>null};
 const app=new Hono();app.route('/api',createSessionsRoute(engine));return {app,sessionPath};
}
it('filters user versus model text and keeps the hit visible near the start of the snippet',async()=>{
 const {app}=await fixture();const params=new URLSearchParams({q:'首',phase:'content',advanced:'true',source:'assistant',match:'phrase',project:'project-a',model:'test-model'});
 const response=await app.request('/api/sessions/search?'+params);const data=await response.json();expect(response.status).toBe(200);expect(data.results).toHaveLength(1);expect(data.results[0]).toMatchObject({matchRole:'assistant',messageIndex:1});expect(data.results[0].snippet.indexOf('首')).toBeLessThan(12);
 params.set('q','request');expect((await (await app.request('/api/sessions/search?'+params)).json()).results).toHaveLength(0);params.set('source','user');expect((await (await app.request('/api/sessions/search?'+params)).json()).results).toHaveLength(1);
});
it('supports phrase/all-words, case sensitivity, date bounds and archived sources',async()=>{
 const {app}=await fixture();const q=(extra:any)=>'/api/sessions/search?'+new URLSearchParams({q:'Alpha',phase:'content',advanced:'true',match:'phrase',source:'assistant',caseSensitive:'true',...extra});
 expect((await (await app.request(q({}))).json()).results).toHaveLength(0);expect((await (await app.request(q({caseSensitive:'false'}))).json()).results).toHaveLength(1);
 expect((await (await app.request(q({q:'首屏 修改',match:'all',caseSensitive:'false'}))).json()).results).toHaveLength(1);
 expect((await (await app.request(q({caseSensitive:'false',before:String(new Date('2026-10-15').getTime())}))).json()).results).toHaveLength(0);
 const archive=await (await app.request(q({caseSensitive:'false',status:'archived'}))).json();expect(archive.results[0].archived).toBe(true);
});
it('puts a one-character match ahead of surrounding context, strips presentation wrappers',()=>{
 const text='<work>'+('一些前文。'.repeat(50))+'首屏需要调整。</work>';
 const snippet=matchCenteredSnippet(text,'首');expect(snippet.indexOf('首')).toBeLessThan(12);expect(snippet).not.toContain('<work>');
});
