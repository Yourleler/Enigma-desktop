import {expect,it,vi} from 'vitest';
import {BehaviorSubject} from 'rxjs';
import {onFindClosed} from '../../spreadsheet/find-selection';
const match={unitId:'book',range:{subUnitId:'sheet-2',range:{startRow:2,endRow:2,startColumn:0,endColumn:0}}};
it('keeps the last match through service disposal and commits only on close',async()=>{
 const currentMatch$=new BehaviorSubject<any>(null),state$=new BehaviorSubject({revealed:false}),select=vi.fn();
 const listener=onFindClosed({currentMatch$,state$} as any,select);state$.next({revealed:true});currentMatch$.next(match);
 expect(select).not.toHaveBeenCalled();currentMatch$.next(null);state$.next({revealed:false});await Promise.resolve();
 expect(select).toHaveBeenCalledExactlyOnceWith({unitId:'book',sheetId:'sheet-2',range:match.range.range});listener.dispose();
});
it('does not move back to an old match after a query has no results',async()=>{
 const currentMatch$=new BehaviorSubject<any>(null),state$=new BehaviorSubject({revealed:false}),select=vi.fn();
 const listener=onFindClosed({currentMatch$,state$} as any,select);state$.next({revealed:true});currentMatch$.next(match);currentMatch$.next(null);await Promise.resolve();state$.next({revealed:false});
 expect(select).not.toHaveBeenCalled();listener.dispose();
});
