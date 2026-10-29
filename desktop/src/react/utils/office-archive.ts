/** Validate OOXML sizes before handing the ZIP to a browser renderer. */
export function checkOfficeArchive(data:Uint8Array):void {
  if(data.byteLength>20*1024*1024)throw new Error('文档超过 20 MB，请使用系统应用打开');
  const view=new DataView(data.buffer,data.byteOffset,data.byteLength);let end=-1;
  for(let at=data.length-22;at>=Math.max(0,data.length-65557);at--)if(view.getUint32(at,true)===0x06054b50){end=at;break;}
  if(end<0)throw new Error('文档已损坏，无法读取 Office 文件');
  const entries=view.getUint16(end+10,true),size=view.getUint32(end+12,true),offset=view.getUint32(end+16,true);
  if(entries>2000||size>4*1024*1024||offset+size>end)throw new Error('文档结构过大或无效，请使用系统应用打开');
  let expanded=0,at=offset;
  for(let i=0;i<entries;i++){
    if(at+46>offset+size||view.getUint32(at,true)!==0x02014b50)throw new Error('文档目录已损坏');
    expanded+=view.getUint32(at+24,true);if(expanded>80*1024*1024)throw new Error('文档展开后超过 80 MB，请使用系统应用打开');
    at+=46+view.getUint16(at+28,true)+view.getUint16(at+30,true)+view.getUint16(at+32,true);
    if(at>offset+size)throw new Error('文档目录已损坏');
  }
}
