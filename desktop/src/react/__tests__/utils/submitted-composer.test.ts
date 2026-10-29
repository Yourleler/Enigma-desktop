import {expect,it} from 'vitest';
import {isSubmittedDraft,withoutSubmittedFiles} from '../../utils/submitted-composer';
it('only consumes the captured rich document, including when a later retype has the same text',()=>{
 const doc={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'sent'}]}]},submitted={text:'sent',doc,storedDoc:doc};expect(isSubmittedDraft({text:'sent',doc},submitted)).toBe(true);expect(isSubmittedDraft({text:'sent',doc:structuredClone(doc)},submitted)).toBe(false);expect(isSubmittedDraft({text:'later'},submitted)).toBe(false);
});
it('removes each submitted attachment once and keeps later additions',()=>{
 const file={path:'/new/a.txt',name:'a.txt'},other={path:'/new/b.txt',name:'b.txt'};expect(withoutSubmittedFiles([file,file,other],[file])).toEqual([file,other]);
});
