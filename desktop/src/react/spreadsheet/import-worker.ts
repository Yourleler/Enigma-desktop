import ExcelJS from 'exceljs';
import {checkOfficeArchive} from '../utils/office-archive';
import {importWorkbook,importCsv} from './import-workbook';
self.onmessage=async(event:MessageEvent<{bytes?:Uint8Array;csv?:string;name:string;id:string}>)=>{
  try{
    const {bytes,csv,name,id}=event.data;
    if(typeof csv==='string'){self.postMessage({ok:true,result:importCsv(csv,name,id)});return;}
    if(!bytes)throw new Error('没有可读取的表格数据');checkOfficeArchive(bytes);
    const book=new ExcelJS.Workbook();await book.xlsx.load(bytes as never);
    self.postMessage({ok:true,result:importWorkbook(book,name,id)});
  }catch(reason){self.postMessage({ok:false,error:reason instanceof Error?reason.message:'表格解析失败'});}
};
