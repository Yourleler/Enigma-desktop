/** Display-only fallback for documents whose section properties omit paper geometry.
 * Every declared size and margin (including zero margin) remains authoritative. */
export function completeDocxPageGeometry(root:HTMLElement):number {
 let changedPages=0;
 for(const page of root.querySelectorAll<HTMLElement>('section.docx')){
  let changed=false;
  if(!page.style.width||!Number.isFinite(parseFloat(page.style.width))||parseFloat(page.style.width)<=0){page.style.width='210mm';changed=true;}
  if(!page.style.minHeight&&!page.style.height){page.style.minHeight='297mm';changed=true;}
  for(const side of ['paddingTop','paddingRight','paddingBottom','paddingLeft'] as const){
   if(!page.style[side]){page.style[side]='25.4mm';changed=true;}
  }
  if(changed){page.dataset.defaultPaper='true';changedPages++;}
 }
 return changedPages;
}
