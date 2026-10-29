/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import SpreadsheetPreview from '../../components/preview/SpreadsheetPreview';
vi.mock('../../stores',()=>({useStore:(selector:Function)=>selector({serverPort:1})}));
vi.mock('../../utils/office-preview-binary',()=>({loadOfficePreviewBinary:vi.fn(async()=>new Uint8Array([1])),officePreviewErrorMessage:(value:Error)=>value.message}));
afterEach(cleanup);
const item={id:'table',type:'xlsx',title:'table.xlsx',content:'',fileVersion:{mtimeMs:1,size:1}};
function event(frame:HTMLIFrameElement,type:string,data:Record<string,unknown>={}){const channel=new URL(frame.src).hash.slice(1);act(()=>window.dispatchEvent(new MessageEvent('message',{source:frame.contentWindow!,data:{channel,type,...data}})));}
it('does not let delayed selection updates overwrite an address being typed',()=>{
 render(<SpreadsheetPreview previewItem={item}/>);const frame=screen.getByTitle('table.xlsx · 交互表格') as HTMLIFrameElement;
 event(frame,'loaded',{sheets:[{id:'one',name:'工作表'}],cellCount:4,warnings:[],sheetTotal:1});event(frame,'selection',{sheetId:'one',sheet:'工作表',address:'A1',value:'cell',formula:'',zoom:1});
 const input=screen.getByLabelText('定位单元格或区域');input.focus();fireEvent.change(input,{target:{value:'B1203'}});
 event(frame,'selection',{sheetId:'one',sheet:'工作表',address:'A2',value:'changed',formula:'',zoom:1});expect(input).toHaveValue('B1203');
});
it('keeps unchanged table frames and replaces changed generated CSV content',()=>{
 const view=render(<SpreadsheetPreview previewItem={{...item,type:'csv',content:'a,b'}}/>);const before=screen.getByTitle('table.xlsx · 交互表格');
 view.rerender(<SpreadsheetPreview previewItem={{...item,type:'csv',content:'a,b',fileVersion:{...item.fileVersion}}}/>);expect(screen.getByTitle('table.xlsx · 交互表格')).toBe(before);
 view.rerender(<SpreadsheetPreview previewItem={{...item,type:'csv',content:'c,d'}}/>);expect(screen.getByTitle('table.xlsx · 交互表格')).not.toBe(before);
});
it('ignores forged messages and removes a failed renderer before retry',()=>{
 render(<SpreadsheetPreview previewItem={item}/>);const frame=screen.getByTitle('table.xlsx · 交互表格') as HTMLIFrameElement;
 act(()=>window.dispatchEvent(new MessageEvent('message',{data:{channel:new URL(frame.src).hash.slice(1),type:'error',message:'forged'}})));expect(screen.queryByText('forged')).toBeNull();
 event(frame,'error',{message:'文件无法读取'});expect(screen.queryByTitle('table.xlsx · 交互表格')).toBeNull();expect(screen.getByRole('alert')).toHaveTextContent('文件无法读取');fireEvent.click(screen.getByRole('button',{name:'重新加载'}));expect(screen.getByTitle('table.xlsx · 交互表格')).toBeTruthy();
});
