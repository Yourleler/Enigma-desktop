import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {AppIcon} from '../ui/app-icons';
import {DiffReader} from './DiffReader';
import './ContinuousDiff.css';

type FileChange={repo:string;file:string;change?:string;before?:{content?:string;omitted?:string};after?:{content?:string;omitted?:string};[key:string]:any};
export type DiffNavigation={key:string;revision:number;line?:number;side?:'baseline'|'target'};
type Position={key:string;offset:number};
type Reading={heights:Map<string,number>;closed:Set<string>;position?:Position;navigation?:number};
const readings=new Map<string,Reading>();
const keyOf=(file:FileChange)=>`${file.repo}:${file.file}`;
const statusNames:Record<string,string>={added:'新增',modified:'修改',deleted:'删除',renamed:'重命名',unknown:'范围未定'};

function readingFor(scope:string):Reading{
 const saved=readings.get(scope)||{heights:new Map(),closed:new Set()};
 readings.delete(scope);readings.set(scope,saved);
 while(readings.size>24)readings.delete(readings.keys().next().value!);
 return saved;
}

function FileSection({file,version,scope,reading,navigation,forced,near,register,onVisible,onMeasured,reviewed,onRead}:{
 file:FileChange;version:string;scope:string;reading:Reading;
 navigation?:DiffNavigation;forced:boolean;near:boolean;onMeasured:()=>void;register:(key:string,node:HTMLElement|null)=>void;onVisible:()=>void;reviewed:boolean;onRead:()=>void;
}){
 const key=keyOf(file),section=useRef<HTMLElement>(null),body=useRef<HTMLDivElement>(null);
 const [closed,setClosed]=useState(reading.closed.has(key)),[settling,setSettling]=useState(false);
 const [applied,setApplied]=useState<number|undefined>();
 const [measured,setMeasured]=useState(reading.heights.get(key)||220);
 const target=navigation?.key===key&&navigation.revision!==applied;
 const live=!closed&&(near||target||forced||settling);
 useLayoutEffect(()=>{register(key,section.current);return()=>register(key,null);},[key,register]);
 useLayoutEffect(()=>{
  if(!target&&!forced)return;
  reading.closed.delete(key);setClosed(false);
  if(!navigation?.line)setApplied(navigation?.revision);
 },[navigation?.revision,target,forced,key,reading]);
 useLayoutEffect(()=>{
  const element=body.current;if(!live||!element||typeof ResizeObserver==='undefined')return;
  const observer=new ResizeObserver(()=>{const height=element.getBoundingClientRect().height;if(height>0){reading.heights.set(key,height);setMeasured(height);onMeasured();}});
  observer.observe(element);return()=>observer.disconnect();
 },[live,key,reading,onMeasured]);
 return <article ref={section} className="enigma-diff-file" data-file-key={key} aria-label={`变更文件 ${file.repo}/${file.file}`}>
  <header className="enigma-diff-file-heading">
   <button className="enigma-diff-file-disclosure" aria-expanded={!closed} aria-label={`${closed?'展开':'收起'} ${file.repo}/${file.file}`} onClick={()=>{if(closed)reading.closed.delete(key);else reading.closed.add(key);setClosed(!closed);}}>
    <AppIcon name={closed?'chevronRight':'chevronDown'} size={13}/><span title={`${file.repo}/${file.file}`}><small>{file.repo}</small>{file.file}</span>
   </button>
   <small data-change={file.change}>{statusNames[file.change||'']||'变更'}</small>
   <button className="enigma-diff-file-read" aria-pressed={reviewed} title={reviewed?'取消已读标记':'已核对这个文件，标为已读'} onClick={onRead}>{reviewed?'已读':'标为已读'}</button>
  </header>
  {!closed&&(live?<div ref={body} className="enigma-diff-file-body"><DiffReader change={file} version={version} flow scope={scope}
   onLayoutStart={()=>setSettling(true)} onLayoutEnd={()=>{onVisible();setSettling(false);}} line={target?navigation?.line:undefined} side={navigation?.side} onAnchorApplied={()=>setApplied(navigation?.revision)}/></div>:
   <div className="enigma-diff-placeholder" style={{height:measured}} aria-label={`${file.file} 差异按需载入`}>滚动到此文件时显示差异</div>)}
 </article>;
}

