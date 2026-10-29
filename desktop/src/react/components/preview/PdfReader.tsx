import {useEffect,useRef,useState} from 'react';
import {useStore} from '../../stores';
import {openInternalLink} from '../../utils/link-open';
import {pdfViewerOptions} from '../../utils/pdf-viewer-options';
import './PdfReader.css';
import {version as appVersion} from '../../../../../package.json';

interface ViewPosition {page:number;zoom:string;rotation:number}
interface ViewerWindow extends Window {
  PDFViewerApplicationOptions:{setAll(options:Record<string,unknown>):void;get(key:string):unknown};
  PDFViewerApplication:{
    initializedPromise:Promise<void>;initialBookmark?:string|null;initialRotation?:number;
    _initializeAutoPrint:()=>Promise<void>;
    open(options:{data:Uint8Array}):Promise<void>;close():Promise<void>;
    setTitleUsingUrl(url:string):void;
    downloadManager:{downloadData:(data:Uint8Array,name:string,mime?:string)=>void;openOrDownloadData:(data:Uint8Array,name:string)=>boolean;download:(data:Uint8Array,url:string,name:string)=>void};
    eventBus:{on(name:string,handler:(event:any)=>void):void};
    pdfDocument?:{numPages:number};
    pdfViewer:{currentPageNumber:number;currentScaleValue:string;pagesRotation:number};
  };
}
interface Props {url:string;name:string;base64?:string;restoreKey?:string;onSystemReader:()=>void}
const positions=new Map<string,ViewPosition>();

/** Embed Mozilla's complete viewer UI, rather than duplicating its toolbar,
 * outline, thumbnails, search and printing with application-owned controls. */
