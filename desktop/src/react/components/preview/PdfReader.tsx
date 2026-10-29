import {useEffect, useRef, useState, type KeyboardEvent} from 'react';
import type {PDFDocumentLoadingTask} from 'pdfjs-dist';
import type {PDFViewer} from 'pdfjs-dist/types/web/pdf_viewer';
import type {EventBus} from 'pdfjs-dist/types/web/event_utils';
import {openInternalLink} from '../../utils/link-open';
import './PdfReader.css';

interface Props {url:string;name:string;base64?:string;restoreKey?:string;onSystemReader:()=>void}
const positions=new Map<string,{page:number;scale:string;rotation:number}>();
/** Reader controls live outside PDF content. The upstream viewer supplies text,
 * annotation and incremental page layers; document scripts are never enabled. */
export default function PdfReader({url,name,base64,restoreKey=url,onSystemReader}:Props) {
  const host=useRef<HTMLDivElement>(null),pages=useRef<HTMLDivElement>(null),search=useRef<HTMLInputElement>(null);
  const viewer=useRef<PDFViewer|null>(null),bus=useRef<EventBus|null>(null);
  const [ready,setReady]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const [page,setPage]=useState(1),[pageDraft,setPageDraft]=useState('1'),[count,setCount]=useState(0);
  const [scale,setScale]=useState('page-width'),[percent,setPercent]=useState(100);
  const [query,setQuery]=useState(''),[matches,setMatches]=useState({current:0,total:0}),[finding,setFinding]=useState(false);
  const [styles,setStyles]=useState(''),[notice,setNotice]=useState('');
  const dispatchFind=(type='',back=false,value=query)=>bus.current?.dispatch('find',{source:host.current,type,query:value,caseSensitive:false,entireWord:false,highlightAll:true,findPrevious:back,matchDiacritics:false});
  useEffect(()=>{
    let timedOut=false,cancelled=false,loading:PDFDocumentLoadingTask|undefined,port:Worker|undefined,pdfViewer:PDFViewer|undefined;
    let resize:ResizeObserver|undefined;
    const abort=new AbortController();
    setReady(false);setError('');setCount(0);setPage(1);setPageDraft('1');setQuery('');setMatches({current:0,total:0});setScale('page-width');
    const timer=setTimeout(()=>{if(!cancelled){timedOut=true;setError('PDF 加载超时，可重试或使用系统阅读器。');void loading?.destroy().catch(()=>{});port?.terminate();}},25000);
    void (async()=>{
      // Load core before viewer: the official component bundle consumes pdfjsLib.
      const pdf=await import('pdfjs-dist');
      const [{PDFViewer,PDFLinkService,PDFFindController,EventBus},{default:WorkerModule},{default:css}]=await Promise.all([
        import('pdfjs-dist/web/pdf_viewer.mjs'),import('pdfjs-dist/build/pdf.worker.mjs?worker'),import('pdfjs-dist/web/pdf_viewer.css?inline'),
      ]);
      if(cancelled||timedOut||!host.current||!pages.current)return;
      setStyles(`@scope (.enigma-pdf-pages) {${css.replace(/:root/g,':scope')}}`);
      port=new WorkerModule();
      const eventBus=new EventBus(),links=new PDFLinkService({eventBus,externalLinkTarget:2,externalLinkRel:'noopener noreferrer',ignoreDestinationZoom:true});
      const originalLinkAttributes=links.addLinkAttributes.bind(links);
      links.addLinkAttributes=(link,href,newWindow)=>{originalLinkAttributes(link,href,newWindow);link.dataset.pdfExternal='true';};
      const finder=new PDFFindController({eventBus,linkService:links});
      const viewerOptions={abortSignal:abort.signal,container:host.current,viewer:pages.current,eventBus,linkService:links,findController:finder,
        annotationMode:pdf.AnnotationMode.ENABLE,enablePermissions:true,enableAutoLinking:false,maxCanvasPixels:16*1024*1024,
        imageResourcesPath:new URL('pdfjs/images/',document.baseURI).href};
      pdfViewer=new PDFViewer(viewerOptions);
      viewer.current=pdfViewer;bus.current=eventBus;links.setViewer(pdfViewer);
      eventBus.on('pagesinit',()=>{if(cancelled)return;const saved=positions.get(restoreKey);pdfViewer!.pagesRotation=saved?.rotation||0;pdfViewer!.currentScaleValue=saved?.scale||'page-width';if(saved)pdfViewer!.currentPageNumber=Math.min(pdfViewer!.pagesCount,saved.page);setReady(true);clearTimeout(timer);});
      eventBus.on('pagechanging',(event:{pageNumber:number})=>{if(!cancelled){setPage(event.pageNumber);setPageDraft(String(event.pageNumber));}});
      eventBus.on('scalechanging',(event:{scale:number;presetValue?:string})=>{if(!cancelled){setPercent(Math.round(event.scale*100));setScale(event.presetValue||String(event.scale));}});
      eventBus.on('updatefindmatchescount',(event:{matchesCount:{current:number;total:number}})=>{if(!cancelled)setMatches(event.matchesCount);});
      eventBus.on('updatefindcontrolstate',(event:{state:number;matchesCount:{current:number;total:number}})=>{if(!cancelled){setFinding(event.state===3);setMatches(event.matchesCount);}});
      eventBus.on('pagerendered',(event:{error?:unknown})=>{if(!cancelled&&event.error)setError('此页无法完整显示，请使用系统阅读器查看。');});
      const data=base64?Uint8Array.from(atob(base64),char=>char.charCodeAt(0)):undefined;
      loading=pdf.getDocument({...data?{data}:{url},worker:pdf.PDFWorker.create({port}),isEvalSupported:false,enableXfa:false,useWasm:false,
        cMapUrl:new URL('pdfjs/cmaps/',document.baseURI).href,cMapPacked:true,standardFontDataUrl:new URL('pdfjs/standard_fonts/',document.baseURI).href});
      const documentProxy=await loading.promise;
      if(cancelled||timedOut)return;
      setCount(documentProxy.numPages);links.setDocument(documentProxy);pdfViewer.setDocument(documentProxy);
      resize=new ResizeObserver(()=>{if(!cancelled&&pdfViewer?.pdfDocument&&['page-width','page-fit'].includes(pdfViewer.currentScaleValue))pdfViewer.currentScaleValue=pdfViewer.currentScaleValue;});
      resize.observe(host.current);
      // External links use the same application routing as Markdown links.
      host.current.addEventListener('click',event=>{
        const link=event.target instanceof Element?event.target.closest<HTMLAnchorElement>('a[href]'):null;
        if(!link?.dataset.pdfExternal)return;
        event.preventDefault();event.stopPropagation();
        if(/^https?:/i.test(link.getAttribute('href')||''))void openInternalLink(link.href,{origin:'desk'});
        else setNotice('此链接类型不支持在阅读器中打开。');
      },{signal:abort.signal});
    })().catch(reason=>{if(!cancelled&&!timedOut){clearTimeout(timer);setError(reason?.name==='PasswordException'?'此 PDF 需要密码，请在系统阅读器中解锁。':'PDF 无法读取或渲染，可重试或使用系统阅读器。');}});
    return()=>{
      cancelled=true;clearTimeout(timer);abort.abort();resize?.disconnect();viewer.current=null;bus.current=null;
      if(pdfViewer?.pdfDocument){positions.delete(restoreKey);positions.set(restoreKey,{page:pdfViewer.currentPageNumber,scale:pdfViewer.currentScaleValue,rotation:pdfViewer.pagesRotation});if(positions.size>32)positions.delete(positions.keys().next().value!);}
      // The viewer explicitly supports null to release all page/text layers.
      pdfViewer?.setDocument(null as unknown as Parameters<PDFViewer['setDocument']>[0]);
      void loading?.destroy().catch(()=>{}).finally(()=>port?.terminate());
      if(!loading)port?.terminate();
      pages.current?.replaceChildren();
    };
  },[url,base64,restoreKey,attempt]);
  useEffect(()=>{if(!ready)return;const timer=setTimeout(()=>dispatchFind('',false,query),180);return()=>clearTimeout(timer);},[query,ready]);
  const goPage=(next:number)=>{if(viewer.current&&ready){viewer.current.currentPageNumber=Math.min(count,Math.max(1,next));setPageDraft(String(viewer.current.currentPageNumber));}};
  const commitPage=()=>{const next=Number(pageDraft);if(Number.isInteger(next)&&next>0)goPage(next);else setPageDraft(String(page));};
  const keyDown=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='f'){event.preventDefault();event.stopPropagation();search.current?.focus();search.current?.select();}};
  return <section className="enigma-pdf-reader" aria-label={`${name}阅读器`} onKeyDown={keyDown}>
    <style>{styles}</style>
    <div className="enigma-pdf-toolbar" role="group" aria-label="PDF 工具栏">
      <div className="enigma-pdf-heading"><b title={name}>{name}</b><button onClick={onSystemReader} title="打开内置系统 PDF 控件，用于打印、下载与填写表单">系统阅读器</button></div>
      <div className="enigma-pdf-navigation">
        <button aria-label="上一页" title="上一页" disabled={!ready||page<=1} onClick={()=>goPage(page-1)}>‹</button>
        <label><input aria-label="PDF 页码" type="text" inputMode="numeric" value={pageDraft} disabled={!ready} onChange={event=>setPageDraft(event.target.value)} onBlur={commitPage} onKeyDown={event=>{if(event.key==='Enter')commitPage();}}/><span> / {count||'—'} 页</span></label>
        <button aria-label="下一页" title="下一页" disabled={!ready||page>=count} onClick={()=>goPage(page+1)}>›</button>
        <button aria-label="缩小 PDF" title="缩小" disabled={!ready} onClick={()=>viewer.current?.updateScale({steps:-1})}>−</button>
        <select aria-label="PDF 缩放" disabled={!ready} value={scale} onChange={event=>{if(viewer.current)viewer.current.currentScaleValue=event.target.value;}}>
          <option value="page-width">适应宽度</option><option value="page-fit">整页</option>
          {['0.5','0.75','1','1.25','1.5','2'].map(value=><option key={value} value={value}>{Number(value)*100}%</option>)}
          {!['page-width','page-fit','0.5','0.75','1','1.25','1.5','2'].includes(scale)&&<option value={scale}>{percent}%</option>}
        </select>
        <button aria-label="放大 PDF" title="放大" disabled={!ready} onClick={()=>viewer.current?.updateScale({steps:1})}>＋</button>
        <button aria-label="旋转 PDF" title="顺时针旋转 90°" disabled={!ready} onClick={()=>{if(viewer.current){const number=viewer.current.currentPageNumber;viewer.current.pagesRotation=(viewer.current.pagesRotation+90)%360;viewer.current.currentPageNumber=number;}}}>↻</button>
      </div>
      <div className="enigma-pdf-search"><input ref={search} aria-label="搜索 PDF 内容" placeholder="搜索文档内容" value={query} disabled={!ready} onChange={event=>{setFinding(!!event.target.value);setQuery(event.target.value);}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();dispatchFind('again',event.shiftKey);}if(event.key==='Escape'){setQuery('');search.current?.blur();}}}/><span role="status">{query?(finding?'搜索中':matches.total?`${matches.current} / ${matches.total}`:'未找到'):''}</span><button aria-label="上一个匹配" title="上一个匹配 · Shift+Enter" disabled={!ready||!query} onClick={()=>dispatchFind('again',true)}>↑</button><button aria-label="下一个匹配" title="下一个匹配 · Enter" disabled={!ready||!query} onClick={()=>dispatchFind('again')}>↓</button></div>
    </div>
    {notice&&<small className="enigma-pdf-hint" role="status">{notice}</small>}
    <div className="enigma-pdf-body">
      <div ref={host} className="enigma-pdf-pages" tabIndex={0} aria-label="PDF 正文"><div ref={pages} className="pdfViewer"/></div>
      {!ready&&!error&&<div className="enigma-pdf-notice" role="status">正在加载 PDF…</div>}
      {error&&<div className="enigma-pdf-notice" role="alert"><p>{error}</p><button onClick={()=>setAttempt(value=>value+1)}>重新加载</button><button onClick={onSystemReader}>系统阅读器</button></div>}
    </div>
    <small className="enigma-pdf-hint">可选择并复制文字 · 搜索仅覆盖文档文字，扫描件需要 OCR · 打印、表单使用系统阅读器</small>
  </section>;
}
