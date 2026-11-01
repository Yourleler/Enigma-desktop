/** Preserve a point on the current paper page while its CSS zoom changes. */
export function refitDocxReading(root:HTMLElement,resize:()=>void,currentMatch?:Range|HTMLElement|null){
 const viewport=root.ownerDocument.defaultView!;
 const current=currentMatch?.getBoundingClientRect();
 const matchVisible=!!current&&current.height>0&&current.bottom>0&&current.top<viewport.innerHeight;
 const center=viewport.innerHeight/2;
 const pages=Array.from(root.querySelectorAll<HTMLElement>('section.docx'));
 const page=pages.find(element=>element.getBoundingClientRect().bottom>=center)||pages.at(-1);
 const anchor=matchVisible?currentMatch:page;
 const before=anchor?.getBoundingClientRect();
 const y=matchVisible?Math.min(viewport.innerHeight,Math.max(0,current!.top+current!.height/2)):center;
 const ratio=before&&before.height>0?(y-before.top)/before.height:0;
 resize();
 if(anchor&&before&&before.height>0){const after=anchor.getBoundingClientRect();viewport.scrollBy(0,after.top+after.height*ratio-y);}
}
