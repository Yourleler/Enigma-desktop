import fs from 'node:fs/promises';
import ExcelJS from 'exceljs';
export async function createSpreadsheetPreviewFixture(){
 const book=new ExcelJS.Workbook();book.creator='Enigma test';
 const sheet=book.addWorksheet('样式与公式',{views:[{state:'frozen',ySplit:2,xSplit:0}]});
 sheet.columns=[{width:24},{width:18},{width:20},{width:18}];sheet.mergeCells('A1:D1');sheet.getCell('A1').value='新建表格验收';sheet.getCell('A1').font={size:20,bold:true,color:{argb:'FF663399'}};sheet.getCell('A1').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFE7DFF5'}};sheet.getRow(1).height=36;
 sheet.getRow(2).values=['名称','金额','双倍金额','备注'];sheet.getRow(2).font={bold:true};sheet.getRow(2).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFECE8F0'}};
 for(let i=3;i<=1203;i++){sheet.getCell(i,1).value=`项目 ${String(i-2).padStart(4,'0')}`;sheet.getCell(i,2).value=i*10.25;sheet.getCell(i,2).numFmt='#,##0.00';sheet.getCell(i,3).value={formula:`B${i}*2`,result:i*20.5};sheet.getCell(i,3).numFmt='#,##0.00';sheet.getCell(i,4).value=i===1203?'末端验收内容':'正常';}
 sheet.getCell('A5').value={richText:[{text:'富文本 ',font:{bold:true}},{text:'验收'}]};sheet.getRow(8).height=42;sheet.getCell('D8').value='较长的文字会换行显示，用于核对行高与折行。';sheet.getCell('D8').alignment={wrapText:true};sheet.getRow(9).hidden=true;
 const dates=book.addWorksheet('日期与中文');dates.columns=[{width:25},{width:22}];dates.addRows([['日期','数值'],[new Date('2026-10-29T00:00:00Z'),.25],['仅查看','原文件不修改']]);dates.getCell('A2').numFmt='yyyy-mm-dd';dates.getCell('B2').numFmt='0.0%';
 book.addWorksheet('隐藏工作表',{state:'hidden'}).getCell('A1').value='隐藏数据保留';return book.xlsx.writeBuffer();
}
if(process.argv[2])await fs.writeFile(process.argv[2],await createSpreadsheetPreviewFixture(),{flag:'wx'});
