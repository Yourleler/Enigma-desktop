import {createUniver,LocaleType,mergeLocales,defaultTheme,greenTheme,LifecycleStages} from '@univerjs/presets';
import {UniverSheetsCorePreset,CalculationMode,ComponentManager} from '@univerjs/preset-sheets-core';
import SheetsZh from '@univerjs/preset-sheets-core/locales/zh-CN';
import {UniverSheetsFindReplacePreset,OpenFindDialogOperation,CloseFindDialogOperation,IFindReplaceService,FindScope} from '@univerjs/preset-sheets-find-replace';
import {createElement} from 'react';
import {SpreadsheetFind} from './react/spreadsheet/SpreadsheetFind';
import FindZh from '@univerjs/preset-sheets-find-replace/locales/zh-CN';
import '@univerjs/preset-sheets-core/lib/index.css';
import '@univerjs/preset-sheets-find-replace/lib/index.css';
import './spreadsheet-viewer.css';
import type {ImportedSpreadsheet} from './react/spreadsheet/import-workbook';

const channel=location.hash.slice(1);
const previewOnly='这里是只读预览。要编辑，请下载原文件或在系统应用中打开。';
const previewLocale={permission:{dialog:{alertContent:previewOnly,commonErr:previewOnly,editErr:previewOnly,pasteErr:previewOnly,setStyleErr:previewOnly,cutErr:previewOnly,setRowColStyleErr:previewOnly}}};
const lightTheme={...defaultTheme,primary:{50:'#f7f3ff',100:'#ede4fb',200:'#ddcff3',300:'#c9b4e9',400:'#b397dc',500:'#9975cf',600:'#8056b9',700:'#69449b',800:'#52367c',900:'#392558'}};
const applyTheme=(dark:boolean)=>{runtime?.univerAPI.setTheme(dark?greenTheme:lightTheme);runtime?.univerAPI.toggleDarkMode(dark);};
const eventDisposables:Array<{dispose():void}>=[];
let closed=false;
let runtime:ReturnType<typeof createUniver>|null=null,worker:Worker|null=null,loaded=false;
const send=(type:string,data:Record<string,unknown>={})=>parent.postMessage({channel,type,...data},'*');
const fail=(message:string)=>{document.getElementById('error')!.textContent=message;document.getElementById('error')!.hidden=false;send('error',{message});};
const selection=()=>{
  if(closed)return;
  const workbook=runtime?.univerAPI.getActiveWorkbook(),sheet=workbook?.getActiveSheet(),range=workbook?.getActiveRange();if(!sheet)return;
  const cell=range?.getCellData();send('selection',{sheetId:sheet.getSheetId(),sheet:sheet.getSheetName(),address:range?.getA1Notation()||'',value:range?.getDisplayValue()||'',formula:cell?.f||'',zoom:sheet.getZoom()});
};
async function openFind(){
  if(!runtime)return;
  await runtime.univerAPI.executeCommand(OpenFindDialogOperation.id);
  // The upstream sub-sheet mode silently restricts merged/multi-cell selections.
  // Workbook scope is explicit in its advanced UI and ignores selection limits.
  runtime.univer.__getInjector().get(IFindReplaceService).changeFindScope(FindScope.UNIT);
}

addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='f'){event.preventDefault();event.stopImmediatePropagation();void openFind();}},true);
addEventListener('message',async event=>{
  if(event.source!==parent||event.data?.channel!==channel)return;const data=event.data;
  try{
    if(data.type==='load'&&!loaded){
      loaded=true;worker=new Worker(new URL('./react/spreadsheet/import-worker.ts',import.meta.url),{type:'module'});
      const result=await new Promise<ImportedSpreadsheet>((resolve,reject)=>{const timer=setTimeout(()=>{worker?.terminate();reject(new Error('表格读取超时，请使用系统应用打开'));},25000);worker!.onmessage=event=>{clearTimeout(timer);worker?.terminate();worker=null;event.data.ok?resolve(event.data.result):reject(new Error(event.data.error));};worker!.onerror=()=>{clearTimeout(timer);reject(new Error('表格导入组件无法启动'));};worker!.postMessage({bytes:data.bytes,csv:data.csv,name:data.name,id:data.id});});
      runtime=createUniver({locale:LocaleType.ZH_CN,darkMode:!!data.dark,theme:data.dark?greenTheme:lightTheme,locales:{[LocaleType.ZH_CN]:mergeLocales(SheetsZh,FindZh,previewLocale)},presets:[UniverSheetsCorePreset({container:'app',header:false,toolbar:false,formulaBar:true,disableAutoFocus:true,contextMenu:false,formula:{initialFormulaComputing:CalculationMode.NO_CALCULATION},footer:{sheetBar:true,statisticBar:true,zoomSlider:true,addSheetButtonConfig:{show:false}}}),UniverSheetsFindReplacePreset()]});
      const book=runtime.univerAPI.createWorkbook(result.data);await book.getWorkbookPermission().setReadOnly();
      const currentRuntime=runtime;
      eventDisposables.push(runtime.univer.__getInjector().get(ComponentManager).register('FindReplaceDialog',()=>createElement(SpreadsheetFind,{
        service:currentRuntime.univer.__getInjector().get(IFindReplaceService),
        onClose:()=>{void currentRuntime.univerAPI.executeCommand(CloseFindDialogOperation.id);},
      }),{override:true}));
      if(runtime.univerAPI.getCurrentLifecycleStage()<LifecycleStages.Rendered)await new Promise<void>(resolve=>{const listener=runtime!.univerAPI.addEvent(runtime!.univerAPI.Event.LifeCycleChanged,event=>{if(event.stage>=LifecycleStages.Rendered){listener.dispose();resolve();}});});
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      // Read-only snapshot: original file bytes are never mutated or exported through the SDK.
      for(const event of [runtime.univerAPI.Event.SelectionChanged,runtime.univerAPI.Event.ActiveSheetChanged,runtime.univerAPI.Event.SheetZoomChanged])eventDisposables.push(runtime.univerAPI.addEvent(event,()=>requestAnimationFrame(selection)));
      send('loaded',{sheetTotal:book.getSheets().length,hiddenCount:book.getSheets().filter(sheet=>!!result.data.sheets[sheet.getSheetId()].hidden).length,sheets:book.getSheets().filter(sheet=>!result.data.sheets[sheet.getSheetId()].hidden).map(sheet=>({id:sheet.getSheetId(),name:sheet.getSheetName()})),warnings:result.warnings,cellCount:result.cellCount,formulaCount:result.formulaCount});selection();
    }else if(data.type==='theme')applyTheme(!!data.dark);
    else if(data.type==='find')await openFind();
    else if(data.type==='sheet'){const book=runtime?.univerAPI.getActiveWorkbook();if(book?.getSheets().some(sheet=>sheet.getSheetId()===data.id)){book.setActiveSheet(data.id);selection();}}
    else if(data.type==='restore'){
      const book=runtime?.univerAPI.getActiveWorkbook(),saved=data.selection;
      if(book&&saved&&book.getSheets().some(sheet=>sheet.getSheetId()===saved.sheetId)){book.setActiveSheet(saved.sheetId);await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));const sheet=book.getActiveSheet();sheet.zoom(saved.zoom||1);if(saved.address){const range=sheet.getRange(saved.address);sheet.setActiveSelection(range);sheet.scrollToCell(range.getRow(),range.getColumn());}requestAnimationFrame(selection);}
    }else if(data.type==='goto'){
      const sheet=runtime?.univerAPI.getActiveWorkbook()?.getActiveSheet();if(!sheet)return;
      if(!/^[A-Z]{1,3}[1-9]\d{0,6}(?::[A-Z]{1,3}[1-9]\d{0,6})?$/i.test(data.address))throw new Error('请输入单元格或区域，例如 A1 或 A1:C5');
      const range=sheet.getRange(data.address);
      if(range.getRow()+range.getHeight()>1_048_576||range.getColumn()+range.getWidth()>16384)throw new Error('单元格位置超出表格范围');sheet.setActiveSelection(range);sheet.scrollToCell(range.getRow(),range.getColumn());selection();
    }else if(data.type==='zoom'){runtime?.univerAPI.getActiveWorkbook()?.getActiveSheet().zoom(Math.max(.25,Math.min(3,data.value)));selection();}
    else if(data.type==='copy'){
      const range=runtime?.univerAPI.getActiveWorkbook()?.getActiveRange();if(range){if(range.getHeight()*range.getWidth()>10000)throw new Error('复制范围过大，请缩小选择');const values=range.getDisplayValues();send('copy',{text:values.map(row=>row.map(value=>String(value??'')).join('\t')).join('\n')});}
    }
  }catch(error){const message=error instanceof Error?error.message:'表格操作失败';if(!runtime)fail(message);else send('notice',{message});}
});
addEventListener('pagehide',()=>{closed=true;worker?.terminate();eventDisposables.forEach(event=>event.dispose());const book=runtime?.univerAPI.getActiveWorkbook();if(book)runtime?.univerAPI.disposeUnit(book.getId());});
send('ready');
