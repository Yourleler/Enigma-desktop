// @vitest-environment jsdom
import {Editor} from '@tiptap/core';
import {it,expect} from 'vitest';
import {createInputEditorExtensions} from '../../components/input/input-editor-extensions';
import {captureAttachmentInsertion} from '../../components/input/extensions/attachment-insertion';
import {serializeEditor} from '../../utils/editor-serializer';
it('inserts an attachment at the original caret while upload-time typing continues, and preserves it across HTML/JSON',()=>{
 const editor=new Editor({extensions:createInputEditorExtensions(''),content:'<p>before after</p>'});
 try{
  editor.commands.setTextSelection(8);const insertion=captureAttachmentInsertion(editor);
  editor.commands.insertContent('new ');
  editor.commands.insertContentAt(insertion.position()!,{type:'fileBadge',attrs:{path:'/tmp/picture.png',name:'picture.png',inlineAttachment:true}});insertion.release();
  expect(serializeEditor(editor.getJSON()).text).toBe('before [图片 1]new after');
  const html=editor.getHTML();editor.commands.setContent(html);
  expect(serializeEditor(editor.getJSON()).text).toBe('before [图片 1]new after');
  expect(serializeEditor(editor.getJSON()).fileRefs[0]).toMatchObject({path:'/tmp/picture.png',name:'picture.png'});
  editor.commands.undo();
 }finally{editor.destroy();}
});
it('gives repeated files stable numbers in textual order',()=>{
 const badge=(path:string)=>({type:'fileBadge',attrs:{path,name:path.split('/').pop(),inlineAttachment:true}});
 const json={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'比较 '},badge('/a.png'),{type:'text',text:' 与 '},badge('/b.png'),{type:'text',text:' 再看 '},badge('/a.png')]}]};
 expect(serializeEditor(json).text).toBe('比较 [图片 1] 与 [图片 2] 再看 [图片 1]');
});
