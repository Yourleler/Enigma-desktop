import {useEffect,useRef,useState} from 'react';
import {EditorState,StateEffect,type EditorSelection,type Text} from '@codemirror/state';
import {LanguageDescription,syntaxHighlighting} from '@codemirror/language';
import {languages} from '@codemirror/language-data';
import {EditorView,lineNumbers,highlightActiveLineGutter,keymap,panels} from '@codemirror/view';
import {search,openSearchPanel,searchKeymap,getSearchQuery,setSearchQuery,searchPanelOpen,SearchQuery} from '@codemirror/search';
import {MergeView,unifiedMergeView,goToNextChunk,goToPreviousChunk,getChunks} from '@codemirror/merge';
import {codeTheme} from '../editor/theme';
import {codeHighlight} from '../editor/highlight';
import './DiffReader.css';
type ReadingState={doc:Text;selection:EditorSelection;scroll:ReturnType<typeof EditorView.scrollIntoView>;query:SearchQuery;searchOpen:boolean;anchor:number;offset:number};
type ReadingPair={target:ReadingState;baseline?:ReadingState};
const savedPositions=new Map<string,ReadingPair>();
const savedOptions=new Map<string,{split:boolean;wrap:boolean;collapse:boolean;manualSplit:boolean}>();
function captureReading(view:EditorView,fallback?:ReadingState,outer?:Element|null):ReadingState{
 // MergeView scrolls its shared parent, not either editor's scrollDOM.
 const scroller=outer||view.dom.closest('.cm-mergeView')||view.scrollDOM;
 const bounds=scroller.getBoundingClientRect(),selection=view.state.selection.main;
 let anchor=selection.head,offset=0;
 let scroll=(fallback?.doc.eq(view.state.doc)?fallback.scroll:undefined)||EditorView.scrollIntoView(selection.head,{y:'center'});
 if(bounds.height>0){
  const top=bounds.top-view.documentTop,block=view.lineBlockAtHeight(Math.max(0,top));
  const caret=view.coordsAtPos(selection.head);
  const selectedVisible=caret&&caret.bottom>=bounds.top&&caret.top<bounds.bottom;
  const keepSelection=selectedVisible||(outer&&!selection.empty);
  anchor=keepSelection?selection.head:block.from;
  const reader=view.dom.closest('.enigma-diff-reader'),inset=outer?68+(reader?.querySelector('.enigma-diff-search')?.getBoundingClientRect().height||0)+8:0;
  offset=Math.min(Math.max(inset,selectedVisible?caret.top-bounds.top:keepSelection?fallback?.offset||inset:block.top-top),Math.max(inset,bounds.height-30));
  scroll=EditorView.scrollIntoView(anchor,{y:'start',yMargin:offset});
 }
 return {doc:view.state.doc,selection:view.state.selection,scroll,query:getSearchQuery(view.state),searchOpen:searchPanelOpen(view.state),anchor,offset};
}
const restoreReading=(view:EditorView,saved:ReadingState|undefined,restoreScroll=true)=>{
 if(!saved?.doc.eq(view.state.doc))return;
 view.dispatch({selection:saved.selection,effects:[setSearchQuery.of(saved.query),...(restoreScroll?[saved.scroll]:[])]});
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

export function DiffReader({change,version,line,side='target',flow=false,scope='',sourceOnly=false,onAnchorApplied,onLayoutStart,onLayoutEnd}:{change:any;version:string;line?:number;side?:'baseline'|'target';flow?:boolean;scope?:string;sourceOnly?:boolean;onAnchorApplied?:()=>void;onLayoutStart?:()=>void;onLayoutEnd?:()=>void}){
 const id=JSON.stringify([scope,version,change?.repo,change?.file,sourceOnly]);
 const root=useRef<HTMLDivElement>(null),editor=useRef<EditorView|null>(null),baseline=useRef<EditorView|null>(null);
 const searchRoot=useRef<HTMLDivElement>(null),restoreRequested=useRef(false);
 const manualSplit=useRef(savedOptions.get(id)?.manualSplit??false);
 const lastAnchor=useRef<{id:string;line:number;side:string;doc:Text}|null>(null);
 const [split,setSplit]=useState(()=>sourceOnly?false:savedOptions.get(id)?.split??true),[wrap,setWrap]=useState(()=>savedOptions.get(id)?.wrap??true),[collapse,setCollapse]=useState(()=>savedOptions.get(id)?.collapse??true),[chunks,setChunks]=useState(0);
 const a=change?.before?.content??'',b=change?.after?.content??'';
 const omittedReason=change?.change==='unknown'?'范围不完整，不能判定新增或删除':change?.before?.omitted||change?.after?.omitted;
 const omitted=omittedReason==='Binary or source reading budget exceeded'?'文件为二进制，或超过当前源码读取预算':omittedReason;
 useEffect(()=>{const element=root.current;if(!element||typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(()=>{if(!sourceOnly&&!manualSplit.current&&element.clientWidth>0)setSplit(element.clientWidth>=460);});observer.observe(element);return()=>observer.disconnect();},[omitted]);
 useEffect(()=>{
  if(!root.current||!searchRoot.current||!change||omitted){setChunks(0);return;}
  const extensions=[EditorState.readOnly.of(true),EditorState.phrases.of({"Find":"查找","next":"下一个","previous":"上一个","all":"选中全部","match case":"区分大小写","regexp":"正则","by word":"整词","close":"关闭查找","$ unchanged lines":"$ 行相同内容"}),EditorView.editable.of(false),lineNumbers(),highlightActiveLineGutter(),search({top:true}),panels({topContainer:searchRoot.current}),keymap.of(searchKeymap),syntaxHighlighting(codeHighlight),codeTheme,EditorView.theme({'&':{height:flow?'auto':'100%',backgroundColor:'transparent'},'.cm-scroller':{fontFamily:'var(--font-mono)',fontSize:'12px',lineHeight:'1.7',overflow:'auto',padding:'0'},'.cm-content':{padding:'8px 0'}}),...(wrap?[EditorView.lineWrapping]:[])];
  let merge:MergeView|undefined,view:EditorView;
  const shared={highlightChanges:true,gutter:true,collapseUnchanged:collapse?{margin:4,minSize:8}:undefined,diffConfig:{scanLimit:5000,timeout:1000}};
  if(sourceOnly)view=new EditorView({doc:b,parent:root.current,extensions});
  else if(split){merge=new MergeView({a:{doc:a,extensions},b:{doc:b,extensions},parent:root.current,...shared});view=merge.b;}
  else view=new EditorView({doc:b,parent:root.current,extensions:[...extensions,unifiedMergeView({original:a,...shared,mergeControls:false})]});
  editor.current=view;baseline.current=merge?.a||null;
  // Pasting dispatches input before keyup; commit now so the first Enter finds it.
  const searchContainer=searchRoot.current;
  const commitSearch=(event:Event)=>{const input=event.target;if(!(input instanceof HTMLInputElement)||input.name!=='search')return;for(const target of [view,merge?.a].filter(Boolean) as EditorView[]){target.dispatch({effects:setSearchQuery.of(new SearchQuery({...getSearchQuery(target.state),search:input.value}))});}};
  searchContainer.addEventListener('input',commitSearch);
  setChunks(getChunks(view.state)?.chunks.length||0);
  const outer=flow?view.dom.closest<HTMLElement>('.enigma-diff-stack'):null;
  const restoreScroll=!flow||restoreRequested.current,outerTop=outer?.scrollTop;restoreRequested.current=false;
  const previous=savedPositions.get(id);if(merge)restoreReading(merge.a,previous?.baseline,!flow);restoreReading(view,previous?.target,!flow);
  if(!restoreScroll&&outer&&outerTop!==undefined)outer.scrollTop=outerTop;
  // Natural-height editors must finish their first layout before restoring the outer viewport.
  let restoreFrame=0,settledFrame=0;
  if(flow&&restoreScroll&&previous)restoreFrame=requestAnimationFrame(()=>{restoreFrame=requestAnimationFrame(()=>{
   view.dispatch({effects:EditorView.scrollIntoView(Math.min(previous.target.anchor,view.state.doc.length),{y:'center',yMargin:130})});
   settledFrame=requestAnimationFrame(()=>{settledFrame=requestAnimationFrame(()=>onLayoutEnd?.());});
  });});
  else settledFrame=requestAnimationFrame(()=>onLayoutEnd?.());
  const scroller=outer||merge?.dom||view.scrollDOM;
  let reading=previous,frame=0;
  const rememberScroll=()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;reading={target:captureReading(view,reading?.target,outer),baseline:merge?captureReading(merge.a,reading?.baseline,outer):reading?.baseline};});};
  scroller.addEventListener('scroll',rememberScroll,{passive:true});
  let alive=true;const language=LanguageDescription.matchFilename(languages,change.file);if(language)void language.load().then(support=>{if(alive){view.dispatch({effects:StateEffect.appendConfig.of(support)});merge?.a.dispatch({effects:StateEffect.appendConfig.of(support)});}}).catch(()=>{});
  return()=>{alive=false;cancelAnimationFrame(restoreFrame);cancelAnimationFrame(settledFrame);searchContainer.removeEventListener('input',commitSearch);scroller.removeEventListener('scroll',rememberScroll);cancelAnimationFrame(frame);saveReading(id,{target:captureReading(view,reading?.target,outer),baseline:merge?captureReading(merge.a,reading?.baseline,outer):reading?.baseline});savedOptions.delete(id);savedOptions.set(id,{split,wrap,collapse,manualSplit:manualSplit.current});while(savedOptions.size>400)savedOptions.delete(savedOptions.keys().next().value!);editor.current=null;baseline.current=null;if(merge)merge.destroy();else view.destroy();};
 },[id,a,b,split,wrap,collapse,omitted,flow,sourceOnly]);
 useEffect(()=>{
  if(!line){lastAnchor.current=null;return;}
  if(omitted){onAnchorApplied?.();return;}
  const oldAnchor=lastAnchor.current;
  const content=side==='baseline'?a:b;
  if(oldAnchor?.id===id&&oldAnchor.line===line&&oldAnchor.side===side&&oldAnchor.doc.toString()===content)return;
  if(side==='baseline'&&!split){manualSplit.current=true;setSplit(true);return;}
  const view=side==='baseline'?baseline.current:editor.current;
  if(view){const pos=view.state.doc.line(Math.min(Math.max(1,line),view.state.doc.lines)).from;view.dispatch({selection:{anchor:pos},effects:EditorView.scrollIntoView(pos,{y:'center'})});lastAnchor.current={id,line,side,doc:view.state.doc};onAnchorApplied?.();}
 },[id,line,split,side,a,b,omitted]);
 if(!change)return <p>选择一个变更文件。</p>;
 const size=(value:any)=>!value?'无此文件':typeof value.size==='number'?`${value.size.toLocaleString()} 字节`:'大小未记录';
 return <section className="enigma-diff-reader" data-flow={flow||undefined} aria-label={`${sourceOnly?'源码':'差异'} ${change.file}`}>
  <div className="enigma-diff-controls"><span title={change.previousPath?`${change.previousPath} → ${change.file}`:change.file}>{change.file.split('/').at(-1)}{change.file.includes('/')&&<small className="enigma-diff-path">{change.file.slice(0,change.file.lastIndexOf('/'))}</small>}</span>{!omitted&&<div>{!sourceOnly&&<button aria-pressed={split} title={split?'当前双栏，点击切换单栏':'当前单栏，点击切换双栏'} onClick={()=>{restoreRequested.current=true;onLayoutStart?.();manualSplit.current=true;setSplit(!split);}}>{split?'双栏':'单栏'}</button>}<button aria-pressed={wrap} onClick={()=>{restoreRequested.current=true;onLayoutStart?.();setWrap(!wrap);}}>换行</button>{!sourceOnly&&<button onClick={()=>{restoreRequested.current=true;onLayoutStart?.();setCollapse(!collapse);}}>{collapse?'展开全文':'折叠相同内容'}</button>}<button onClick={()=>editor.current&&openSearchPanel(editor.current)}>查找</button>{!sourceOnly&&<><button aria-label="上一处变化" disabled={!chunks} onClick={()=>editor.current&&goToPreviousChunk(editor.current)}>↑</button><button aria-label="下一处变化" disabled={!chunks} onClick={()=>editor.current&&goToNextChunk(editor.current)}>↓</button><small>{chunks} 处</small></>}</div>}</div>
  {change.previousPath&&<p className="enigma-diff-attribution">{change.previousPath} → {change.file}</p>}
  {change.attribution&&<p className="enigma-diff-attribution">{change.attribution==='verified-write'?'已核对工具写入':change.attribution==='unattributed'?'归属待确认：仅观察到文件变化，不代表由助手写入。':'工具执行期间观察到变化，未逐项确认写入归属。'}</p>}
  {omitted?<div className="enigma-diff-omitted"><p>{omitted}。保留了文件变化记录，无法展示完整文本差异。</p><p>修改前：{size(change.before)}<br/>修改后：{size(change.after)}</p></div>:<><div ref={searchRoot} className="enigma-diff-search"/>{!sourceOnly&&<div className="enigma-diff-side-labels"><span>{split?'修改前':'全量 Diff'}</span>{split&&<span>修改后</span>}</div>}<div ref={root} className="enigma-diff-editor"/></>}
 </section>;
}
