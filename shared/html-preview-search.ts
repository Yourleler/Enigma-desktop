/** Runs inside the already-sandboxed document; it can report search counts only. */
export function installHtmlPreviewSearch(){
  let request:{id:string;query:string;index:number}|null=null;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const registry=(CSS as any).highlights,HighlightType=(window as any).Highlight;
  const clear=()=>{registry?.delete('enigma-preview-matches');registry?.delete('enigma-preview-current');};
  const scan=()=>{
    if(!request||!document.body)return;
    clear();const ranges:Range[]=[],groups=new Map<Element,Text[]>();let truncated=false;
    if(request.query){
      const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{acceptNode(node){
        const parent=node.parentElement;
        return parent&&node.nodeValue&&!parent.closest('script,style,noscript,[hidden],[aria-hidden="true"]')&&parent.getClientRects().length&&getComputedStyle(parent).visibility!=='hidden'?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;
      }});
      let node:Node|null,visited=0;
      while((node=walker.nextNode())){
        if(++visited>40000){truncated=true;break;}
        const block=node.parentElement?.closest('p,h1,h2,h3,h4,h5,h6,li,td,th,pre,blockquote,div')||document.body;
        const list=groups.get(block)||[];list.push(node as Text);groups.set(block,list);
      }
      const pattern=new RegExp(request.query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'giu');
      outer:for(const nodes of groups.values()){
        const text=nodes.map(node=>node.data).join('');
        for(const match of text.matchAll(pattern)){
          if(ranges.length>=2000){truncated=true;break outer;}
          const locate=(offset:number)=>{for(const node of nodes){if(offset<=node.length)return {node,offset};offset-=node.length;}return {node:nodes.at(-1)!,offset:nodes.at(-1)!.length};};
          const start=locate(match.index!),end=locate(match.index!+match[0].length),range=document.createRange();
          range.setStart(start.node,start.offset);range.setEnd(end.node,end.offset);ranges.push(range);
        }
      }
    }
    const index=Math.min(request.index,Math.max(0,ranges.length-1));
    if(registry&&HighlightType){registry.set('enigma-preview-matches',new HighlightType(...ranges));registry.set('enigma-preview-current',new HighlightType(...(ranges[index]?[ranges[index]]:[])));}
    ranges[index]?.startContainer.parentElement?.scrollIntoView({block:'center',inline:'nearest'});
    parent.postMessage({type:'enigma-preview-find-result',id:request.id,count:ranges.length,index,truncated},'*');
  };
  window.addEventListener('message',event=>{
    const data=event.data;if(event.source!==parent||data?.type!=='enigma-preview-find'||typeof data.id!=='string'||typeof data.query!=='string')return;
    request={id:data.id,query:data.query.slice(0,512),index:Number.isInteger(data.index)?Math.max(0,data.index):0};scan();
  });
  window.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='f'){event.preventDefault();parent.postMessage({type:'enigma-preview-find-open'},'*');}});
  const ready=()=>{
    const style=document.createElement('style');style.textContent='::highlight(enigma-preview-matches){background:#ffe89a;color:#24201a}::highlight(enigma-preview-current){background:#c8b6ff;color:#221639}';document.head.append(style);
    const observer=new MutationObserver(()=>{if(!request?.query)return;clearTimeout(timer);timer=setTimeout(scan,100);});observer.observe(document.body,{subtree:true,childList:true,characterData:true});
    scan();
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready();
}

export const withHtmlPreviewSearch=(content:string)=>`${content}\n<script data-enigma-preview-search>(${installHtmlPreviewSearch.toString()})();</script>`;
