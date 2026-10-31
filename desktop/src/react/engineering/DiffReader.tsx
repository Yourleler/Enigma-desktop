import {useEffect,useRef,useState} from 'react';
import {EditorState,StateEffect} from '@codemirror/state';
import {LanguageDescription,syntaxHighlighting,defaultHighlightStyle} from '@codemirror/language';
import {languages} from '@codemirror/language-data';
import {EditorView,lineNumbers,highlightActiveLineGutter,keymap} from '@codemirror/view';
import {search,openSearchPanel,searchKeymap} from '@codemirror/search';
import {MergeView,unifiedMergeView,goToNextChunk,goToPreviousChunk,getChunks} from '@codemirror/merge';
import {codeTheme} from '../editor/theme';
import './DiffReader.css';
const savedPositions=new Map<string,number>();

export function DiffReader({change,version,line,side='target'}:{change:any;version:string;line?:number;side?:'baseline'|'target'}){
 const root=useRef<HTMLDivElement>(null),editor=useRef<EditorView|null>(null),baseline=useRef<EditorView|null>(null);
 const [split,setSplit]=useState(true),[wrap,setWrap]=useState(true),[collapse,setCollapse]=useState(true),[chunks,setChunks]=useState(0);
 const a=change?.before?.content??'',b=change?.after?.content??'';
 const omitted=change?.change==='unknown'?'范围不完整，不能判定新增或删除':change?.before?.omitted||change?.after?.omitted;
 const id=`${version}:${change?.repo}:${change?.file}`;
 useEffect(()=>{
  if(!root.current||!change||omitted)return;
  const extensions=[EditorState.readOnly.of(true),EditorState.phrases.of({"Find":"查找","next":"下一个","previous":"上一个","all":"选中全部","match case":"区分大小写","regexp":"正则","by word":"整词","close":"关闭查找","unchanged lines":"行相同内容"}),EditorView.editable.of(false),lineNumbers(),highlightActiveLineGutter(),search({top:true}),keymap.of(searchKeymap),syntaxHighlighting(defaultHighlightStyle,{fallback:true}),codeTheme,EditorView.theme({'&':{height:'100%',backgroundColor:'transparent'},'.cm-scroller':{fontFamily:'var(--font-mono)',fontSize:'12px',lineHeight:'1.7',overflow:'auto',padding:'0'},'.cm-content':{padding:'8px 0'}}),...(wrap?[EditorView.lineWrapping]:[])];
  let merge:MergeView|undefined,view:EditorView;
  const shared={highlightChanges:true,gutter:true,collapseUnchanged:collapse?{margin:4,minSize:8}:undefined,diffConfig:{scanLimit:5000,timeout:1000}};
  if(split){merge=new MergeView({a:{doc:a,extensions},b:{doc:b,extensions},parent:root.current,...shared});view=merge.b;}
  else view=new EditorView({doc:b,parent:root.current,extensions:[...extensions,unifiedMergeView({original:a,...shared,mergeControls:false})]});
  editor.current=view;baseline.current=merge?.a||null;setChunks(getChunks(view.state)?.chunks.length||0);view.scrollDOM.scrollTop=savedPositions.get(id)||0;
  let alive=true;const language=LanguageDescription.matchFilename(languages,change.file);if(language)void language.load().then(support=>{if(alive){view.dispatch({effects:StateEffect.appendConfig.of(support)});merge?.a.dispatch({effects:StateEffect.appendConfig.of(support)});}}).catch(()=>{});
  return()=>{alive=false;savedPositions.set(id,view.scrollDOM.scrollTop);if(savedPositions.size>100)savedPositions.delete(savedPositions.keys().next().value!);editor.current=null;baseline.current=null;if(merge)merge.destroy();else view.destroy();};
 },[id,a,b,split,wrap,collapse,omitted]);
 useEffect(()=>{if(side==='baseline'&&line&&!split){setSplit(true);return;}const view=side==='baseline'?baseline.current:editor.current;if(view&&line){const pos=view.state.doc.line(Math.min(Math.max(1,line),view.state.doc.lines)).from;view.dispatch({selection:{anchor:pos},effects:EditorView.scrollIntoView(pos,{y:'center'})});}},[id,line,split,side]);
 if(!change)return <p>选择一个变更文件。</p>;
 return <section className="enigma-diff-reader" aria-label={`差异 ${change.file}`}>
  <div className="enigma-diff-controls"><span>{change.file}</span><div><button aria-pressed={split} onClick={()=>setSplit(!split)}>{split?'双栏':'单栏'}</button><button aria-pressed={wrap} onClick={()=>setWrap(!wrap)}>换行</button><button aria-pressed={collapse} onClick={()=>setCollapse(!collapse)}>{collapse?'展开全文':'折叠相同内容'}</button><button onClick={()=>editor.current&&openSearchPanel(editor.current)}>查找</button><button aria-label="上一处变化" onClick={()=>editor.current&&goToPreviousChunk(editor.current)}>↑</button><button aria-label="下一处变化" onClick={()=>editor.current&&goToNextChunk(editor.current)}>↓</button><small>{chunks} 处</small></div></div>
  {omitted?<p className="enigma-source-note">{omitted}。保留文件变化记录，没有伪造文本差异。</p>:<><div className="enigma-diff-side-labels"><span>{split?'修改前':'文件差异'}</span>{split&&<span>修改后</span>}</div><div ref={root} className="enigma-diff-editor"/></>}
 </section>;
}
