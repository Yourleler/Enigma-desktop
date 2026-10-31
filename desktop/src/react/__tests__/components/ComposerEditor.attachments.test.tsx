// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {useState} from 'react';
import {useEditor} from '@tiptap/react';
import type {Editor} from '@tiptap/core';
import {ComposerSurface} from '../../components/input/ComposerSurface';
import {fitComposerImage} from '../../components/input/ComposerAttachmentPreview';
import {ComposerEditor} from '../../components/input/ComposerEditor';
import {createInputEditorExtensions} from '../../components/input/input-editor-extensions';
import {serializeEditor} from '../../utils/editor-serializer';
import {captureAttachmentInsertion} from '../../components/input/extensions/attachment-insertion';

const badge=(name:string)=>({type:'fileBadge',attrs:{fileId:name,path:`/fixtures/${name}`,name,mimeType:'image/png',inlineAttachment:true}});
let liveEditor:Editor;
function Harness(){
 const [expanded,setExpanded]=useState(false),[pinned,setPinned]=useState(false),[reset,setReset]=useState(0);
 const editor=useEditor({extensions:createInputEditorExtensions(''),content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'before '},badge('first.png'),{type:'text',text:' after'}]}]}});
 if(editor)liveEditor=editor;
 return <ComposerSurface focused={pinned&&!expanded} onDismiss={()=>setReset(v=>v+1)}><div data-liquid="composer"><button onClick={()=>setExpanded(true)}>扩大输入</button><ComposerEditor editor={editor} expanded={expanded} onClose={()=>setExpanded(false)} onAttach={()=>editor?.commands.insertContent(badge('picked.png'))} scope="fixture" onPinnedChange={setPinned} resetPreview={reset}/></div></ComposerSurface>;
}
beforeEach(()=>{vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});window.platform={getFileUrl:(path:string)=>`https://images.test${path}`} as never;});
afterEach(()=>{cleanup();vi.unstubAllGlobals();delete (window as any).platform;});

describe('one persistent attachment editor',()=>{
 it('keeps the exact image node and rich document across repeated expansion and collapse',async()=>{
  render(<Harness/>);
  const first=await screen.findByRole('img',{name:'first.png'});
  const original=liveEditor.getJSON();
  for(let i=0;i<3;i++){
   fireEvent.click(screen.getByText('扩大输入'));
   expect(screen.getByRole('dialog',{name:'展开编辑消息'})).toContainElement(first);
   expect(screen.getByRole('img',{name:'first.png'})).toBe(first);
   fireEvent.click(screen.getByRole('button',{name:'完成编辑'}));
   expect(screen.getByRole('img',{name:'first.png'})).toBe(first);
   expect(liveEditor.getJSON()).toEqual(original);
  }
 });
 it('keeps the upload bookmark and can insert more attachments while expanded',async()=>{
  render(<Harness/>);await screen.findByRole('img',{name:'first.png'});
  act(()=>liveEditor.commands.setTextSelection(8));
  let bookmark:ReturnType<typeof captureAttachmentInsertion>;
  act(()=>{bookmark=captureAttachmentInsertion(liveEditor);});
  fireEvent.click(screen.getByText('扩大输入'));
  act(()=>{liveEditor.commands.insertContentAt(bookmark.position()!,badge('second.png'));bookmark.release();});
  expect(await screen.findByRole('img',{name:'second.png'})).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'添加图片或文件'}));
  expect(await screen.findByRole('img',{name:'picked.png'})).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'完成编辑'}));
  expect(serializeEditor(liveEditor.getJSON()).fileRefs.map(file=>file.name)).toEqual(['second.png','picked.png','first.png']);
 });
 it('supports hover preview and a pinned preview that survives editing and expansion',async()=>{
  render(<Harness/>);const button=await screen.findByRole('button',{name:'预览图片 first.png'});
  fireEvent.mouseEnter(button);expect(screen.getByRole('tooltip')).toHaveTextContent('first.png');
  fireEvent.click(button);expect(screen.getByRole('dialog',{name:'图片预览 first.png'})).toHaveTextContent('已固定');
  fireEvent.mouseLeave(button);fireEvent.mouseDown(document.body);
  act(()=>{liveEditor.commands.focus('end');liveEditor.commands.insertContent(' more text');});
  fireEvent.click(screen.getByText('扩大输入'));
  expect(screen.getByRole('dialog',{name:'图片预览 first.png'})).toBeVisible();
  expect(screen.getByRole('dialog',{name:'展开编辑消息'})).toHaveAttribute('data-attachment-preview-open');
  fireEvent.click(screen.getByRole('button',{name:'关闭图片预览'}));
  expect(screen.queryByRole('dialog',{name:'图片预览 first.png'})).toBeNull();
  expect(serializeEditor(liveEditor.getJSON()).fileRefs).toHaveLength(1);
 });
 it('removing the selected image closes only its preview and preserves the other input',async()=>{
  render(<Harness/>);fireEvent.click(await screen.findByRole('button',{name:'预览图片 first.png'}));
  fireEvent.click(screen.getByRole('button',{name:'移除附件 first.png'}));
  await waitFor(()=>expect(screen.queryByRole('dialog',{name:'图片预览 first.png'})).toBeNull());
  expect(serializeEditor(liveEditor.getJSON()).text).toBe('before  after');
 });
});

it('keeps one composer when pinning, switches images in document order and restores it without changing text',async()=>{
 render(<Harness/>);const original=await screen.findByRole('img',{name:'first.png'});
 act(()=>liveEditor.commands.insertContentAt(liveEditor.state.doc.content.size-1,badge('second.png')));const before=liveEditor.getJSON();
 fireEvent.click(screen.getByRole('button',{name:'预览图片 first.png'}));
 expect(document.querySelector('[data-composer-focus-stage]')).toContainElement(original);
 expect(screen.getByRole('button',{name:'上一张图片'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'下一张图片'}));expect(screen.getByRole('dialog',{name:'图片预览 second.png'})).toBeVisible();
 expect(screen.getByRole('button',{name:'下一张图片'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'上一张图片'}));expect(screen.getByRole('dialog',{name:'图片预览 first.png'})).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'关闭图片预览'}));expect(document.querySelector('[data-composer-focus-stage]')).toBeNull();
 expect(screen.getByRole('img',{name:'first.png'})).toBe(original);expect(liveEditor.getJSON()).toEqual(before);
});
it('gives typing more room by shrinking the image while retaining its aspect ratio',()=>{
 const short=fitComposerImage(1280,800,620,16/9),long=fitComposerImage(1280,800,420,16/9);
 expect(long.height).toBeLessThan(short.height);expect(long.width/long.height).toBeCloseTo(16/9,2);
 const narrow=fitComposerImage(420,800,430,16/9);expect(narrow.width).toBeLessThanOrEqual(316);expect(narrow.height).toBeLessThan(430-48);
});

it('lets an open model menu handle Escape before leaving the image stage',async()=>{
 render(<Harness/>);fireEvent.click(await screen.findByRole('button',{name:'预览图片 first.png'}));
 const menu=document.createElement('div');menu.setAttribute('role','listbox');menu.getClientRects=()=>({length:1} as DOMRectList);document.body.append(menu);
 fireEvent.keyDown(window,{key:'Escape'});expect(screen.getByRole('dialog',{name:'图片预览 first.png'})).toBeVisible();menu.remove();
 fireEvent.keyDown(window,{key:'Escape'});expect(screen.queryByRole('dialog',{name:'图片预览 first.png'})).toBeNull();
});
