import {useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {EditorContent} from '@tiptap/react';
import type {Editor} from '@tiptap/core';
import {ExpandedComposer} from './ExpandedComposer';
import {ComposerAttachmentPreview} from './ComposerAttachmentPreview';

/** EditorContent owns the React node views. Keep it mounted once: moving the
 * host preserves attachment views, the upload bookmark and editor selection. */
export function ComposerEditor({editor,expanded,onClose,onAttach,scope,locked=false,onPinnedChange,resetPreview}:{
  editor:Editor|null;expanded:boolean;onClose:()=>void;onAttach:()=>void;scope:string;locked?:boolean;onPinnedChange?:(value:boolean)=>void;resetPreview?:number;
}) {
  const [host]=useState(()=>{const element=document.createElement('div');element.className='enigma-composer-editor-host';return element;});
  const inline=useRef<HTMLDivElement>(null), enlarged=useRef<HTMLDivElement>(null);
  const previous=useRef(expanded);
  useLayoutEffect(()=>{
    const target=expanded?enlarged.current:inline.current;
    if(target&&host.parentElement!==target)target.append(host);
    if(previous.current!==expanded&&!locked)editor?.commands.focus();
    previous.current=expanded;
  },[expanded,host,editor,locked]);
  useLayoutEffect(()=>()=>{host.remove();},[host]);
  return <>
    <div ref={inline} data-composer-inline-slot=""/>
    {expanded&&editor&&<ExpandedComposer editorMountRef={enlarged} onClose={onClose} onAttach={onAttach} locked={locked}/>}
    {createPortal(<ComposerAttachmentPreview editor={editor} scope={scope} expanded={expanded} onPinnedChange={onPinnedChange} resetPreview={resetPreview}>
      <EditorContent editor={editor}/>
    </ComposerAttachmentPreview>,host)}
  </>;
}
