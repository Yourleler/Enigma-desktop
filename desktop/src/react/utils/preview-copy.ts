export function previewCopyText(content:string,type?:string):string {
  if(type!=='docx'&&type!=='xlsx')return content;
  const template=document.createElement('template');template.innerHTML=content;
  template.content.querySelectorAll('script,style').forEach(node=>node.remove());
  template.content.querySelectorAll('td,th').forEach(node=>node.append('\t'));
  template.content.querySelectorAll('tr,p,h1,h2,h3,h4,h5,h6,summary,li,br').forEach(node=>node.append('\n'));
  return (template.content.textContent||'').replace(/\t\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
