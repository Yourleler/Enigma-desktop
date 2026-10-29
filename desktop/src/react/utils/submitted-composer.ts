import type {JSONContent} from '@tiptap/core';
import type {AttachedFile} from '../stores/input-slice';

/** A later edit may have identical text after undo/retyping. Preserve it when
 * its stored document identity changed while submission was being prepared. */
export function isSubmittedDraft(current:{text?:string;doc?:JSONContent},submitted:{text:string;doc:JSONContent;storedDoc?:JSONContent}):boolean {
  if(current.doc&&submitted.storedDoc&&current.doc!==submitted.storedDoc)return false;
  if(current.doc)return JSON.stringify(current.doc)===JSON.stringify(submitted.doc);
  return current.text===submitted.text;
}

/** Subtract only the selected attachments, once each; later additions survive. */
export function withoutSubmittedFiles(current:AttachedFile[],submitted:AttachedFile[]):AttachedFile[]{
  const remaining=submitted.map(file=>JSON.stringify(file));
  return current.filter(file=>{const index=remaining.indexOf(JSON.stringify(file));if(index<0)return true;remaining.splice(index,1);return false;});
}
