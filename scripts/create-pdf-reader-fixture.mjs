import fs from 'node:fs/promises';
import path from 'node:path';
/** Original test document with real outlines, an attachment, and an optional layer. */
export function createReaderFixture() {
  const first='BT /F1 22 Tf 40 245 Td (Reader acceptance) Tj ET\n/OC /Layer BDC BT /F1 14 Tf 40 190 Td (Optional layer text) Tj ET EMC';
  const second='BT /F1 22 Tf 40 245 Td (Chapter Two) Tj ET';
  const attachment='A new test attachment.\n';
  const stream=(value,extra='')=>`<< /Length ${Buffer.byteLength(value)} ${extra} >>\nstream\n${value}\nendstream`;
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R /Outlines 7 0 R /Names << /EmbeddedFiles << /Names [(note.txt) 9 0 R] >> >> /OCProperties << /OCGs [11 0 R] /D << /ON [11 0 R] /Order [11 0 R] >> >> >>',
    '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 300] /Resources << /Font << /F1 4 0 R >> /Properties << /Layer 11 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',stream(first),
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 12 0 R >>',
    '<< /Type /Outlines /First 8 0 R /Last 8 0 R /Count 1 >>',
    '<< /Title (Chapter Two) /Parent 7 0 R /Dest [6 0 R /Fit] >>',
    '<< /Type /Filespec /F (note.txt) /UF (note.txt) /EF << /F 10 0 R >> >>',
    stream(attachment,'/Type /EmbeddedFile /Subtype /text#2Fplain'),
    '<< /Type /OCG /Name (Test Layer) >>',stream(second),
  ];
  let result='%PDF-1.7\n';const offsets=[];
  objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(result));result+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const xref=Buffer.byteLength(result);result+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  offsets.forEach(offset=>result+=String(offset).padStart(10,'0')+' 00000 n \n');
  result+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(result);
}
if(process.argv[2])await fs.writeFile(path.resolve(process.argv[2]),createReaderFixture(),{flag:'wx'});