export function ContinuousDiff({files,version,scope,navigation,onVisible,reviewed,onRead}:{
 files:FileChange[];version:string;scope:string;navigation?:DiffNavigation;onVisible:(key:string)=>void;reviewed:string[];onRead:(key:string)=>void;
}){
 const root=useRef<HTMLDivElement>(null),nodes=useRef(new Map<string,HTMLElement>()),frame=useRef(0);
 const [nearKeys,setNearKeys]=useState(()=>new Set(files.slice(0,2).map(keyOf)));
 const [reading]=useState(()=>readingFor(scope));
 const [activeNavigation,setActiveNavigation]=useState<DiffNavigation>();
 const [pendingKey,setPendingKey]=useState<string>();
 const tether=useRef<Position|null>(null),pendingNavigation=useRef<DiffNavigation|undefined>(undefined),quiet=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const correct=useRef(()=>{}),settle=useRef(()=>{});
 const callbacks=useRef({onVisible});callbacks.current={onVisible};
 const fileKeys=files.map(keyOf).join('\n');
 const report=useRef(()=>{}),restoring=useRef(false);
 report.current=()=>{
  const element=root.current;if(!element)return;
  if(element.clientHeight>0){const near=new Set<string>();for(const [key,node] of nodes.current){if(node.offsetTop+node.offsetHeight>element.scrollTop-700&&node.offsetTop<element.scrollTop+element.clientHeight+700)near.add(key);}setNearKeys(previous=>previous.size===near.size&&[...near].every(key=>previous.has(key))?previous:near);}
  if(restoring.current)return;
  const top=element.getBoundingClientRect().top;
  // Only file containers are measured; editors retain their own line virtualization.
  let current:[string,HTMLElement]|undefined;
  for(const file of files){const key=keyOf(file),node=nodes.current.get(key);if(node&&node.offsetTop+node.offsetHeight>element.scrollTop+40){current=[key,node];break;}}
  if(!current)return;
  const [key,node]=current;
  reading.position={key,offset:top-node.getBoundingClientRect().top};
  callbacks.current.onVisible(key);
 };
 const [schedule]=useState(()=>()=>{if(!frame.current)frame.current=requestAnimationFrame(()=>{frame.current=0;report.current();});});
 correct.current=()=>{const position=tether.current,element=root.current,node=position&&nodes.current.get(position.key);if(element&&node)element.scrollTop=node.offsetTop+position!.offset;};
 settle.current=()=>{correct.current();tether.current=null;restoring.current=false;setPendingKey(undefined);setActiveNavigation(pendingNavigation.current);pendingNavigation.current=undefined;schedule();};
 const [measured]=useState(()=>()=>{schedule();if(!tether.current)return;correct.current();clearTimeout(quiet.current);quiet.current=setTimeout(()=>settle.current(),180);});
 const release=()=>{clearTimeout(quiet.current);tether.current=null;pendingNavigation.current=undefined;restoring.current=false;setPendingKey(undefined);schedule();};
 const [refresh]=useState(()=>()=>report.current());
 useEffect(()=>{const element=root.current;if(!element||typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(schedule);observer.observe(element);schedule();return()=>observer.disconnect();},[schedule]);
 const [register]=useState(()=>(key:string,node:HTMLElement|null)=>{if(node)nodes.current.set(key,node);else nodes.current.delete(key);});
 useLayoutEffect(()=>{
  const element=root.current;if(!element)return;
  const fresh=navigation&&navigation.revision!==reading.navigation;
  const position=fresh?{key:navigation.key,offset:0}:reading.position;
  if(!position){element.scrollTop=0;return;}
  const node=nodes.current.get(position.key);if(!node){element.scrollTop=0;schedule();return;}
  if(fresh){reading.navigation=navigation.revision;reading.closed.delete(position.key);pendingNavigation.current=navigation;}
  restoring.current=true;tether.current=position;setPendingKey(position.key);
  correct.current();measured();callbacks.current.onVisible(position.key);
  return()=>{clearTimeout(quiet.current);tether.current=null;restoring.current=false;};
 },[navigation?.revision,fileKeys,reading,schedule,measured]);
 useEffect(()=>{schedule();return()=>{cancelAnimationFrame(frame.current);frame.current=0;};},[schedule]);
 if(!files.length)return <p className="enigma-diff-empty" role="status">当前筛选没有匹配的变更文件。</p>;
 return <div ref={root} className="enigma-diff-stack" role="region" tabIndex={0} aria-label="连续阅读全部差异" onScroll={schedule} onWheel={release} onPointerDown={release} onKeyDown={e=>{if(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End'].includes(e.key))release();}}>
  {files.map(file=><FileSection key={keyOf(file)} file={file} version={version} scope={scope} reading={reading}
   navigation={activeNavigation} forced={pendingKey===keyOf(file)} near={nearKeys.has(keyOf(file))} onMeasured={measured} register={register} onVisible={refresh} reviewed={reviewed.includes(keyOf(file))} onRead={()=>onRead(keyOf(file))}/>)}
 </div>;
}
