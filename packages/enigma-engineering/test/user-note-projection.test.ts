import assert from 'node:assert/strict';
import test from 'node:test';
import {collectUserNotes,selectedPiNotes} from '../src/pi-session.js';
const manager=(entries:any[])=>({getEntries:()=>entries,getEntry:(id:string)=>entries.find(entry=>entry.id===id),getSessionId:()=> 'source-task'}) as any;
test('user-note projection removes only host envelopes paired with exact recorded user input',()=>{
 const text='保留接口兼容性。\n[hana_reminder]\n这是用户自己写的标记\n[/hana_reminder]';
 const meta={id:'meta',type:'custom',customType:'hana-message-presentation',data:{displayText:text}},checkpoint={id:'checkpoint',parentId:'meta',type:'custom',customType:'enigma.context-checkpoint'},system={id:'system',parentId:'checkpoint',type:'message',message:{role:'system',content:''}},user={id:'u',parentId:'system',type:'message',message:{role:'user',content:`[hana_reference]\ninternal tools\n[/hana_reference]\n\n[hana_reminder]\ninternal notice\n[/hana_reminder]\n\n${text}`}};
 assert.equal(collectUserNotes(manager([meta,checkpoint,system,user])).get('u')?.text,text);
 assert.equal(selectedPiNotes(manager([meta,checkpoint,system,user]),[{id:'u',kind:'requirement'}])[0]?.text,text);
 assert.equal(selectedPiNotes(manager([user]),[{id:'u'}])[0]?.text,user.message.content);
 assert.equal(collectUserNotes(manager([user])).get('u')?.text,user.message.content);
 const changed={...user,message:{...user.message,content:user.message.content+'\n额外要求'}};assert.equal(collectUserNotes(manager([meta,checkpoint,system,changed])).get('u')?.text,changed.message.content);
 const prefix={...user,message:{...user.message,content:'用户补充的话\n'+text}};assert.equal(collectUserNotes(manager([meta,checkpoint,system,prefix])).get('u')?.text,prefix.message.content);
});
test('orphan presentation metadata cannot skip another user or assistant to rewrite a later requirement',()=>{
 const meta={id:'meta',type:'custom',customType:'hana-message-presentation',data:{displayText:'Keep source'}},middle={id:'middle',parentId:'meta',type:'message',message:{role:'assistant',content:'other turn'}},user={id:'u',parentId:'middle',type:'message',message:{role:'user',content:'[hana_reminder]\nnotice\n[/hana_reminder]\n\nKeep source'}};
 assert.equal(collectUserNotes(manager([meta,middle,user])).get('u')?.text,user.message.content);
});
