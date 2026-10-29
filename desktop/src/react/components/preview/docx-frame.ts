import {completeDocxPageGeometry} from './docx-page-geometry';
/** Self-contained runtime executed only in an opaque sandboxed iframe. */
function docxRuntime(channel:string,completePages:(root:HTMLElement)=>number) {
  const root=document.getElementById('document')!,styles=document.getElementById('document-styles')!;
  let ready=false,scale='fit',marks:HTMLElement[]=[],ranges:Range[]=[],match=0,truncated=false;
  const highlightApi=(CSS as unknown as {highlights?:Map<string,unknown>}).highlights,HighlightClass=(window as unknown as {Highlight?:new(...ranges:Range[])=>unknown}).Highlight;
  const send=(type:string,value:Record<string,unknown>={})=>parent.postMessage({channel,type,...value},'*');
  const pages=()=>Array.from(root.querySelectorAll<HTMLElement>('section.docx'));
  const fit=()=>{
    const width=Math.max(1,...pages().map(page=>page.offsetWidth));
    root.style.width=`${width+24}px`;root.style.minWidth='0';
    const zoom=scale==='fit'?Math.min(1,(document.documentElement.clientWidth-2)/(width+24)):Number(scale);
    root.style.zoom=String(Math.max(.1,zoom));
  };
  const find=(query:string)=>{
    marks.forEach(mark=>mark.replaceWith(...mark.childNodes));root.normalize();marks=[];ranges=[];match=0;truncated=false;highlightApi?.delete('docx-results');highlightApi?.delete('docx-current');
    if(query&&highlightApi&&HighlightClass){
      // Search a paragraph's combined text so inline bold/links do not split a match.
      const paragraphs=Array.from(root.querySelectorAll('p'));const blocks=paragraphs.length?paragraphs:[root];
      for(const block of blocks){
        if(ranges.length>=2001)break;
        const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT),nodes:Text[]=[];let node:Node|null;
        while(node=walker.nextNode())nodes.push(node as Text);
        const value=nodes.map(node=>node.data).join(''),pattern=new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'giu');
        for(const found of value.matchAll(pattern)){
          if(ranges.length>=2001)break;
          const boundary=(position:number)=>{let at=position;for(let index=0;index<nodes.length;index++){if(at<=nodes[index].length)return {node:nodes[index],offset:at};at-=nodes[index].length;}return {node:nodes[nodes.length-1],offset:nodes[nodes.length-1].length};};
          const from=boundary(found.index!),to=boundary(found.index!+found[0].length),range=document.createRange();range.setStart(from.node,from.offset);range.setEnd(to.node,to.offset);ranges.push(range);
        }
      }
      truncated=ranges.length>2000;ranges=ranges.slice(0,2000);
      highlightApi.set('docx-results',new HighlightClass(...ranges));showMatch();return;
    }
    if(query){const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);const nodes:Text[]=[];let node:Node|null;
      while(node=walker.nextNode()){const parent=(node as Text).parentElement;if(parent&&!parent.closest('style,script'))nodes.push(node as Text);}
      const needle=query.toLocaleLowerCase();
      for(const text of nodes){if(marks.length>=2001)break;const value=text.data,lower=value.toLocaleLowerCase();let start=0,index=lower.indexOf(needle);if(index<0)continue;const fragment=document.createDocumentFragment();
        while(index>=0&&marks.length<2001){fragment.append(value.slice(start,index));const mark=document.createElement('mark');mark.textContent=value.slice(index,index+query.length);fragment.append(mark);marks.push(mark);start=index+query.length;index=lower.indexOf(needle,start);}
        fragment.append(value.slice(start));text.replaceWith(fragment);
      }
    }
    truncated=marks.length>2000;marks.splice(2000).forEach(mark=>mark.replaceWith(...mark.childNodes));
    showMatch();
  };
  const showMatch=()=>{const count=ranges.length||marks.length;if(ranges.length&&highlightApi&&HighlightClass){highlightApi.set('docx-current',new HighlightClass(ranges[match]));const rect=ranges[match].getBoundingClientRect();scrollBy(rect.left<0||rect.right>innerWidth?rect.left+rect.width/2-innerWidth/2:0,rect.top+rect.height/2-innerHeight/2);}else{marks.forEach((item,index)=>item.classList.toggle('current-match',index===match));marks[match]?.scrollIntoView({block:'center'});}send('matches',{count,index:count?match+1:0,truncated});};
  addEventListener('message',async event=>{
    if(event.source!==parent||event.data?.channel!==channel)return;const data=event.data;
    if(data.type==='hello'){send('ready');return;}
    if(data.type==='render'&&!ready){
      ready=true;
      try{
        const docx=(window as unknown as {docx:{renderAsync(data:Uint8Array,root:HTMLElement,styles:HTMLElement,options:object):Promise<void>}}).docx;
        await docx.renderAsync(data.bytes,root,styles,{inWrapper:true,breakPages:true,ignoreLastRenderedPageBreak:false,renderHeaders:true,renderFooters:true,renderFootnotes:true,renderEndnotes:true,renderComments:false,renderChanges:false,renderAltChunks:false,useBase64URL:true,experimental:false});
        // No document scripts, remote resources or privileged DOM are available.
        root.querySelectorAll('script,iframe,object,embed,form').forEach(el=>el.remove());
        root.querySelectorAll('*').forEach(el=>{for(const attribute of Array.from(el.attributes))if(attribute.name.startsWith('on'))el.removeAttribute(attribute.name);});
        const defaultPages=completePages(root);
        const images=Array.from(root.querySelectorAll('img'));await Promise.all(images.map(image=>image.complete?Promise.resolve():new Promise<void>(resolve=>{image.onload=image.onerror=()=>resolve();setTimeout(resolve,1500);})));fit();
        send('rendered',{pages:pages().length,warnings:[defaultPages?'部分页面缺少纸张参数，缺失项按 A4 和 2.54 cm 页边距预览；原文件未修改。':'',images.some(image=>!image.naturalWidth)?'部分图片未能显示，外部资源不会自动加载。':''].filter(Boolean).join(' ')});
      }catch{send('error',{message:'DOCX 版式无法渲染，可切换文本阅读或用系统应用打开。'});}
    }else if(data.type==='zoom'){scale=data.value;fit();}
    else if(data.type==='find')find(String(data.query||''));
    else if(data.type==='next'&&(ranges.length||marks.length)){const count=ranges.length||marks.length;match=(match+data.direction+count)%count;showMatch();}
    else if(data.type==='page')pages()[Math.max(0,Math.min(pages().length-1,Number(data.page)-1))]?.scrollIntoView({block:'start'});
    else if(data.type==='restore')scrollTo(0,Math.max(0,Number(data.top)||0));
    else if(data.type==='theme')document.documentElement.dataset.theme=data.dark?'dark':'light';
  });
  addEventListener('resize',fit);
  addEventListener('scroll',()=>{if(ready)send('position',{top:scrollY});},{passive:true});
  addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='f'){event.preventDefault();send('focus-find');}});
  root.addEventListener('click',event=>{const link=(event.target as Element).closest('a[href]');if(!link)return;const href=link.getAttribute('href')||'';if(href.startsWith('#'))return;event.preventDefault();if(/^https?:\/\//i.test(href))send('link',{href});});
  send('ready');
}
const escapeScript=(script:string)=>script.replace(/<\/script/gi,'<\\/script');
export function docxFrameHtml({nonce,zipScript,docxScript}:{nonce:string;zipScript:string;docxScript:string}):string {
  const runtime=`(${docxRuntime.toString()})(location.hash.slice(1),${completeDocxPageGeometry.toString()});`;
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'"><style>
html{background:#efecf5;color-scheme:light}html[data-theme=dark]{background:#0e1820}body{margin:0;overflow:auto;font:14px system-ui}.docx-wrapper{background:transparent!important;padding:12px!important;min-width:max-content}.docx-wrapper>section.docx{box-shadow:0 2px 12px #0002;margin-bottom:16px!important}#document{width:fit-content;min-width:100%;transform-origin:top left}mark{background:#e8d5ff;color:inherit}mark.current-match{background:#cab0ff;outline:2px solid #815ec2}::highlight(docx-results){background:#e8d5ff;color:inherit}::highlight(docx-current){background:#cab0ff;color:inherit}::selection{background:#cab0ff80}a{cursor:pointer}
</style><div id="document-styles"></div><div id="document"></div><script nonce="${nonce}">addEventListener("error",()=>parent.postMessage({channel:location.hash.slice(1),type:"error",message:"文档预览组件未能启动，请重试或切换文本阅读。"},"*"));</script><script nonce="${nonce}">${escapeScript(zipScript)}</script><script nonce="${nonce}">${escapeScript(docxScript)}</script><script nonce="${nonce}">${escapeScript(runtime)}</script></html>`;
}