export default function PdfReader({url,name,base64,restoreKey=url,onSystemReader}:Props) {
  const frame=useRef<HTMLIFrameElement>(null),app=useRef<ViewerWindow['PDFViewerApplication']|null>(null);
  const [ready,setReady]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[frameUrl,setFrameUrl]=useState('');
  const locale=useStore(state=>state.locale)||'zh';
  const title=useRef(name),loadSequence=useRef(0);title.current=name;
  useEffect(()=>{
    let stopped=false,configured:ViewerWindow|null=null;
    const abort=new AbortController();
    const downloads=new Map<string,ReturnType<typeof setTimeout>>();
    const dark=()=>getComputedStyle(document.documentElement).colorScheme.includes('dark')||document.documentElement.dataset.theme?.startsWith('midnight');
    setReady(false);setError('');
    const configure=(event:Event)=>{
      const target=(event as CustomEvent).detail?.source as ViewerWindow|undefined;
      if(!target||target!==frame.current?.contentWindow)return;
      target.PDFViewerApplicationOptions.setAll(pdfViewerOptions(locale,!!dark()));configured=target;
    };
    document.addEventListener('webviewerloaded',configure);
    const syncTheme=()=>{
      const doc=frame.current?.contentDocument;
      if(!doc?.documentElement)return;
      doc.documentElement.dataset.enigmaTheme=dark()?'dark':'light';
    };
    const observer=new MutationObserver(syncTheme);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','style']});
    const timer=setTimeout(()=>{if(!stopped){setError('PDF 加载超时，可重试或使用系统阅读器。');abort.abort();}},30000);
    const loaded=async()=>{
      try {
        if(frame.current?.getAttribute('src')==='about:blank')return;
        const win=frame.current?.contentWindow as ViewerWindow|null;
        if(win?.location.href==='about:blank')return;
        if(!win||win!==configured||win.PDFViewerApplicationOptions.get('enableScripting')!==false)throw new Error('PDF 阅读器初始化失败');
        const viewer=win.PDFViewerApplication;await viewer.initializedPromise;
        if(stopped)return;app.current=viewer;syncTheme();
        viewer._initializeAutoPrint=async()=>{};
        const saved=positions.get(restoreKey);
        if(saved){viewer.initialBookmark=`page=${saved.page}&zoom=${Number.isFinite(Number(saved.zoom))?Number(saved.zoom)*100:saved.zoom}`;viewer.initialRotation=saved.rotation;}
        const download=(data:Uint8Array,filename:string,mime='application/octet-stream')=>{
          const href=URL.createObjectURL(new Blob([new Uint8Array(data)],{type:mime}));
          const anchor=document.createElement('a');anchor.href=href;anchor.download=filename.replace(/[\\/]/g,'_');document.body.append(anchor);anchor.click();anchor.remove();
          downloads.set(href,setTimeout(()=>{URL.revokeObjectURL(href);downloads.delete(href);},60000));
        };
        // Parent owns downloads: iframe-targeted downloads are unreliable in
        // embedded Web clients. Use upstream data, with no remote service.
        if(viewer.downloadManager){
          viewer.downloadManager.downloadData=download;
          viewer.downloadManager.openOrDownloadData=(data,filename)=>{download(data,filename,filename.toLowerCase().endsWith('.pdf')?'application/pdf':'application/octet-stream');return false;};
          viewer.downloadManager.download=(data,_url,filename)=>download(data,filename||title.current,'application/pdf');
        }
        // Use the same router as Markdown for external document links.
        win.document.addEventListener('click',event=>{
          const link=event.target&&typeof (event.target as Element).closest==='function'?(event.target as Element).closest('a[href]'):null;
          if(!link)return;
          const href=link.getAttribute('href')||'';
          if(!/^https?:/i.test(href))return;
          event.preventDefault();void openInternalLink(href,{origin:'desk'});
        });
        const remember=()=>{
          if(stopped||!viewer.pdfDocument)return;
          positions.delete(restoreKey);positions.set(restoreKey,{page:viewer.pdfViewer.currentPageNumber,zoom:viewer.pdfViewer.currentScaleValue,rotation:viewer.pdfViewer.pagesRotation});
          if(positions.size>64)positions.delete(positions.keys().next().value!);
        };
        viewer.eventBus.on('documentinit',()=>{
          if(stopped)return;
          viewer.setTitleUsingUrl(title.current);setError('');setReady(true);clearTimeout(timer);
          for(const event of ['pagechanging','scalechanging','rotationchanging'])viewer.eventBus.on(event,remember);
        });
        let data:Uint8Array;
        if(base64)data=Uint8Array.from(atob(base64),char=>char.charCodeAt(0));
        else {const response=await fetch(url,{signal:abort.signal});if(!response.ok)throw new Error('无法读取 PDF');data=new Uint8Array(await response.arrayBuffer());}
        if(stopped)return;await viewer.open({data});
      }catch(reason){if(!stopped&&!abort.signal.aborted){clearTimeout(timer);setError(reason instanceof Error?reason.message:'PDF 无法打开');}}
    };
    const element=frame.current;element?.addEventListener('load',loaded);
    setFrameUrl(new URL(`assets/pdfjs-viewer-${appVersion}/web/enigma-viewer.html?file=&load=${++loadSequence.current}`,document.baseURI).href);
    return()=>{const viewer=app.current;if(viewer?.pdfDocument){positions.delete(restoreKey);positions.set(restoreKey,{page:viewer.pdfViewer.currentPageNumber,zoom:viewer.pdfViewer.currentScaleValue,rotation:viewer.pdfViewer.pagesRotation});if(positions.size>64)positions.delete(positions.keys().next().value!);}stopped=true;clearTimeout(timer);abort.abort();observer.disconnect();for(const [href,timer] of downloads){clearTimeout(timer);URL.revokeObjectURL(href);}document.removeEventListener('webviewerloaded',configure);element?.removeEventListener('load',loaded);void app.current?.close().catch(()=>{});app.current=null;};
  },[url,base64,restoreKey,attempt,locale]);
  return <section className="enigma-pdf-reader" aria-label={`${name}阅读器`}>
    <div className="enigma-pdf-heading"><b title={name}>{name}</b><span>PDF</span><button onClick={onSystemReader} title="使用系统阅读器填写表单或处理特殊文档">系统阅读器</button></div>
    <div className="enigma-pdf-body">
      <iframe ref={frame} src={frameUrl||'about:blank'} title={`${name} · 完整 PDF 阅读器`} className="enigma-pdf-full-viewer" allow="fullscreen"/>
      {!ready&&!error&&<div className="enigma-pdf-notice" role="status">正在加载完整 PDF 阅读器…</div>}
      {error&&<div className="enigma-pdf-notice" role="alert"><p>{error}</p><button onClick={()=>{setFrameUrl('');setAttempt(value=>value+1);}}>重新加载</button><button onClick={onSystemReader}>系统阅读器</button></div>}
    </div>
  </section>;
}
