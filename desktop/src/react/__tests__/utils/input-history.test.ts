import {describe,it,expect} from 'vitest';
import {inputHistoryEntries,inputHistoryDocument,inputHistoryDirection,moveInputHistory} from '../../utils/input-history';
import {serializeEditor} from '../../utils/editor-serializer';
import type {ChatListItem} from '../../stores/chat-types';

describe('composer input history',()=>{
 it('excludes assistant, agent-origin and unconfirmed inputs',()=>{
  const items:ChatListItem[]=[
   {type:'message',data:{id:'user',sourceEntryId:'entry',role:'user',text:'keep'}},
   {type:'message',data:{id:'answer',role:'assistant',text:'answer'}},
   {type:'message',data:{id:'agent',role:'user',origin:{kind:'agent',agentId:'a',agentName:'a'},text:'internal'}},
   {type:'message',data:{id:'pending',role:'user',sendStatus:'pending',text:'not yet'}},
  ];
  expect(inputHistoryEntries(items).map(item=>item.id)).toEqual(['entry']);
 });
 it('keeps both bounds and the latest draft as a separate final position',()=>{
  const entries=inputHistoryEntries(['a','b'].map(id=>({type:'message',data:{id,role:'user',text:id}})));
  expect(moveInputHistory(entries,null,-1)).toBe('b');
  expect(moveInputHistory(entries,'b',-1)).toBe('a');
  expect(moveInputHistory(entries,'a',-1)).toBe('a');
  expect(moveInputHistory(entries,'b',1)).toBeNull();
  expect(moveInputHistory(entries,null,1)).toBeNull();
 });
 it('reconstructs inline files without losing text position or duplicating attachments',()=>{
  const doc=inputHistoryDocument({id:'u',role:'user',text:'before[图片 1]after\n[文件 2]end',attachments:[
   {fileId:'f1',path:'/test/a.png',name:'a.png',isDir:false},
   {fileId:'f2',path:'/test/b.md',name:'b.md',isDir:false},
  ]});
  const result=serializeEditor(doc);
  expect(result.text).toBe('before[图片 1]after\n[文件 2]end');
  expect(result.fileRefs.map(file=>file.fileId)).toEqual(['f1','f2']);
 });
 it('does not intercept normal typing, composition, or unrelated shortcuts',()=>{
  expect(inputHistoryDirection({key:'z'})).toBeNull();
  expect(inputHistoryDirection({key:'z',metaKey:true,isComposing:true})).toBeNull();
  expect(inputHistoryDirection({key:'z',metaKey:true,altKey:true})).toBeNull();
  expect(inputHistoryDirection({key:'z',metaKey:true})).toBe(-1);
  expect(inputHistoryDirection({key:'y',metaKey:true})).toBe(1);
  expect(inputHistoryDirection({key:'z',ctrlKey:true,shiftKey:true})).toBe(1);
 });
});
