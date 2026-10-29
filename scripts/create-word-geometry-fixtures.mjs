import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import JSZip from 'jszip';
/** Original local documents for default geometry and exact/truncated search checks. */
export async function createWordGeometryFixtures(directory){
 const write=async(name,body,section='')=>{
  const zip=new JSZip();
  zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml',`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}${section}</w:body></w:document>`);
  await fs.writeFile(path.join(directory,name),await zip.generateAsync({type:'nodebuffer'}),{flag:'wx'});
 };
 const p=text=>`<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
 await write('default-paper.docx',p('未声明纸张参数的原创新建文档。')+p('这段正文应在完整白色纸张上显示。'));
 await write('declared-landscape.docx',p('明确声明 A4 横向和零页边距。'),'<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0"/></w:sectPr>');
 await write('size-missing-zero-margin.docx',p('缺少尺寸，显式零边距应保持。'),'<w:sectPr><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0"/></w:sectPr>');
 for(const [name,count]of [['many-results',2001],['exact-results',2000]]){
  await write(name+'.docx',p('needle '.repeat(count))+p('İ before Match and MATCH'));
  await fs.writeFile(path.join(directory,name+'.md'),'# 搜索数量验收\n\n'+'needle '.repeat(count)+'\n\n需要**跨格式**匹配。\n',{flag:'wx'});
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)&&process.argv[2])await createWordGeometryFixtures(path.resolve(process.argv[2]));
