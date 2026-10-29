/** Match rendered text across inline formatting without rewriting React-owned DOM. */
export function findTextRanges(root:HTMLElement,query:string,limit=2000):Range[]{
 if(!query)return [];
 const blocks=new Map<Element,Text[]>();
 const walker=root.ownerDocument.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode(node){const p=node.parentElement;return p&&!p.closest('script,style,button,input,textarea,[hidden],[aria-hidden=true]')&&node.nodeValue?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;}});
 let node:Node|null;
 while(node=walker.nextNode()){
  const block=node.parentElement?.closest('p,h1,h2,h3,h4,h5,h6,li,td,th,pre,blockquote,div')||root;
  const nodes=blocks.get(block)||[];nodes.push(node as Text);blocks.set(block,nodes);
 }
 const ranges:Range[]=[],pattern=new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'giu');
 for(const nodes of blocks.values()){
  const text=nodes.map(n=>n.data).join('');
  for(const match of text.matchAll(pattern)){
   if(ranges.length>=limit)return ranges;
   const position=(offset:number)=>{for(let index=0;index<nodes.length;index++){if(offset<=nodes[index].length)return {node:nodes[index],offset};offset-=nodes[index].length;}return {node:nodes.at(-1)!,offset:nodes.at(-1)!.length};};
   const from=position(match.index!),to=position(match.index!+match[0].length),range=root.ownerDocument.createRange();range.setStart(from.node,from.offset);range.setEnd(to.node,to.offset);ranges.push(range);
  }
 }
 return ranges;
}
export function createDocumentHighlights(root:HTMLElement){
 const registry=(globalThis.CSS as unknown as {highlights?:{set:(name:string,value:unknown)=>void;delete:(name:string)=>void}}|undefined)?.highlights;
 const HighlightType=(globalThis as unknown as {Highlight?:new(...ranges:Range[])=>unknown}).Highlight;
 if(!registry||!HighlightType)return null;
 return {set(ranges:Range[],index:number){registry.set('enigma-document-results',new HighlightType(...ranges));registry.set('enigma-document-current',new HighlightType(...(ranges[index]?[ranges[index]]:[])));},clear(){registry.delete('enigma-document-results');registry.delete('enigma-document-current');},scroll(range:Range|undefined){const target=range?.startContainer.parentElement;if(target&&root.contains(target))target.scrollIntoView({block:'center',inline:'nearest'});}};
}
