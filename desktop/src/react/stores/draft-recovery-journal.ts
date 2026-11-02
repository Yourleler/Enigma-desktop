import type {JSONContent} from '@tiptap/core';
import type {InputDraftQuote} from '../../../../shared/input-drafts';
export interface DraftRecord {
  id:string;scope:string;tab:string;key:string;text:string;doc:JSONContent|null;
  baseRevision?:number;updatedAt:number;
  quotes?:InputDraftQuote[];
}
const PREFIX='enigma-draft-recovery-v2:';
/** One immutable record per edit. Acknowledging one window cannot delete another's copy. */
export class DraftRecoveryJournal {
  constructor(private storage:Storage){}
  write(record:DraftRecord,previous?:DraftRecord):void {
    this.storage.setItem(PREFIX+record.id,JSON.stringify(record));
    if(previous&&previous.id!==record.id)this.storage.removeItem(PREFIX+previous.id);
  }
  remove(record:DraftRecord):void { this.storage.removeItem(PREFIX+record.id); }
  list(scope:string):DraftRecord[] {
    const result:DraftRecord[]=[];
    for(let index=0;index<this.storage.length;index++){
      const key=this.storage.key(index);if(!key?.startsWith(PREFIX))continue;
      try{
        const record=JSON.parse(this.storage.getItem(key)||'null');
        if(record?.scope===scope&&typeof record.id==='string'&&key===PREFIX+record.id&&typeof record.key==='string'&&typeof record.text==='string'&&typeof record.tab==='string'&&Number.isFinite(record.updatedAt))result.push(record);
      }catch{/* Keep malformed recovery data; never clear a whole storage namespace. */}
    }
    return result.sort((a,b)=>b.updatedAt-a.updatedAt);
  }
}
