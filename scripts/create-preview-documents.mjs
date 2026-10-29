import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

export async function createPreviewDocuments(directory) {
  await fs.writeFile(path.join(directory,'new.pdf'),createTestPdf());
  await fs.writeFile(path.join(directory,'broken.pdf'),'This is not a PDF');
  const pcm=Buffer.alloc(16000*2),wav=Buffer.alloc(44+pcm.length);
  wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(pcm.length,40);pcm.copy(wav,44);
  await fs.writeFile(path.join(directory,'new.wav'),wav);
  await fs.writeFile(path.join(directory,'broken.webm'),'Not a video');
  const book=new ExcelJS.Workbook();
  book.addWorksheet('第一工作表').addRows([['名称','数量'],['新建测试项目',3]]);
  book.addWorksheet('第二工作表').addRows([['复核结果','通过']]);
  await book.xlsx.writeFile(path.join(directory,'new.xlsx'));
  const zip=new JSZip();
  zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>新建 Word 预览正文</w:t></w:r></w:p></w:body></w:document>');
  await fs.writeFile(path.join(directory,'new.docx'),await zip.generateAsync({type:'nodebuffer'}));
}

export function createTestPdf() {
  const content='BT /F1 22 Tf 50 240 Td (Enigma PDF preview test) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${content.length} >>\nstream\n${content}\nendstream`,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>'];
  let result='%PDF-1.4\n';const offsets=[0];
  objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(result));result+=`${i+1} 0 obj\n${object}\nendobj\n`;});
  const xref=Buffer.byteLength(result);result+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(const offset of offsets.slice(1))result+=String(offset).padStart(10,'0')+' 00000 n \n';
  result+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(result);
}
