import {useEffect,useRef,useState} from 'react';
import {EditorState,StateEffect,type EditorSelection,type Text} from '@codemirror/state';
import {LanguageDescription,syntaxHighlighting,defaultHighlightStyle} from '@codemirror/language';
import {languages} from '@codemirror/language-data';
import {EditorView,lineNumbers,highlightActiveLineGutter,keymap,panels} from '@codemirror/view';
import {search,openSearchPanel,searchKeymap,getSearchQuery,setSearchQuery,searchPanelOpen,type SearchQuery} from '@codemirror/search';
import {MergeView,unifiedMergeView,goToNextChunk,goToPreviousChunk,getChunks} from '@codemirror/merge';
import {codeTheme} from '../editor/theme';
import './DiffReader.css';
type ReadingState={doc:Text;selection:EditorSelection;scroll:ReturnType<typeof EditorView.scrollIntoView>;query:SearchQuery;searchOpen:boolean};
type ReadingPair={target:ReadingState;baseline?:ReadingState};
const savedPositions=new Map<string,ReadingPair>();
function captureReading(view:EditorView,fallback?:ReadingState):ReadingState{
 // MergeView scrolls its shared parent, not either editor's scrollDOM.
 const scroller=view.dom.closest('.cm-mergeView')||view.scrollDOM;
 const bounds=scroller.getBoundingClientRect(),selection=view.state.selection.main;
 let scroll=(fallback?.doc.eq(view.state.doc)?fallback.scroll:undefined)||EditorView.scrollIntoView(selection.head,{y:'center'});
 if(bounds.height>0){
  const top=bounds.top-view.documentTop,block=view.lineBlockAtHeight(Math.max(0,top));
  const caret=view.coordsAtPos(selection.head);
  const selectedVisible=caret&&caret.bottom>=bounds.top&&caret.top<bounds.bottom;
  scroll=EditorView.scrollIntoView(selectedVisible?selection.head:block.from,{y:'start',yMargin:Math.max(0,selectedVisible?caret.top-bounds.top:block.top-top)});
 }
 return {doc:view.state.doc,selection:view.state.selection,scroll,query:getSearchQuery(view.state),searchOpen:searchPanelOpen(view.state)};
}
const restoreReading=(view:EditorView,saved:ReadingState|undefined)=>{
 if(!saved?.doc.eq(view.state.doc))return;
 view.dispatch({selection:saved.selection,effects:[setSearchQuery.of(saved.query),saved.scroll]});
 if(saved.searchOpen){
  const focused=document.activeElement;
  openSearchPanel(view);view.dispatch({effects:setSearchQuery.of(saved.query)});
  if(focused instanceof HTMLElement&&focused!==document.body&&focused.isConnected)focused.focus({preventScroll:true});
 }
};
function saveReading(id:string,state:ReadingPair){
 savedPositions.delete(id);savedPositions.set(id,state);
 let length=[...savedPositions.values()].reduce((sum,item)=>sum+item.target.doc.length+(item.baseline?.doc.length||0),0);
 // Keep text identity for safe restore, without accumulating large documents.
 while(savedPositions.size>40||length>2_000_000){const key=savedPositions.keys().next().value!;const item=savedPositions.get(key)!;length-=item.target.doc.length+(item.baseline?.doc.length||0);savedPositions.delete(key);}
}

