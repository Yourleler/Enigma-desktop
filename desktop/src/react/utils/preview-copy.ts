export function previewCopyInfo(type?:string){
  if(type==='html')return {label:'复制源码',description:'复制整个 HTML 文件的源码，包含样式与脚本。'};
  if(type==='markdown')return {label:'复制 Markdown',description:'复制整份文档的 Markdown 文本，包含标题、链接等格式标记。'};
  if(type==='code')return {label:'复制代码',description:'复制当前文件的全部代码。'};
  return {label:'复制全文',description:'复制当前文档的全部文本。'};
}
export function previewCopyText(content:string,type?:string):string {
  if(type!=='docx'&&type!=='xlsx')return content;
  const template=document.createElement('template');template.innerHTML=content;
  template.content.querySelectorAll('script,style').forEach(node=>node.remove());
  template.content.querySelectorAll('td,th').forEach(node=>node.append('\t'));
  template.content.querySelectorAll('tr,p,h1,h2,h3,h4,h5,h6,summary,li,br').forEach(node=>node.append('\n'));
  return (template.content.textContent||'').replace(/\t\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
