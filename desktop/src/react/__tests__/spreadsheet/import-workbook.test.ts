import {expect,it} from 'vitest';
import ExcelJS from 'exceljs';
import {importWorkbook,importCsv,cellCoordinates,workbookThemeColors} from '../../spreadsheet/import-workbook';
it('preserves formulas with cached values, merges, dimensions, frozen and hidden regions',async()=>{
 const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('数据',{views:[{state:'frozen',xSplit:1,ySplit:2}]});
 sheet.mergeCells('A1:C1');sheet.getCell('A1').value='标题';sheet.getCell('A1').font={bold:true,size:18,color:{argb:'FF663399'}};sheet.getCell('A1').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFE8DAFA'}};
 sheet.getCell('A3').value=1234.5;sheet.getCell('A3').numFmt='#,##0.00';sheet.getCell('B3').value={formula:'A3*2',result:2469};sheet.getCell('C3').value=true;
 sheet.getRow(1).height=36;sheet.getColumn(1).width=24;sheet.getRow(7).hidden=true;sheet.getRow(7).getCell(1).value='hidden';book.addWorksheet('隐藏页',{state:'hidden'}).getCell('A1').value='保留';
 const roundtrip=new ExcelJS.Workbook();await roundtrip.xlsx.load(await book.xlsx.writeBuffer());const result=importWorkbook(roundtrip,'new.xlsx','test');const data=result.data.sheets['sheet-1'];
 expect(result.formulaCount).toBe(1);expect(data.cellData![2][1]).toMatchObject({f:'=A3*2',v:2469,t:2});expect(data.mergeData).toEqual([{startRow:0,endRow:0,startColumn:0,endColumn:2}]);expect(data.cellData![0][0].s).toMatchObject({bl:1,fs:18,cl:{rgb:'#663399'},bg:{rgb:'#E8DAFA'}});expect(data.rowData![0]).toMatchObject({h:48});expect(data.columnData![0]).toMatchObject({w:173});expect(data.freeze).toMatchObject({xSplit:1,ySplit:2});expect(data.rowData![6]).toMatchObject({hd:1});expect(result.data.sheets['sheet-2'].hidden).toBe(1);
});
it('keeps more than the former 500-row limit and marks missing formula results honestly',()=>{
 const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('长表');for(let i=1;i<=1200;i++)sheet.getCell(i,1).value=i;sheet.getCell('B2').value={formula:'A2+1'};
 const result=importWorkbook(book,'long.xlsx','test');expect(result.data.sheets['sheet-1'].cellData![1199][0].v).toBe(1200);expect(result.missingFormulaResults).toBe(1);expect(result.data.sheets['sheet-1'].cellData![1][1]).toMatchObject({f:'=A2+1',v:'未缓存结果'});
});
it('preserves CSV quoted newlines, commas, blank rows and leading zeros without executing formulas',()=>{
 const result=importCsv('编号,说明\r\n001,"两行\n内容"\r\n,\r\n002,"=SUM(A1)"\r\n','test.csv','csv');const rows=result.data.sheets.csv.cellData!;
 expect(rows[1][0]).toEqual({v:'001',t:1});expect(rows[1][1].v).toBe('两行\n内容');expect(rows[2]).toBeUndefined();expect(rows[3][1]).toEqual({v:'=SUM(A1)',t:1});expect(()=>importCsv('a,"unclosed','bad.csv','x')).toThrow('引号');
});
it('converts 1900/1904 date systems consistently and validates cell coordinates',()=>{
 const book=new ExcelJS.Workbook();book.properties.date1904=true;book.addWorksheet('dates').getCell('A1').value=new Date('1904-01-02T00:00:00Z');expect(importWorkbook(book,'date.xlsx','x').data.sheets['sheet-1'].cellData![0][0].v).toBe(1);expect(cellCoordinates('$AA$30')).toEqual({row:29,column:26});expect(()=>cellCoordinates('javascript:x')).toThrow();
});

it('reads actual workbook theme colors and rejects external XML declarations',()=>{const colors=workbookThemeColors('<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme><a:accent1><a:srgbClr val="123ABC"/></a:accent1></a:clrScheme></a:themeElements></a:theme>');expect(colors[4]).toBe('123ABC');expect(()=>workbookThemeColors('<!DOCTYPE test SYSTEM "https://invalid.example"><test/>')).toThrow('外部');});

it('preserves formatting on empty cells and empty hidden rows',()=>{const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('blank-style');sheet.getCell('B10').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF123456'}};sheet.getRow(11).hidden=true;sheet.getRow(11).height=24;const result=importWorkbook(book,'styles.xlsx','styles');expect(result.data.sheets['sheet-1'].cellData![9][1].s).toMatchObject({bg:{rgb:'#123456'}});expect(result.data.sheets['sheet-1'].rowData![10]).toMatchObject({hd:1,h:32});});
