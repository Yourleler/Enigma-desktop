import {motion,useReducedMotion} from 'motion/react';
import {ChangeWorkbench} from '../../engineering/ChangeWorkbench';
import {SubagentPanel} from './SubagentPanel';
import {HeaderSlot} from '../app/HeaderSlot';
import {createPortal} from 'react-dom';
import {FileSplitPane} from './FileSplitPane';
import {OpenPreviewDocumentWatchBridge} from '../app/OpenPreviewDocumentWatchBridge';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {useStore} from '../../stores';
import {dockScope,dockView,expandDock,hideDockTab,moveDockTab,reorderDockTabs,orderedDockTabs,patchDockView,selectDockTab,useRightDock,type DockTab} from '../../stores/right-dock-store';
import {openPreview,setActiveTab} from '../../stores/preview-actions';
import {useEngineering,openGroup,openProjectTool,groups,toolSections} from '../../engineering/state';
import {useChangesPanel} from '../../stores/changes-panel-store';
import {RightWorkspacePanel} from './RightWorkspacePanel';
import {RepositoryChangesPanel} from './RepositoryChangesCard';
import {EngineeringPanel} from '../../engineering/Engineering';
import {PreviewPanel} from '../PreviewPanel';
import {SidebarBrowser} from '../preview/SidebarBrowser';
import {SessionTodoCard} from './SessionTodoCard';
import {WorkflowCard} from './WorkflowCard';
import {AgentActivityCard} from './AgentActivityCard';
import {SessionStatusCard} from './SessionStatusCard';
import {AppIcon,type AppIconName} from '../../ui/app-icons';
import {GlassSelection} from '../../ui/GlassSelection';
import {SurfaceMenu} from '../../engineering/SurfaceMenu';
import {DockIcon} from './DockIcon';
import {openDockFiles} from '../../utils/dock-file-drop';
import {readAppFileDragPayload,clearAppFileDragPayload} from '../../utils/app-file-drag';
import './RightDock.css';