export function DiffReader({change,version,line,side='target'}:{change:any;version:string;line?:number;side?:'baseline'|'target'}){
 const root=useRef<HTMLDivElement>(null),editor=useRef<EditorView|null>(null),baseline=useRef<EditorView|null>(null);
 const searchRoot=useRef<HTMLDivElement>(null);
 const manualSplit=useRef(false);
 const lastAnchor=useRef<{id:string;line:number;side:string;doc:Text}|null>(null);
 const [split,setSplit]=useState(true),[wrap,setWrap]=useState(true),[collapse,setCollapse]=useState(true),[chunks,setChunks]=useState(0);
 const a=change?.before?.content??'',b=change?.after?.content??'';
 const omitted=change?.change==='unknown'?'范围不完整，不能判定新增或删除':change?.before?.omitted||change?.after?.omitted;
 const id=JSON.stringify([version,change?.repo,change?.file]);
 useEffect(()=>{const element=root.current;if(!element||typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(()=>{if(!manualSplit.current&&element.clientWidth>0)setSplit(element.clientWidth>=460);});observer.observe(element);return()=>observer.disconnect();},[omitted]);
 useEffect(()=>{
  if(!root.current||!searchRoot.current||!change||omitted){setChunks(0);return;}
  const extensions=[EditorState.readOnly.of(true),EditorState.phrases.of({"Find":"查找","next":"下一个","previous":"上一个","all":"选中全部","match case":"区分大小写","regexp":"正则","by word":"整词","close":"关闭查找","$ unchanged lines":"$ 行相同内容"}),EditorView.editable.of(false),lineNumbers(),highlightActiveLineGutter(),search({top:true}),panels({topContainer:searchRoot.current}),keymap.of(searchKeymap),syntaxHighlighting(defaultHighlightStyle,{fallback:true}),codeTheme,EditorView.theme({'&':{height:'100%',backgroundColor:'transparent'},'.cm-scroller':{fontFamily:'var(--font-mono)',fontSize:'12px',lineHeight:'1.7',overflow:'auto',padding:'0'},'.cm-content':{padding:'8px 0'}}),...(wrap?[EditorView.lineWrapping]:[])];
  let merge:MergeView|undefined,view:EditorView;
  const shared={highlightChanges:true,gutter:true,collapseUnchanged:collapse?{margin:4,minSize:8}:undefined,diffConfig:{scanLimit:5000,timeout:1000}};
  if(split){merge=new MergeView({a:{doc:a,extensions},b:{doc:b,extensions},parent:root.current,...shared});view=merge.b;}
  else view=new EditorView({doc:b,parent:root.current,extensions:[...extensions,unifiedMergeView({original:a,...shared,mergeControls:false})]});
  editor.current=view;baseline.current=merge?.a||null;setChunks(getChunks(view.state)?.chunks.length||0);
  const previous=savedPositions.get(id);if(merge)restoreReading(merge.a,previous?.baseline);restoreReading(view,previous?.target);
  const scroller=merge?.dom||view.scrollDOM;
  let reading=previous,frame=0;
  const rememberScroll=()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;reading={target:captureReading(view,reading?.target),baseline:merge?captureReading(merge.a,reading?.baseline):reading?.baseline};});};
  scroller.addEventListener('scroll',rememberScroll,{passive:true});
  let alive=true;const language=LanguageDescription.matchFilename(languages,change.file);if(language)void language.load().then(support=>{if(alive){view.dispatch({effects:StateEffect.appendConfig.of(support)});merge?.a.dispatch({effects:StateEffect.appendConfig.of(support)});}}).catch(()=>{});
  return()=>{alive=false;scroller.removeEventListener('scroll',rememberScroll);cancelAnimationFrame(frame);saveReading(id,{target:captureReading(view,reading?.target),baseline:merge?captureReading(merge.a,reading?.baseline):reading?.baseline});editor.current=null;baseline.current=null;if(merge)merge.destroy();else view.destroy();};
 },[id,a,b,split,wrap,collapse,omitted]);
 useEffect(()=>{
  if(!line){lastAnchor.current=null;return;}
  const oldAnchor=lastAnchor.current;
  const content=side==='baseline'?a:b;
  if(oldAnchor?.id===id&&oldAnchor.line===line&&oldAnchor.side===side&&oldAnchor.doc.toString()===content)return;
  if(side==='baseline'&&!split){manualSplit.current=true;setSplit(true);return;}
  const view=side==='baseline'?baseline.current:editor.current;
  if(view){const pos=view.state.doc.line(Math.min(Math.max(1,line),view.state.doc.lines)).from;view.dispatch({selection:{anchor:pos},effects:EditorView.scrollIntoView(pos,{y:'center'})});lastAnchor.current={id,line,side,doc:view.state.doc};}
 },[id,line,split,side,a,b,omitted]);
 if(!change)return <p>选择一个变更文件。</p>;
 const size=(value:any)=>!value?'无此文件':typeof value.size==='number'?`${value.size.toLocaleString()} 字节`:'大小未记录';
 return <section className="enigma-diff-reader" aria-label={`差异 ${change.file}`}>
  <div className="enigma-diff-controls"><span title={change.previousPath?`${change.previousPath} → ${change.file}`:change.file}>{change.file.split('/').at(-1)}{change.file.includes('/')&&<small className="enigma-diff-path">{change.file.slice(0,change.file.lastIndexOf('/'))}</small>}</span>{!omitted&&<div><button aria-pressed={split} title={split?'当前双栏，点击切换单栏':'当前单栏，点击切换双栏'} onClick={()=>{manualSplit.current=true;setSplit(!split);}}>{split?'双栏':'单栏'}</button><button aria-pressed={wrap} onClick={()=>setWrap(!wrap)}>换行</button><button onClick={()=>setCollapse(!collapse)}>{collapse?'展开全文':'折叠相同内容'}</button><button onClick={()=>editor.current&&openSearchPanel(editor.current)}>查找</button><button aria-label="上一处变化" disabled={!chunks} onClick={()=>editor.current&&goToPreviousChunk(editor.current)}>↑</button><button aria-label="下一处变化" disabled={!chunks} onClick={()=>editor.current&&goToNextChunk(editor.current)}>↓</button><small>{chunks} 处</small></div>}</div>
  {change.previousPath&&<p className="enigma-diff-attribution">{change.previousPath} → {change.file}</p>}
  {change.attribution&&<p className="enigma-diff-attribution">{change.attribution==='verified-write'?'已核对工具写入':change.attribution==='unattributed'?'归属待确认：仅观察到文件变化，不代表由助手写入。':'工具执行期间观察到变化，未逐项确认写入归属。'}</p>}
  {omitted?<div className="enigma-diff-omitted"><p>{omitted}。保留了文件变化记录，无法展示完整文本差异。</p><p>修改前：{size(change.before)}<br/>修改后：{size(change.after)}</p></div>:<><div ref={searchRoot} className="enigma-diff-search"/><div className="enigma-diff-side-labels"><span>{split?'修改前':'全量 Diff'}</span>{split&&<span>修改后</span>}</div><div ref={root} className="enigma-diff-editor"/></>}
 </section>;
}
