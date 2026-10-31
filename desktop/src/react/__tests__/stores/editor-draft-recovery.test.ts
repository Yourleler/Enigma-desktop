// @vitest-environment jsdom
import {beforeEach, expect, it, vi} from 'vitest';
import {EditorDraftRecovery, editorRecoveryKey, editorRecoveryScope} from '../../stores/editor-draft-recovery';
import type {ServerConnection} from '../../services/server-connection';

beforeEach(()=>localStorage.clear());
const copy=(id:string,text:string)=>({id,text,scope:'server-one',key:'file-one',baseVersion:null,updatedAt:Date.now()});

it('a late acknowledgement removes only that immutable copy, not another window or newer edit',()=>{
  const journal=new EditorDraftRecovery(localStorage),old=copy('old','first'),other=copy('other','other window'),next=copy('next','second');
  journal.write(old);journal.write(other);journal.write(next,old);journal.remove(old);
  expect(journal.list('server-one','file-one').map(c=>c.text).sort()).toEqual(['other window','second']);
  expect(journal.list('server-two','file-one')).toEqual([]);
  expect(journal.list('server-one','file-two')).toEqual([]);
});
it('a storage quota failure keeps the previous recovery copy',()=>{
  const journal=new EditorDraftRecovery(localStorage),old=copy('old','safe');journal.write(old);
  const stub=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});
  expect(()=>journal.write(copy('new','not saved'),old)).toThrow('quota');stub.mockRestore();
  expect(journal.list('server-one','file-one').map(c=>c.text)).toEqual(['safe']);
});
it('isolates servers, users and resources without incorporating tokens or signed URLs',()=>{
  const connection={kind:'local',serverId:'server-a',studioId:'studio-a',userId:'user-a',baseUrl:'http://localhost:1234',token:'secret'} as ServerConnection;
  const scope=editorRecoveryScope(connection);
  expect(scope).toBe(editorRecoveryScope({...connection,baseUrl:'http://localhost:5678',token:'changed'}));
  expect(scope).not.toBe(editorRecoveryScope({...connection,userId:'user-b'}));
  expect(scope).not.toBe(editorRecoveryScope({...connection,serverId:'server-b'}));
  expect(scope).not.toContain('secret');
  expect(editorRecoveryKey(undefined,{kind:'workbench-file',mountId:'a',subdir:'docs',name:'x.md',contentPath:'/signed?token=secret'})).not.toContain('secret');
});
