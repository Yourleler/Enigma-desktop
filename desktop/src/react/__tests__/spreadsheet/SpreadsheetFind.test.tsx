/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {BehaviorSubject,Subject} from 'rxjs';
import {createInitFindReplaceState,FindBy,FindScope,type IFindReplaceService} from '@univerjs/preset-sheets-find-replace';
import {SpreadsheetFind} from '../../spreadsheet/SpreadsheetFind';

afterEach(cleanup);
it('offers workbook search options without replacing or deleting source values',()=>{
 const state$=new BehaviorSubject({...createInitFindReplaceState(),findString:'通过',matchesPosition:1,matchesCount:2,findScope:FindScope.UNIT});
 const service={state$,focusSignal$:new Subject<void>(),replaceRevealed:false,changeFindScope:vi.fn(),changeFindBy:vi.fn(),changeCaseSensitive:vi.fn(),changeMatchesTheWholeCell:vi.fn(),moveToNextMatch:vi.fn(),moveToPreviousMatch:vi.fn()} as unknown as IFindReplaceService;
 const close=vi.fn();render(<SpreadsheetFind service={service} onClose={close}/>);
 expect(screen.getByText('1 / 2')).toBeVisible();expect(screen.queryByRole('button',{name:/替换/})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'查找选项'}));
 fireEvent.change(screen.getByLabelText('范围'),{target:{value:FindScope.SUBUNIT}});expect(service.changeFindScope).toHaveBeenCalledWith(FindScope.SUBUNIT);
 fireEvent.change(screen.getByLabelText('内容'),{target:{value:FindBy.FORMULA}});expect(service.changeFindBy).toHaveBeenCalledWith(FindBy.FORMULA);
 fireEvent.click(screen.getByLabelText('匹配整个单元格'));expect(service.changeMatchesTheWholeCell).toHaveBeenCalledWith(true);
 const input=screen.getByRole('textbox',{name:'查找单元格'});
 fireEvent.keyDown(input,{key:'Enter',shiftKey:true});expect(service.moveToPreviousMatch).toHaveBeenCalledOnce();
 fireEvent.keyDown(input,{key:'Escape'});expect(close).toHaveBeenCalledOnce();
});
