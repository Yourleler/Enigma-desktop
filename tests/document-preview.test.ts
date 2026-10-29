import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,beforeEach,expect,it} from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {Hono} from 'hono';
import {readOfficePreview,inspectPdfPreview} from '../lib/document-preview.ts';
import {createTestPdf} from '../scripts/create-preview-documents.mjs';
import {createOfficePreviewRoute} from '../server/routes/office-preview.ts';
let root: string;
beforeEach(async()=>{root=await fs.mkdtemp(path.join(os.tmpdir(),'enigma-office-test-'));});
afterEach(()=>fs.rm(root,{recursive:true,force:true}));

it('previews every ordinary worksheet and escapes cell and sheet text',async()=>{
  const book=new ExcelJS.Workbook();
  book.addWorksheet('第一张').addRow(['名称','数量']);
  book.addWorksheet('第二张').addRow(['<script>unsafe</script>',3]);
  const file=path.join(root,'new.xlsx');await book.xlsx.writeFile(file);
  const result=await readOfficePreview(file);
  expect(result.html).toContain('第一张');expect(result.html).toContain('第二张');
  expect(result.html).toContain('&lt;script&gt;unsafe&lt;/script&gt;');
  expect(result.html).not.toContain('<script>');expect(result.version.size).toBeGreaterThan(0);
});

it('converts a newly generated Word document without extracting files',async()=>{
  const zip=new JSZip();
  zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>新建文档的中文正文</w:t></w:r></w:p></w:body></w:document>');
  const file=path.join(root,'new.docx');await fs.writeFile(file,await zip.generateAsync({type:'nodebuffer'}));
  expect((await readOfficePreview(file)).html).toContain('新建文档的中文正文');
  expect(await fs.readdir(root)).toEqual(['new.docx']);
});

it('reports malformed, legacy and oversized documents explicitly',async()=>{
  const bad=path.join(root,'broken.docx');await fs.writeFile(bad,'not a document');
  await expect(readOfficePreview(bad)).rejects.toThrow('损坏');
  await expect(readOfficePreview(path.join(root,'legacy.xls'),'xlsx')).rejects.toThrow('旧版 XLS');
  const large=path.join(root,'large.xlsx');const file=await fs.open(large,'w');await file.truncate(21*1024*1024);await file.close();
  await expect(readOfficePreview(large)).rejects.toThrow('20 MB');
});

it('inspects actual PDF structure and rejects malformed content',async()=>{
  const pdf=path.join(root,'new.pdf');await fs.writeFile(pdf,createTestPdf());expect((await inspectPdfPreview(pdf)).pages).toBe(2);
  await fs.writeFile(pdf,'broken');await expect(inspectPdfPreview(pdf)).rejects.toThrow('损坏');
});

it('resolves web office previews through the same authorized workbench roots',async()=>{
  const book=new ExcelJS.Workbook();book.addWorksheet('测试').addRow(['工作台内容']);
  await book.xlsx.writeFile(path.join(root,'new.xlsx'));
  const app=new Hono();app.route('/api',createOfficePreviewRoute({hanakoHome:root,homeCwd:root}));
  const request=(body:unknown)=>app.request('/api/preview/office',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const response=await request({format:'xlsx',remoteContentRef:{kind:'workbench-file',mountId:'default',subdir:'',name:'new.xlsx'}});
  expect(response.status).toBe(200);expect((await response.json()).html).toContain('工作台内容');
  expect((await request({format:'xlsx',sourceFilePath:path.join(root,'new.xlsx')})).status).toBe(403);
  expect((await request({format:'xlsx',remoteContentRef:{kind:'workbench-file',mountId:'default',subdir:'..',name:'new.xlsx'}})).status).not.toBe(200);
});
