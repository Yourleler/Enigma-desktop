// @vitest-environment jsdom
import {beforeEach,expect,it} from 'vitest';
import {DraftRecoveryJournal,type DraftRecord} from '../../stores/draft-recovery-journal';
beforeEach(()=>localStorage.clear());
const record=(id:string,tab:string):DraftRecord=>({id,tab,scope:'server-A/user-A',key:'__home__',text:id,doc:null,updatedAt:Date.now()});
it('preserves independent window versions and separates server identities',()=>{
 const a=new DraftRecoveryJournal(localStorage),b=new DraftRecoveryJournal(localStorage),one=record('one','tab-A'),two=record('two','tab-B');a.write(one);b.write(two);a.remove(one);expect(b.list(one.scope).map(x=>x.text)).toEqual(['two']);expect(b.list('server-B/user-A')).toHaveLength(0);
});
it('a failed replacement never deletes the previous recovery copy',()=>{
 const storage={getItem:localStorage.getItem.bind(localStorage),removeItem:localStorage.removeItem.bind(localStorage),setItem:()=>{throw Error('quota')}} as unknown as Storage;
 const previous=record('first','tab-A');new DraftRecoveryJournal(localStorage).write(previous);expect(()=>new DraftRecoveryJournal(storage).write(record('next','tab-A'),previous)).toThrow('quota');expect(new DraftRecoveryJournal(localStorage).list(previous.scope)[0].text).toBe('first');
});
