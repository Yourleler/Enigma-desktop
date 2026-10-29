import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_FILE_BYTES=20*1024*1024;
const MAX_EXPANDED_BYTES=80*1024*1024;
const MAX_CELLS=10000;
const escape=(value: unknown)=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

export async function inspectPdfPreview(filePath: string) {
  const stat=await fs.stat(filePath);
  if(!stat.isFile())throw new Error('预览目标不是文件');
  if(stat.size>50*1024*1024)throw new Error('PDF 超过 50 MB，请使用系统应用打开');
  const data=await fs.readFile(filePath);
  if(!data.subarray(0,1024).includes(Buffer.from('%PDF-')))throw new Error('PDF 文件已损坏或格式不正确');
  const {getDocumentProxy}=await import('unpdf');
  let document;
  try {
    document=await getDocumentProxy(new Uint8Array(data),{isEvalSupported:false});
    return {pages:document.numPages,version:{size:stat.size,mtimeMs:stat.mtimeMs}};
  }catch(error){throw new Error(error.name==='PasswordException'?'此 PDF 需要密码，请使用系统应用打开':'PDF 无法解析，文件可能已损坏');}
  finally {await document?.destroy();}
}

/** OOXML central-directory limits keep oversized archives out of the full
 * document parsers. No files are extracted to the user's filesystem. */
async function checkArchive(filePath: string, size: number) {
  const file=await fs.open(filePath,'r');
  try {
    const length=Math.min(size,65557),tail=Buffer.alloc(length);
    await file.read(tail,0,length,size-length);
    let end=-1;
    for(let at=length-22;at>=0;at--)if(tail.readUInt32LE(at)===0x06054b50){end=at;break;}
    if(end<0)throw new Error('文件已损坏，或不是有效的 DOCX/XLSX 文件');
    const entries=tail.readUInt16LE(end+10),bytes=tail.readUInt32LE(end+12),offset=tail.readUInt32LE(end+16);
    if(entries>2000||bytes>4*1024*1024||offset+bytes>size)throw new Error('文档结构过大，无法在侧栏预览，请使用系统应用打开');
    const directory=Buffer.alloc(bytes);await file.read(directory,0,bytes,offset);
    let expanded=0,at=0;
    for(let i=0;i<entries;i++) {
      if(at+46>bytes||directory.readUInt32LE(at)!==0x02014b50)throw new Error('文档目录已损坏');
      expanded+=directory.readUInt32LE(at+24);
      if(expanded>MAX_EXPANDED_BYTES)throw new Error('文档解压后超过 80 MB，请使用系统应用打开');
      at+=46+directory.readUInt16LE(at+28)+directory.readUInt16LE(at+30)+directory.readUInt16LE(at+32);
    }
  } finally {await file.close();}
}

export async function readOfficePreview(filePath: string, format?: string) {
  const ext=path.extname(filePath).slice(1).toLowerCase();
  if(ext==='xls')throw new Error('暂不支持旧版 XLS 预览，请另存为 XLSX 或使用系统应用打开');
  const type=format||ext;
  if(!['docx','xlsx'].includes(type))throw new Error('仅支持 DOCX 和 XLSX 文件');
  const stat=await fs.stat(filePath);
  if(!stat.isFile())throw new Error('预览目标不是文件');
  if(stat.size>MAX_FILE_BYTES)throw new Error('文档超过 20 MB，请使用系统应用打开');
  await checkArchive(filePath,stat.size);
  if(type==='docx') {
    const mammoth=(await import('mammoth')).default;
    const result=await mammoth.convertToHtml({path:filePath},{externalFileAccess:false});
    return {html:result.value||'<p>文档中没有可预览的文本</p>',version:{size:stat.size,mtimeMs:stat.mtimeMs}};
  }
  const ExcelJS=(await import('exceljs')).default;
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.readFile(filePath);
  let remaining=MAX_CELLS,html='';
  for(const sheet of workbook.worksheets.slice(0,30)) {
    let cells='',shown=0;
    const columns=Math.min(60,sheet.columnCount);
    for(let number=1;number<=sheet.rowCount&&number<=500&&remaining>0;number++) {
      const row=sheet.getRow(number);cells+='<tr>';
      for(let column=1;column<=columns&&remaining>0;column++,remaining--)cells+=`<td>${escape(row.getCell(column).text)}</td>`;
      cells+='</tr>';shown++;
    }
    const truncated=shown<sheet.rowCount||columns<sheet.columnCount;
    html+=`<details${html?'':' open'}><summary>${escape(sheet.name)} · ${sheet.rowCount} 行</summary>${truncated?'<p>表格较大，当前仅展示部分行列。请使用系统应用查看完整内容。</p>':''}${shown?'<table><tbody>'+cells+'</tbody></table>':'<p>空工作表</p>'}</details>`;
  }
  if(workbook.worksheets.length>30)html+='<p>仅展示前 30 个工作表。</p>';
  return {html:html||'<p>没有工作表</p>',version:{size:stat.size,mtimeMs:stat.mtimeMs}};
}