type TabInfo={id:DockTab;label:string;icon:AppIconName|'browser'|'changes';hint:string};
const fixed:TabInfo[]=[
  {id:'files',label:'文件',icon:'project',hint:'项目目录与本次对话的附件'},
  {id:'changes',label:'变更',icon:'changes',hint:'代码变更、智能阅读和完整差异'},
  {id:'browser',label:'浏览器',icon:'browser',hint:'浏览网页，切换标签保留页面'},
  {id:'tasks',label:'任务',icon:'activity',hint:'进度、协作助手和任务详情'},
];
export function RightDock(){
  const scope=useStore(dockScope),session=useStore(s=>s.currentSessionPath),connection=useStore(s=>s.activeServerConnectionId||'local');
  const previewOpen=useStore(s=>s.previewOpen),openTabs=useStore(s=>s.openTabs),items=useStore(s=>s.previewItems),activeFile=useStore(s=>s.activeTabId),visible=useStore(s=>s.jianOpen);
  const view=useRightDock(s=>s.views[scope]);
  const engineering=useEngineering(s=>s.snapshot),engineeringActive=useEngineering(s=>s.active),engineeringTabs=useEngineering(s=>s.tabs);
  const active=view?.tab||'files';
  const [visited,setVisited]=useState<Record<string,Set<string>>>({}),[draftOrder,setDraftOrder]=useState<DockTab[]|null>(null),[fileDrop,setFileDrop]=useState(false),[dropError,setDropError]=useState('');
  const suppressClick=useRef(false),orderRef=useRef<DockTab[]|null>(null),reduceMotion=useReducedMotion(),dragCleanup=useRef<()=>void>(()=>{});
  const [dragGhost,setDragGhost]=useState<{tab:TabInfo;x:number;y:number;width:number}|null>(null);
  useEffect(()=>()=>dragCleanup.current(),[scope]);
  useEffect(()=>{setDraftOrder(null);orderRef.current=null;dragging.current=null;},[scope]);
  const strip=useRef<HTMLDivElement>(null),root=useRef<HTMLDivElement>(null),body=useRef<HTMLDivElement>(null),picker=useRef<HTMLInputElement>(null),dragging=useRef<DockTab|null>(null),last=useRef({scope,active}),positions=useRef<Record<string,number>>({});
  const inline=new Set(view?.inlineIds||[]);
  const fileTabs=openTabs.map(id=>items.find(item=>item.id===id)).filter(item=>item&&item.type!=='browser'&&!inline.has(item.id));
  const inlineItem=items.find(item=>item.id===view?.directoryPreviewId);
  const fileId=active.startsWith('preview:')?active.slice(8):view?.fileId;
  const toolsLabel=groups.find(g=>`group:${g.id}`===engineeringActive)?.label||'工具';
  const customIds=[...new Set([...(view?.order||[]),active,...(view?.hidden||[])])].filter(id=>id.startsWith('tool:')&&groups.some(group=>group.id===id.slice(5)));
  const available:TabInfo[]=[...fixed,...(active==='agents'||view?.order?.includes('agents')?[{id:'agents' as DockTab,label:'协作助手',icon:'team' as AppIconName,hint:'子任务、执行记录和父对话定位'}]:[]),...customIds.map(id=>({id,label:groups.find(g=>g.id===id.slice(5))!.label,icon:'skill' as AppIconName,hint:'打开项目工具'})),...(active==='tools'&&engineering?.connected&&engineeringActive?[{id:'tools' as DockTab,label:toolsLabel,icon:'skill' as AppIconName,hint:'已打开的项目工具'}]:[]),...fileTabs.map(item=>({id:`preview:${item!.id}` as DockTab,label:item!.title,icon:'file' as AppIconName,hint:item!.filePath||item!.title}))];
  const availableIds=available.map(t=>t.id),ordered=(draftOrder||orderedDockTabs(view,availableIds)).filter(id=>availableIds.includes(id)),tabs=ordered.map(id=>available.find(t=>t.id===id)!);
  const resolved=tabs.some(t=>t.id===active)?active:tabs[0]?.id||null;
  useEffect(()=>{
    if(view)return;
    const item=items.find(i=>i.id===activeFile);
    if(previewOpen&&item)selectDockTab(scope,item.type==='browser'?'browser':`preview:${item.id}`,item.type==='browser'?{browserSession:item.browserSessionPath??null}:{});
  },[scope,view,previewOpen,activeFile,items]);
  useEffect(()=>{if(resolved)setVisited(previous=>({...previous,[scope]:new Set([...previous[scope]||[],resolved])}));},[scope,resolved]);
  useEffect(()=>{if(engineering?.connected&&resolved?.startsWith('tool:')&&engineeringTabs.find(t=>t.id===engineeringActive)?.group!==resolved.slice(5))openGroup(resolved.slice(5));},[engineering?.connected,resolved,engineeringActive]);
  useLayoutEffect(()=>{
    const previous=last.current;if(body.current){positions.current[`${previous.scope}:${previous.active}`]=body.current.scrollTop;body.current.scrollTop=positions.current[`${scope}:${resolved}`]||0;}
    last.current={scope,active:resolved||'files'};
    const list=strip.current,tab=list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if(list&&tab){const a=list.getBoundingClientRect(),b=tab.getBoundingClientRect();if(b.right>a.right)list.scrollLeft+=b.right-a.right+8;else if(b.left<a.left)list.scrollLeft-=a.left-b.left+8;}
  },[scope,resolved,tabs.length]);
  useEffect(()=>{
    const list=strip.current;if(!list||typeof ResizeObserver==='undefined')return;
    const align=()=>{const active=list.querySelector<HTMLElement>('[aria-selected="true"]');if(!active)return;const a=list.getBoundingClientRect(),b=active.getBoundingClientRect();if(!a.width)return;if(b.right>a.right)list.scrollLeft+=b.right-a.right+4;else if(b.left<a.left)list.scrollLeft-=a.left-b.left+4;};
    const observer=new ResizeObserver(align);observer.observe(list);return()=>observer.disconnect();
  },[]);
  const choose=(tab:DockTab)=>{
    if(tab.startsWith('preview:')){useStore.getState().setPreviewOpen(true);setActiveTab(tab.slice(8));}
    selectDockTab(scope,tab,tab==='browser'&&view?.browserSession===undefined?{browserSession:session}:{});
    if(tab==='changes')useChangesPanel.setState({session:session||'',connection,open:true});
    if(tab.startsWith('tool:'))void openProjectTool(tab.slice(5));
  };
  const startDrag=(tab:TabInfo,event:React.PointerEvent<HTMLDivElement>)=>{
    if(event.button!==0||(event.target as HTMLElement).closest('.enigma-dock-tab-close')||!strip.current)return;
    dragCleanup.current();const startX=event.clientX,startY=event.clientY,list=strip.current,rect=event.currentTarget.getBoundingClientRect();
    const offset=startX-rect.left,widths=new Map([...list.querySelectorAll<HTMLElement>('[data-dock-tab-id]')].map(e=>[e.dataset.dockTabId,e.offsetWidth]));
    const original=[...ordered],others=original.filter(id=>id!==tab.id);let moved=false;
    const move=(e:PointerEvent)=>{
      if(!moved&&Math.hypot(e.clientX-startX,e.clientY-startY)<6)return;
      moved=true;e.preventDefault();dragging.current=tab.id;suppressClick.current=true;
      const box=list.getBoundingClientRect();if(e.clientX>box.right-24)list.scrollLeft+=12;else if(e.clientX<box.left+24)list.scrollLeft-=12;
      let x=box.left-list.scrollLeft,index=0;const center=e.clientX-offset+rect.width/2;
      for(const id of original){const width=widths.get(id)||80,midpoint=x+width/2;x+=width+2;if(id===tab.id)continue;if(center<midpoint)break;index++;}
      const next=[...others];next.splice(index,0,tab.id);orderRef.current=next;setDraftOrder(next);
      setDragGhost({tab,x:e.clientX-offset,y:rect.top,width:rect.width});
    };
    const finish=()=>{if(moved&&orderRef.current&&dockScope(useStore.getState())===scope)reorderDockTabs(scope,orderRef.current);dragCleanup.current();setTimeout(()=>{suppressClick.current=false;},0);};
    const cancel=()=>{dragCleanup.current();setTimeout(()=>{suppressClick.current=false;},0);};
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();cancel();}};
    dragCleanup.current=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',cancel);window.removeEventListener('blur',cancel);window.removeEventListener('keydown',escape);dragging.current=null;orderRef.current=null;setDraftOrder(null);setDragGhost(null);};
    window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',cancel);window.addEventListener('blur',cancel);window.addEventListener('keydown',escape);
  };
  const show=(tab:string)=>resolved===tab&&visible,hasVisited=(tab:string)=>resolved===tab||visited[scope]?.has(tab);
  const pin=()=>{if(inlineItem)openPreview(inlineItem,{placement:'tab'});};
  const search=()=>{choose('files');patchDockView(scope,{fileListOpen:true});requestAnimationFrame(()=>root.current?.querySelector<HTMLInputElement>('.enigma-files-list input[aria-label="搜索目录文件"],.enigma-files-list input[aria-label="搜索附件"]')?.focus());};
  const drop=async(files:File[],payload:ReturnType<typeof readAppFileDragPayload>)=>{setFileDrop(false);setDropError('');try{await openDockFiles(files,payload);}catch(error){setDropError(error instanceof Error?error.message:'无法打开拖入文件');}finally{if(payload)clearAppFileDragPayload(payload.dragId);}};
  const canFileDrop=(event:React.DragEvent)=>!dragging.current&&(readAppFileDragPayload(event.dataTransfer)||event.dataTransfer.types.includes('Files'));
  const preserveTreeMove=(event:React.DragEvent)=>readAppFileDragPayload(event.dataTransfer)?.source==='workspace'&&!!(event.target as HTMLElement).closest('[data-desk-tree]');
  const previewShown=visible&&!!resolved?.startsWith('preview:');
  return <div ref={root} className="enigma-right-dock" data-right-dock="" data-liquid="sidebar" data-file-drop={fileDrop||undefined} onClickCapture={event=>{if(suppressClick.current){suppressClick.current=false;event.preventDefault();event.stopPropagation();}}}
    onDragEnterCapture={event=>{if(canFileDrop(event)&&!preserveTreeMove(event)){event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='copy';setFileDrop(true);}}}
    onDragOverCapture={event=>{if(canFileDrop(event)&&!preserveTreeMove(event)){event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='copy';setFileDrop(true);}}}
    onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setFileDrop(false);}}
    onDropCapture={event=>{if(canFileDrop(event)&&!preserveTreeMove(event)){event.preventDefault();event.stopPropagation();void drop(Array.from(event.dataTransfer.files),readAppFileDragPayload(event.dataTransfer));}}}>
    {dragGhost&&createPortal(<div className="enigma-dock-drag-ghost" style={{left:dragGhost.x,top:dragGhost.y,width:dragGhost.width}} aria-hidden="true"><DockIcon name={dragGhost.tab.icon}/><span>{dragGhost.tab.label}</span></div>,document.body)}
    <OpenPreviewDocumentWatchBridge/>
    <HeaderSlot id="enigma-titlebar-workspace"><header className="enigma-dock-header">
      <div className="enigma-dock-tabs" data-reordering={!!draftOrder||undefined} role="tablist" aria-label="工作面板" ref={strip} data-glass-segmented="" onWheel={event=>{if(strip.current&&strip.current.scrollWidth>strip.current.clientWidth)strip.current.scrollLeft+=Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY;}}>
        <GlassSelection selection={`${resolved}:${ordered.join(',')}`} selector=".enigma-dock-tab.active" layoutCoordinates/>
        {tabs.map((tab,index)=><motion.div layout="position" key={tab.id} transition={{layout:{duration:reduceMotion?0:0.18}}} className={`enigma-dock-tab${resolved===tab.id?' active':''}`} data-dock-tab-id={tab.id} data-drag-placeholder={dragGhost?.tab.id===tab.id||undefined} onPointerDown={event=>startDrag(tab,event)} onDragStartCapture={event=>event.preventDefault()}>
          <button role="tab" id={`dock-tab-${index}`} aria-selected={resolved===tab.id} aria-controls="enigma-dock-body" tabIndex={resolved===tab.id?0:-1} data-tooltip={`${tab.hint}\n拖动调整顺序`} onClick={()=>choose(tab.id)} onKeyDown={event=>{
            if(event.altKey&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const offset=event.key==='ArrowRight'?1:-1;if(index+offset>=0&&index+offset<tabs.length)moveDockTab(scope,tab.id,tabs[index+(offset===1?2:-1)]?.id,availableIds);return;}
            if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const i=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;choose(tabs[i].id);strip.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[i]?.focus();}
          }}><DockIcon name={tab.icon}/><span>{tab.label}</span></button>
          <button className="enigma-dock-tab-close" onPointerDown={event=>event.stopPropagation()} aria-label={`关闭${tab.id.startsWith('preview:')?'文件':'面板'} ${tab.label}`} data-tooltip="关闭标签；可通过＋重新添加" onClick={()=>hideDockTab(scope,tab.id,availableIds)}>×</button>
        </motion.div>)}
      </div>
      <div className="enigma-dock-actions">
        <button aria-label="搜索文件" data-tooltip="搜索项目文件或对话附件" onClick={search}><DockIcon name="search"/></button>
        <SurfaceMenu label="添加面板" hint="恢复已关闭面板、添加文件或项目工具" icon={<AppIcon name="add" size={17}/>}>
          <button onClick={()=>picker.current?.click()}>打开文件…<small>选择本机文件，固定为独立标签</small></button>
          {fixed.map(tab=><button key={tab.id} onClick={()=>choose(tab.id)}><DockIcon name={tab.icon}/>{tab.label}<small>{tabs.some(t=>t.id===tab.id)?'切换到此面板':'重新添加'}</small></button>)}
          <button onClick={()=>choose('agents')}><AppIcon name="team" size={16}/>协作助手<small>查看子任务及执行记录</small></button>
          {fileTabs.filter(item=>(view?.hidden||[]).includes(`preview:${item!.id}`)).map(item=><button key={item!.id} onClick={()=>choose(`preview:${item!.id}`)}>重新打开 {item!.title}</button>)}
          {toolSections.map(section=><div key={section.label} className="enigma-feature-section"><div className="enigma-menu-section-title">{section.label}</div>{section.ids.filter(id=>id!=='reading'&&id!=='conductor').map(id=><button key={id} onClick={()=>choose(`tool:${id}`)}>{groups.find(group=>group.id===id)?.label}</button>)}</div>)}
        </SurfaceMenu>
        <button aria-label={view?.expanded?'还原面板宽度':'展开工作面板'} data-tooltip={view?.expanded?'恢复聊天与工作面板并排':'展开阅读区域'} onClick={()=>expandDock(scope,!view?.expanded)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">{view?.expanded?<path d="M9 3v6H3m12 12v-6h6M3 9l6-6m6 18 6-6"/>:<path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"/>}</svg></button>
      </div>
      <input hidden ref={picker} type="file" multiple onChange={event=>{void drop(Array.from(event.target.files||[]),null);event.target.value='';}}/>
    </header></HeaderSlot>
    {dropError&&<div className="enigma-dock-feedback" role="alert">{dropError}<button onClick={()=>setDropError('')}>关闭</button></div>}
    {fileDrop&&<div className="enigma-dock-drop-hint" aria-hidden="true">松开后固定为独立标签</div>}
    <div ref={body} id="enigma-dock-body" className="enigma-dock-body" role="tabpanel" aria-labelledby={resolved?`dock-tab-${Math.max(0,tabs.findIndex(t=>t.id===resolved))}`:undefined}>
      <section hidden={!show('files')} inert={!show('files')} aria-hidden={!show('files')} className="enigma-dock-section enigma-files-section">
        {inlineItem&&<header className="enigma-file-preview-header"><button aria-label="切换文件列表" onClick={()=>patchDockView(scope,{fileListOpen:!view?.fileListOpen})}><AppIcon name="panelLeft" size={15}/>文件列表</button><span title={inlineItem.filePath||inlineItem.title}>{inlineItem.title}</span><button aria-label="固定为独立标签" data-tooltip="将此预览固定到顶部，与浏览器等面板并列" onClick={pin}><AppIcon name="add" size={15}/>固定为标签</button></header>}
        <FileSplitPane scope={scope} listOpen={view?.fileListOpen} preview={inlineItem&&!(previewShown&&fileId===inlineItem.id)?<PreviewPanel embedded watchDocuments={false} visible={show('files')} itemId={inlineItem.id} panelId="fileBrowserPreview"/>:null}>
          <RightWorkspacePanel filesOnly active={show('files')}/>
        </FileSplitPane>
      </section>
      {hasVisited('changes')&&<section key={`changes:${scope}`} hidden={!show('changes')} inert={!show('changes')} aria-hidden={!show('changes')} className="enigma-dock-section">{session?<ChangeWorkbench/>:<div className="enigma-dock-empty">开始项目对话后，在这里查看代码变更。</div>}</section>}
      {hasVisited('browser')&&<section key={`browser:${scope}`} hidden={!show('browser')} inert={!show('browser')} aria-hidden={!show('browser')} className="enigma-dock-section"><SidebarBrowser sessionPath={view?.browserSession===undefined?session:view.browserSession}/></section>}
      {hasVisited('agents')&&<section hidden={!show('agents')} inert={!show('agents')} aria-hidden={!show('agents')} className="enigma-dock-section"><SubagentPanel/></section>}
      {hasVisited('tasks')&&<section hidden={!show('tasks')} inert={!show('tasks')} aria-hidden={!show('tasks')} className="enigma-dock-section enigma-dock-task-list"><div className="enigma-dock-task-intro"><h3>任务概览</h3><p>当前对话的计划、协作和运行信息。</p>{engineering?.connected&&<div><button onClick={()=>openGroup('plan')}>计划</button><button onClick={()=>openGroup('acceptance')}>检查结果</button><button onClick={()=>openGroup('observer')}>运行诊断</button></div>}</div><SessionTodoCard/><WorkflowCard/><AgentActivityCard/><SessionStatusCard/></section>}
      {(resolved==='tools'||resolved?.startsWith('tool:'))&&<section className="enigma-dock-section">{engineering?.connected?<EngineeringPanel embedded/>:<div className="enigma-dock-empty"><h3>打开项目工具</h3><p>沿用当前对话的目录。没有目录的项目也可以管理任务；代码功能需要在“仓库”中关联代码目录。</p><button onClick={()=>void openProjectTool(resolved?.startsWith('tool:')?resolved.slice(5):'project')}>打开工具</button></div>}</section>}
      {!(show('files')&&inlineItem?.id===fileId)&&<PreviewPanel embedded watchDocuments={false} visible={previewShown} itemId={fileId||null}/>}
      {!resolved&&<div className="enigma-dock-empty"><h3>添加工作面板</h3><p>点击上方＋，选择文件、浏览器、变更或其他工具。</p></div>}
    </div>
  </div>;
}
