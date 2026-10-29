import type ExcelJS from 'exceljs';
import type {ICellData,IStyleData,IWorkbookData,IWorksheetData,IRange} from '@univerjs/core';
import Papa from 'papaparse';
import {SaxesParser} from 'saxes';

const MAX_CELLS=250_000;
const themeColors=['FFFFFF','000000','EEECE1','1F497D','4F81BD','C0504D','9BBB59','8064A2','4BACC6','F79646','0000FF','800080'];
function color(value:(Partial<ExcelJS.Color>&{tint?:number})|undefined,palette=themeColors):{rgb:string}|undefined {
  if(!value)return;
  let hex=value.argb?.slice(-6)||(typeof value.theme==='number'?palette[value.theme]:undefined);
  if(!hex||!/^[0-9a-f]{6}$/i.test(hex)||!Number.isFinite(parseInt(hex,16)))return;
  if(value.tint){hex=hex.match(/../g)!.map(component=>{const c=parseInt(component,16),tint=value.tint!;return Math.round(tint<0?c*(1+tint):c*(1-tint)+255*tint).toString(16).padStart(2,'0');}).join('');}
  return {rgb:'#'+hex};
}
export function workbookThemeColors(xml:string|undefined):string[] {
  if(!xml)return themeColors;
  if(xml.length>1_000_000)throw new Error('工作簿主题过大');
  const colors=[...themeColors],names=['lt1','dk1','lt2','dk2','accent1','accent2','accent3','accent4','accent5','accent6','hlink','folHlink'];let active=false,current=-1;
  const parser=new SaxesParser({xmlns:true});parser.on('doctype',()=>{throw new Error('主题不支持外部文档声明');});
  parser.on('opentag',tag=>{
    if(tag.local==='clrScheme')active=true;
    if(!active)return;
    if(names.includes(tag.local))current=names.indexOf(tag.local);
    if(current>=0&&['srgbClr','sysClr'].includes(tag.local)){const key=tag.local==='sysClr'?'lastClr':'val';const value=tag.attributes[key]?.value;if(value&&/^[a-f0-9]{6}$/i.test(value))colors[current]=value;}
  });
  parser.on('closetag',tag=>{if(names.includes(tag.local))current=-1;if(tag.local==='clrScheme')active=false;});parser.write(xml).close();return colors;
}
const borderStyles:Record<string,number>={thin:1,hair:2,dotted:3,dashed:4,dashDot:5,dashDotDot:6,double:7,medium:8,mediumDashed:9,mediumDashDot:10,mediumDashDotDot:11,slantDashDot:12,thick:13};
function style(source:Partial<ExcelJS.Style>,palette:string[]):IStyleData {
  const result:IStyleData={},font=source.font,alignment=source.alignment;
  if(font){if(font.name)result.ff=font.name;if(font.size)result.fs=font.size;if(font.bold)result.bl=1;if(font.italic)result.it=1;if(font.strike)result.st={s:1};if(font.underline)result.ul={s:1};const cl=color(font.color,palette);if(cl)result.cl=cl;}
  if(source.fill?.type==='pattern'&&source.fill.pattern==='solid'){const bg=color(source.fill.fgColor,palette);if(bg)result.bg=bg;}
  if(source.border){const bd:NonNullable<IStyleData['bd']>={};for(const [from,to] of [['top','t'],['bottom','b'],['left','l'],['right','r']] as const){const line=source.border[from];if(line?.style)bd[to]={s:borderStyles[line.style]||1,cl:color(line.color,palette)||{rgb:'#777777'}};}if(Object.keys(bd).length)result.bd=bd;}
  if(alignment){const horizontal:Record<string,number>={left:1,center:2,right:3,justify:4,distributed:6};if(alignment.horizontal)result.ht=horizontal[alignment.horizontal]||0;if(alignment.vertical)result.vt=alignment.vertical==='middle'?2:alignment.vertical==='top'?1:3;if(alignment.wrapText)result.tb=3;if(alignment.shrinkToFit)result.stf=1;}
  if(source.numFmt&&source.numFmt!=='General')result.n={pattern:source.numFmt};return result;
}
export function cellCoordinates(address:string):{row:number;column:number} {
  const found=/^\$?([A-Z]+)\$?(\d+)$/i.exec(address);if(!found)throw new Error('无效的单元格位置');let column=0;for(const c of found[1].toUpperCase())column=column*26+c.charCodeAt(0)-64;return {row:Number(found[2])-1,column:column-1};
}
function mergeRange(value:string):IRange {const [from,to=from]=value.split(':');const a=cellCoordinates(from),b=cellCoordinates(to);return {startRow:a.row,endRow:b.row,startColumn:a.column,endColumn:b.column};}
function excelDate(value:Date,date1904:boolean):number {const serial=value.getTime()/86400000+(date1904?24107:25569);return !date1904&&serial<61?serial-1:serial;}
export interface ImportedSpreadsheet {data:IWorkbookData;warnings:string[];cellCount:number;formulaCount:number;missingFormulaResults:number}
export function importWorkbook(workbook:ExcelJS.Workbook,name:string,id:string):ImportedSpreadsheet {
  if(workbook.worksheets.length>100)throw new Error('工作表超过 100 张，请使用系统应用打开完整文件');
  const data={id,name,appVersion:'1.2.0',locale:'zhCN',styles:{},sheetOrder:[],sheets:{},dateSystem:workbook.properties.date1904?'date1904':'date1900'} as unknown as IWorkbookData;
  let cellCount=0,formulaCount=0,missingFormulaResults=0;const warnings=new Set<string>();
  let palette=themeColors;try{palette=workbookThemeColors((workbook.model as unknown as {themes?:{theme1?:string}}).themes?.theme1);}catch{warnings.add('主题色无法解析，已使用默认颜色');}
  for(const sheet of workbook.worksheets){
    const sheetId='sheet-'+sheet.id;data.sheetOrder.push(sheetId);
    const firstView=sheet.views?.[0],cellData:Record<number,Record<number,ICellData>>={},rowData:Record<number,object>={},columnData:Record<number,object>={};
    const output:Partial<IWorksheetData>={id:sheetId,name:sheet.name,rowCount:Math.min(1_048_576,Math.max(100,sheet.rowCount+20)),columnCount:Math.min(16384,Math.max(20,sheet.columnCount+4)),defaultColumnWidth:90,defaultRowHeight:24,cellData,rowData,columnData,mergeData:(sheet.model.merges||[]).map(mergeRange),showGridlines:firstView?.showGridLines===false?0:1,hidden:sheet.state==='visible'?0:sheet.state==='veryHidden'?2:1,zoomRatio:(firstView?.zoomScale||100)/100,freeze:{xSplit:0,ySplit:0,startRow:-1,startColumn:-1}};
    if(firstView?.state==='frozen')output.freeze={xSplit:firstView.xSplit||0,ySplit:firstView.ySplit||0,startRow:firstView.ySplit||-1,startColumn:firstView.xSplit||-1};
    if(sheet.properties.tabColor)output.tabColor=color(sheet.properties.tabColor,palette)?.rgb;
    sheet.columns?.forEach((column,index)=>{if(column.width||column.hidden||Object.keys(column.style||{}).length)columnData[index]={s:style(column.style||{},palette),...(column.width?{w:Math.round(column.width*7+5)}:{}),...(column.hidden?{hd:1}: {})};});
    // ExcelJS snapshots include styled empty cells that eachRow/eachCell omit.
    const modelRows=(sheet.model as unknown as {rows:Array<{number:number;style?:Partial<ExcelJS.Style>;cells?:Array<{address:string}>}>}).rows;
    for(const record of modelRows){
      const rowNumber=record.number,row=sheet.getRow(rowNumber);
      if(row.height||row.hidden||Object.keys(record.style||{}).length)rowData[rowNumber-1]={s:style(record.style||{},palette),...(row.height?{h:row.height*4/3}:{}),...(row.hidden?{hd:1}: {})};
      for(const model of record.cells||[]){
        const cell=sheet.getCell(model.address),column=Number(cell.col);
        if(cell.isMerged&&cell.master.address!==cell.address)continue;
        if(++cellCount>MAX_CELLS)throw new Error('有数据或样式的单元格超过 25 万，请使用系统应用打开；不会静默截断内容');
        const entry:ICellData={s:style(cell.style,palette)};let value=cell.value;
        if(value&&typeof value==='object'&&('formula' in value||'sharedFormula' in value)){
          const formula=cell.formula;entry.f=formula.startsWith('=')?formula:'='+formula;formulaCount++;
          value=cell.result??null;if(value===null){missingFormulaResults++;entry.v='未缓存结果';entry.t=1;}
        }
        if(value instanceof Date){entry.v=excelDate(value,!!workbook.properties.date1904);entry.t=2;if(!(entry.s as IStyleData).n)(entry.s as IStyleData).n={pattern:'yyyy-mm-dd'};}
        else if(typeof value==='number'){entry.v=value;entry.t=2;}
        else if(typeof value==='boolean'){entry.v=value?1:0;entry.t=3;}
        else if(typeof value==='string'){entry.v=value;entry.t=1;}
        else if(value&&typeof value==='object'){
          if('richText' in value){entry.v=value.richText.map(run=>run.text).join('');entry.t=1;warnings.add('富文本单元格按文字显示，局部字形样式可能不同');}
          else if('text' in value){entry.v=String(value.text);entry.t=1;if('hyperlink' in value)warnings.add('链接显示文字，预览中不自动打开外部地址');}
          else if('error' in value){entry.v=value.error;entry.t=1;}
        }
        (cellData[rowNumber-1]||={})[column-1]=entry;
      }
    }
    if(sheet.getImages().length)warnings.add('内嵌图片暂未导入，请使用系统应用查看');
    data.sheets[sheetId]=output;
  }
  if(!data.sheetOrder.length)throw new Error('文件中没有可读取的工作表');
  if(data.sheetOrder.every(id=>!!data.sheets[id].hidden))throw new Error('工作簿中的工作表全部隐藏，请在系统应用中查看');
  if(missingFormulaResults)warnings.add(`${missingFormulaResults} 个公式没有已保存的计算结果`);
  if(formulaCount)warnings.add('公式显示文件已保存的结果，预览不重新计算');
  return {data,warnings:[...warnings],cellCount,formulaCount,missingFormulaResults};
}
export function importCsv(text:string,name:string,id:string):ImportedSpreadsheet {
  const parsed=Papa.parse<string[]>(text.replace(/^\uFEFF/,''),{dynamicTyping:false,skipEmptyLines:false});
  if(parsed.errors.some(error=>error.code==='MissingQuotes'))throw new Error('CSV 引号不完整，无法准确解析');
  const rows=parsed.data;if(rows.length>1_048_576)throw new Error('CSV 行数超出支持范围，请使用系统应用打开');if(rows.length>1&&rows.at(-1)?.every(value=>value===''))rows.pop();
  let cellCount=0,columns=0;const cellData:Record<number,Record<number,ICellData>>={};rows.forEach((row,index)=>{columns=Math.max(columns,row.length);if(columns>16384)throw new Error('CSV 列数超出支持范围，请使用系统应用打开');row.forEach((value,column)=>{if(++cellCount>MAX_CELLS)throw new Error('CSV 超过 25 万单元格，请使用系统应用打开');if(value!=='')(cellData[index]||={})[column]={v:value,t:1};});});
  return {data:{id,name,appVersion:'1.2.0',locale:'zhCN',styles:{},sheetOrder:['csv'],sheets:{csv:{id:'csv',name:'CSV',cellData,rowCount:Math.max(100,rows.length+20),columnCount:Math.max(20,columns+4),defaultColumnWidth:120,defaultRowHeight:24}}} as IWorkbookData,cellCount,formulaCount:0,missingFormulaResults:0,warnings:['CSV 按文字读取，保留前导零，不执行以等号开头的文本']};
}
