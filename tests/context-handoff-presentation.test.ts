import {afterEach, expect, it} from 'vitest';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {annotateContextHandoffs} from '../core/context-handoff-presentation.ts';
import {loadSessionHistoryMessages} from '../core/message-utils.ts';
import {SessionManager} from '../lib/pi-sdk/index.ts';
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
const raw='Full original handoff text';
const presentation={version:1,inputEntry:'u',contentHash:createHash('sha256').update(raw).digest('hex'),goal:'新目标',notes:[{role:'assistant',kind:'background',text:'selected background',reference:'pi:source:a'}],repositories:['api','client']};
const user={id:'u',role:'user',content:raw},marker={role:'custom',customType:'enigma.handoff',data:{mode:'background',presentation}};
it('projects recorded handoff metadata while preserving the exact model input',()=>{
 const result=annotateContextHandoffs([user,marker]);expect(result[0].content).toBe(raw);expect(result[0].contextHandoff).toMatchObject({goal:'新目标',repositories:['api','client']});expect(user).not.toHaveProperty('contextHandoff');
});
it('does not hide ordinary text, edited inputs, or metadata moved after a different input',()=>{
 expect(annotateContextHandoffs([user])[0]).not.toHaveProperty('contextHandoff');
 expect(annotateContextHandoffs([{...user,content:'edited'},marker])[0]).not.toHaveProperty('contextHandoff');
 const result=annotateContextHandoffs([user,{...user,id:'new'},marker]);expect(result.every(m=>!m.contextHandoff)).toBe(true);
});
it('supports prior recorded envelopes without treating pasted source-background tags as an instruction',()=>{
 const content='New task: 旧目标\nMode: background. Do not continue.\n<source-background>\n# Context handoff\n\nMode: background\nNew objective: 旧目标\n\nSource: pi · source · a\ntext\n</source-background>\n';
 expect(annotateContextHandoffs([{...user,content}])[0]).not.toHaveProperty('contextHandoff');
 expect(annotateContextHandoffs([{...user,content},{role:'custom',customType:'enigma.handoff',data:{mode:'background',source:{agent:'pi',session:'source',entry:'a'}}}])[0].contextHandoff.goal).toBe('旧目标');
});
it('reads the annotation from a real Pi session branch',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'handoff-presentation-'));roots.push(root);const manager=SessionManager.create(root,path.join(root,'sessions'));
 manager.appendMessage({role:'user',content:[{type:'text',text:raw}],timestamp:Date.now()});const id=manager.getLeafId();
 manager.appendCustomEntry('enigma.handoff',{mode:'background',presentation:{...presentation,inputEntry:id}});
 const messages=await loadSessionHistoryMessages({},manager.getSessionFile());expect(messages[0].contextHandoff.goal).toBe('新目标');expect(messages[0].content).toEqual([{type:'text',text:raw}]);
});
