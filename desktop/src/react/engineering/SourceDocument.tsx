import {useRef,useState} from 'react';
import {PreviewEditor,type PreviewEditorHandle} from '../components/PreviewEditor';
import {DocumentNavigation} from '../components/preview/DocumentNavigation';

/** Repository reads stay on their returned version; editor controls never write. */
export function SourceDocument({file,content,line}:{file:string;content:string;line?:number}){
  const editor=useRef<PreviewEditorHandle>(null),[wrap,setWrap]=useState(true),[notice,setNotice]=useState('');
  const located=useRef(false);
  return <div className="enigma-source-reader">
    <DocumentNavigation documentId={file} contentType="code" headings={[]} activeHeadingId={null} editable={false} wrapLines={wrap}
      onJump={()=>{}} onFind={()=>editor.current?.openSearch()} onGotoLine={()=>editor.current?.gotoLine()} onToggleWrap={()=>setWrap(value=>!value)}>
      <button title="复制当前源码全文" aria-label="复制当前源码全文" onClick={()=>{void navigator.clipboard.writeText(content).then(()=>setNotice('已复制源码')).catch(()=>setNotice('复制失败，请选择文本后复制'));}}>复制源码</button>
      <button title="跳转到行" aria-label="跳转到行" onClick={()=>editor.current?.gotoLine()}>#</button>
      <button title="自动换行" aria-label="自动换行" aria-pressed={wrap} onClick={()=>setWrap(value=>!value)}>↵</button>
    </DocumentNavigation>
    {notice&&<p role="status" className="enigma-source-note">{notice}</p>}
    <PreviewEditor ref={editor} content={content} mode="code" readOnly wrapLines={wrap} language={file.split('.').pop()} onStatsChange={()=>{
      const view=editor.current?.getView();if(located.current||!view||!Number.isInteger(line)||line!<1)return;
      located.current=true;const target=view.state.doc.line(Math.min(view.state.doc.lines,line!));editor.current?.scrollToOffset(target.from,target.to,{focus:false});
    }}/>
  </div>;
}
