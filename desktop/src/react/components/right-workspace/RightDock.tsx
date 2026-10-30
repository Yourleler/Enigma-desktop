import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {useStore} from '../../stores';
import {dockScope,expandDock,selectDockTab,useRightDock,type DockTab} from '../../stores/right-dock-store';
import {closeTab,setActiveTab} from '../../stores/preview-actions';
import {useEngineering,openGroup,groups} from '../../engineering/state';
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
import './RightDock.css';

const fixed:Array<{id:DockTab;label:string;icon:AppIconName;hint:string}>=[
  {id:'files',label:'文件',icon:'project',hint:'项目目录与本次对话的附件'},
  {id:'changes',label:'变更',icon:'file',hint:'修改记录、智能阅读和完整差异'},
  {id:'browser',label:'浏览器',icon:'link',hint:'浏览网页，切换标签保留页面'},
  {id:'tasks',label:'任务',icon:'activity',hint:'进度、协作助手和任务详情'},
];

export function RightDock(){
  const scope=useStore(dockScope),session=useStore(s=>s.currentSessionPath),connection=useStore(s=>s.activeServerConnectionId||'local');
  const previewOpen=useStore(s=>s.previewOpen),openTabs=useStore(s=>s.openTabs),items=useStore(s=>s.previewItems),activeFile=useStore(s=>s.activeTabId),visible=useStore(s=>s.jianOpen);
  const view=useRightDock(s=>s.views[scope]);
  const engineering=useEngineering(s=>s.snapshot),engineeringActive=useEngineering(s=>s.active);
  const active=view?.tab||'files';
  const [visited,setVisited]=useState<Record<string,Set<string>>>({});
  const strip=useRef<HTMLDivElement>(null),body=useRef<HTMLDivElement>(null),positions=useRef<Record<string,number>>({});
  const last=useRef({scope,active});
  const fileTabs=openTabs.map(id=>items.find(item=>item.id===id)).filter(item=>item&&item.type!=='browser');
  const fileId=view?.fileId&&openTabs.includes(view.fileId)?view.fileId:fileTabs.find(item=>item?.id===activeFile)?.id||fileTabs.at(-1)?.id||null;
  const toolsLabel=groups.find(g=>`group:${g.id}`===engineeringActive)?.label||'工具';
  const tabs=[...fixed,...(engineering?.connected&&engineeringActive?[{id:'tools' as DockTab,label:toolsLabel,icon:'skill' as AppIconName,hint:'已打开的项目工具'}]:[]),...fileTabs.map(item=>({id:`preview:${item!.id}` as DockTab,label:item!.title,icon:'file' as AppIconName,hint:item!.filePath||item!.title}))];
  const resolved=tabs.some(tab=>tab.id===active)?active:'files';
  useEffect(()=>{
    if(view)return;
    const item=items.find(i=>i.id===activeFile);
    if(previewOpen&&item)selectDockTab(scope,item.type==='browser'?'browser':`preview:${item.id}`,item.type==='browser'?{browserSession:item.browserSessionPath??null}:{});
  },[scope,view,previewOpen,activeFile,items]);
  useEffect(()=>{setVisited(previous=>({...previous,[scope]:new Set([...previous[scope]||[],resolved])}));},[scope,resolved]);
  useLayoutEffect(()=>{
    const previous=last.current;
    if(body.current){positions.current[`${previous.scope}:${previous.active}`]=body.current.scrollTop;body.current.scrollTop=positions.current[`${scope}:${resolved}`]||0;}
    last.current={scope,active:resolved};
    const list=strip.current,tab=list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if(list&&tab){const a=list.getBoundingClientRect(),b=tab.getBoundingClientRect();if(b.right>a.right)list.scrollLeft+=b.right-a.right+8;else if(b.left<a.left)list.scrollLeft-=a.left-b.left+8;}
  },[scope,resolved,tabs.length]);
  const choose=(tab:DockTab)=>{
    if(tab.startsWith('preview:')){useStore.getState().setPreviewOpen(true);setActiveTab(tab.slice(8));}
    selectDockTab(scope,tab,tab==='browser'&&view?.browserSession===undefined?{browserSession:session}:{});
    if(tab==='changes')useChangesPanel.setState({session:session||'',connection,open:true});
  };
  const closeFile=(id:string)=>{closeTab(id);if(resolved===`preview:${id}`){const other=fileTabs.filter(f=>f!.id!==id).at(-1);choose(other?`preview:${other.id}`:'files');}};
  const close=()=>useStore.setState({jianOpen:false,jianAutoCollapsed:false,layoutDrawer:null});
  const show=(tab:string)=>resolved===tab&&visible;
  const hasVisited=(tab:string)=>resolved===tab||visited[scope]?.has(tab);
  return <div className="enigma-right-dock" data-right-dock="" data-liquid="sidebar">
    <header className="enigma-dock-header">
      <div className="enigma-dock-tabs" role="tablist" aria-label="工作面板" ref={strip} data-glass-segmented="" onWheel={event=>{if(strip.current&&strip.current.scrollWidth>strip.current.clientWidth){strip.current.scrollLeft+=Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY;}}}>
        <GlassSelection selection={resolved}/>
        {tabs.map((tab,index)=><div key={tab.id} className={`enigma-dock-tab${resolved===tab.id?' active':''}`}>
          <button role="tab" id={`dock-tab-${index}`} aria-selected={resolved===tab.id} aria-controls="enigma-dock-body" tabIndex={resolved===tab.id?0:-1} data-tooltip={tab.hint} onClick={()=>choose(tab.id)} onKeyDown={event=>{
            if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const i=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;choose(tabs[i].id);strip.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[i]?.focus();}
          }}><AppIcon name={tab.icon} size={15}/><span>{tab.label}</span></button>
          {tab.id.startsWith('preview:')&&<button className="enigma-dock-tab-close" aria-label={`关闭文件 ${tab.label}`} onClick={()=>closeFile(tab.id.slice(8))}>×</button>}
        </div>)}
      </div>
      <div className="enigma-dock-actions"><button aria-label={view?.expanded?'还原面板宽度':'展开工作面板'} data-tooltip={view?.expanded?'恢复聊天与工作面板并排':'暂时展开，获得更大的阅读空间'} onClick={()=>expandDock(scope,!view?.expanded)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">{view?.expanded?<path d="M9 3v6H3m12 12v-6h6M3 9l6-6m6 18 6-6"/>:<path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"/>}</svg></button><button aria-label="收起工作面板" data-tooltip="收起，保留所有标签和内容" onClick={close}><AppIcon name="chevronRight" size={16}/></button></div>
    </header>
    <div ref={body} id="enigma-dock-body" className="enigma-dock-body" role="tabpanel" aria-labelledby={`dock-tab-${Math.max(0,tabs.findIndex(t=>t.id===resolved))}`}>
      <section hidden={!show('files')} inert={!show('files')} aria-hidden={!show('files')} className="enigma-dock-section"><RightWorkspacePanel filesOnly/></section>
      {hasVisited('changes')&&<section key={`changes:${scope}`} hidden={!show('changes')} inert={!show('changes')} aria-hidden={!show('changes')} className="enigma-dock-section">{session?<RepositoryChangesPanel embedded/>:<div className="enigma-dock-empty">开始项目对话后，在这里查看代码变更。</div>}</section>}
      {hasVisited('browser')&&<section key={`browser:${scope}`} hidden={!show('browser')} inert={!show('browser')} aria-hidden={!show('browser')} className="enigma-dock-section"><SidebarBrowser sessionPath={view?.browserSession===undefined?session:view.browserSession}/></section>}
      {hasVisited('tasks')&&<section hidden={!show('tasks')} inert={!show('tasks')} aria-hidden={!show('tasks')} className="enigma-dock-section enigma-dock-task-list">
        <div className="enigma-dock-task-intro"><h3>任务概览</h3><p>查看当前对话的计划、协作和运行信息。</p>{engineering?.connected&&<div><button onClick={()=>openGroup('plan')}>计划</button><button onClick={()=>openGroup('acceptance')}>检查结果</button><button onClick={()=>openGroup('observer')}>运行诊断</button></div>}{!session&&<p>开始对话后显示任务进度。</p>}</div>
        <SessionTodoCard/><WorkflowCard/><AgentActivityCard/><SessionStatusCard/>
      </section>}
      {engineering?.connected&&engineeringActive&&<section hidden={!show('tools')} inert={!show('tools')} aria-hidden={!show('tools')} className="enigma-dock-section"><EngineeringPanel/></section>}
      <PreviewPanel embedded visible={visible&&resolved.startsWith('preview:')} itemId={fileId}/>
    </div>
  </div>;
}
