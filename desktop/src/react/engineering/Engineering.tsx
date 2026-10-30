import { WorkspaceChooser } from "./WorkspaceChooser";
import { resolveServerConnection } from "../services/server-connection";
import { GlassSelection } from '../ui/GlassSelection';
import { FormSelectControl } from './FormSelect';
import { AppearanceMenu } from "./AppearanceMenu";
import { switchSession } from "../stores/session-actions";
import { renderMarkdown } from "../utils/markdown";
import { useEffect, useLayoutEffect,useState, useRef } from "react";
import { useStore } from "../stores";
import { hanaFetch } from "../hooks/use-hana-fetch";
import { MarkdownContent } from "../components/chat/MarkdownContent";
import {
  groups,
  featureSections,
  toolSections,
  useEngineering,
  refreshEngineering,
  restoreTabs,
  openGroup,
  openEngineering,
  loadEngineeringTab,
  showAction,
  showRecordAction,
  submitAction,
  engineeringRequest,
  tabStorageKey,
  rememberEngineeringView,
  type Field,
  type Action,
  type Tab,
} from "./state";
import "./engineering.css";
import "./enigma-design.css";
import { SurfaceMenu, SurfaceModal } from "./SurfaceMenu";
import { Changes } from "./Changes";
import { ModelPolicyDialog } from "./ModelPolicy";
import { ConductorCreateDialog } from "./ConductorCreate";
import { ConductorTasks } from "./ConductorTasks";
import { GuardianPanel } from "./Guardian";
import { RuntimeStatus } from './RuntimeStatus';
import {EnvironmentPanel} from './Environment';
import {ProjectPanel,dependencyFields} from './Project';
import {PlanPanel} from './Plan';
import {CollaborationPanel} from './Collaboration';
import {MaterialsPanel, MaterialDocument} from './Materials';
import {ArtifactDocument, ArtifactsPanel} from './Artifacts';
import {FileTree} from './FileTree';
import {AcceptancePanel} from './Acceptance';
import {ReviewPanel} from './Review';
import {useSideAction} from './useSideAction';
import {useMaterialPreferences} from '../ui/material-preferences';
import {AppIcon} from '../ui/app-icons';
import { MemoryPanel } from "./Memory";
import { DocumentsPanel } from "./Documents";
import {OperationResult} from './OperationResult';
import { TimeMachine } from './TimeMachine';
import { checkpointChoice, operationLabel, explainEvidenceProblem } from './interaction-copy';
import { GuidedRecords } from './GuidedRecords';
import { ActionCatalog } from './ActionCatalog';
import { enumLabel, MultiChoice, validateFields,StructuredTextInput,resolveFieldValues } from './form-fields';
import { composeTaskRequest, assistedOperations } from './compose-task';
const EMPTY_LIST: any[] = [];
const featureHint = (id: string) => featureSections.flatMap(section => section.items).find(item => item.id === id)?.description || ({ project: '查看仓库、依赖和工程配置', plan: '查看任务目标、执行步骤与验收进度', reading: '按固定版本查看智能阅读、影响范围和完整差异', artifacts: '查看本任务产物、报告及其版本', timeline: '查看上下文与代码检查点，预览后选择恢复', conductor: '查看子任务分工、依赖与进度' } as Record<string, string>)[id];


export function EngineeringToolbar({compact=false}:{compact?:boolean}={}) {
  const sessionPath = useStore((s) => s.currentSessionPath) || "";
  const nativeSessionId=useStore(s=>s.currentSessionId);
  const connection = useStore((s) => s.activeServerConnectionId);
  const switching=useStore(s=>!!s.pendingSessionSwitchPath);
  const snapshot = useEngineering((s) => s.snapshot);
  const activeTab = useEngineering((s) => s.active);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [appearance]=useMaterialPreferences();
  useLayoutEffect(()=>{restoreTabs(sessionPath);},[sessionPath,connection]);
  useEffect(() => {
    if (!sessionPath) return;
    const controller = new AbortController();
    let stopped = false;
    let polling=false;
    const poll = async () => {
      if(polling||stopped)return;polling=true;
      try {
        await refreshEngineering(sessionPath, controller.signal);
      } catch (error) {
        if (!stopped) useEngineering.setState({ refreshError: String(error) });
      }finally{polling=false;}
    };
    void poll();
    const timer = setInterval(() => {
      if (!document.hidden) void poll();
    }, 1500);
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [sessionPath, connection]);
  useEffect(() => {
    // 产品设计语言覆盖整个工作台；
    // enigma-engineering 只控制工程右栏相关的布局/抽屉。
    document.body.classList.add("enigma-surface");
    document.body.classList.toggle("enigma-engineering", !!snapshot?.connected);
    document.body.classList.toggle("enigma-glass-off", !appearance.glass);
    document.body.classList.toggle("enigma-motion-off", !appearance.motion);
    // 组件卸载时只移除工程标记；surface 皮肤保留，避免普通对话页闪回旧纸感。
    return () => document.body.classList.remove("enigma-engineering");
  }, [snapshot?.connected, appearance]);
  if(switching)return <p className="enigma-source-note" role="status">正在打开所选对话…</p>;
  if (!sessionPath)
    return (
      <>
        <div className="enigma-new-task-settings">
          <button data-tooltip="设置新任务的规划、执行与复核模型" onClick={() => setModelsOpen(true)}>新任务模型分工</button>
        </div>
        {modelsOpen && <ModelPolicyDialog close={() => setModelsOpen(false)} />}
      </>
    );
  const operation = snapshot?.state?.operation;
  const busy =
    operation?.state === "running" || snapshot?.state?.idle === false;
  if (compact) return <div className="enigma-compact-tools" data-testid="engineering-toolbar" data-session-id={nativeSessionId||undefined} data-connection-id={connection||'local'}>
    <SurfaceMenu label="项目工具" hint="仓库、任务、时光机、运行诊断与模型分工" icon={<><AppIcon name="skill" size={16}/><span>工具</span></>}>
      {snapshot?.connected ? <>
        {toolSections.map(section=><div className="enigma-feature-section" key={section.label}><div className="enigma-menu-section-title">{section.label}</div>{section.ids.filter(id=>snapshot.kind==='manager'||id!=='conductor').map(id=><button key={id} onClick={()=>openGroup(id)}>{groups.find(g=>g.id===id)?.label}<small>{featureHint(id)}</small></button>)}</div>)}
        <button onClick={()=>setCatalogOpen(true)}>全部操作<small>搜索操作和说明</small></button>
        <button onClick={()=>void engineeringRequest('/conductor/new',sessionPath,{}).then(result=>switchSession(result.sessionPath)).catch(error=>useEngineering.setState({error:String(error)}))}>新建任务管家</button>
      </> : <button onClick={()=>useEngineering.setState({connectOpen:true})}>选择项目目录<small>启用多仓库、任务计划、时光机等工程能力</small></button>}
      <button onClick={()=>setModelsOpen(true)}>模型分工<small>规划、执行、复核使用的模型</small></button>
      {snapshot?.connected&&<button onClick={()=>useEngineering.setState({connectOpen:true})}>切换项目目录<small>{snapshot.root}</small></button>}
    </SurfaceMenu>
    {snapshot?.connected&&(busy||operation?.state==='failed'||snapshot.overview?.blockers?.length>0)&&<button className="enigma-compact-status" onClick={()=>openGroup('observer')} data-tooltip="查看当前阶段、等待原因和旁路诊断"><span className={busy?'enigma-live':''}>●</span>{busy?'运行中':'待核对'}</button>}
    <ConnectDialog/><ActionDialog/><ApprovalDialog/>
    {catalogOpen&&<ActionCatalog close={()=>setCatalogOpen(false)}/>}
    {modelsOpen&&<ModelPolicyDialog close={()=>setModelsOpen(false)}/>}
  </div>;
  return (
    <>
      <div
        className="enigma-toolbar enigma-surface-card"
        data-session-id={nativeSessionId||undefined}
        data-connection-id={connection||'local'}
        data-testid="engineering-toolbar"
      >
        <button
          className="enigma-project-button"
          data-tooltip={snapshot?.connected ? `查看项目、仓库与依赖\n${snapshot.root}` : '选择本地目录，连接工程功能'}
          onClick={() =>
            snapshot?.connected
              ? openGroup("project")
              : useEngineering.setState({ connectOpen: true })
          }
        >
          <span className="enigma-mark" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M3 9h18"/></svg></span>
          <span>
            {snapshot?.connected
              ? snapshot.root.split("/").pop()
              : "选择工程工作区"}
          </span>
        </button>
        {snapshot?.connected && (
          <>
            <nav aria-label="当前任务功能" data-glass-segmented="">
              <GlassSelection selection={activeTab || ''} selector="button[aria-current='page']"/>
              {(snapshot.kind === "manager"
                ? [
                    ["conductor", "任务群"],
                    ["artifacts", "汇总成果"],
                    ["timeline", "恢复记录"],
                  ]
                : [
                    ["plan", "任务"],
                    ["reading", "变更"],
                    ["artifacts", "成果"],
                    ["timeline", "时光机"],
                  ]
              ).map(([id, label]) => (
                <button
                  key={id}
                  data-active={activeTab === `group:${id}`}
                  aria-current={activeTab === `group:${id}` ? 'page' : undefined}
                  data-tooltip={featureHint(id)}
                  onClick={() => openGroup(id)}
                >
                  {label}
                </button>
              ))}
            </nav>
            <button
              className="enigma-runtime-button"
              data-tooltip="查看当前执行、等待原因与旁路诊断；判断是否有有效进展"
              onClick={() => openGroup("observer")}
            >
              <span className={busy ? "enigma-live" : ""}>●</span>
              {busy ? "运行中" : "运行状态"}
            </button>
            <SurfaceMenu label="更多功能">
              <button onClick={()=>setCatalogOpen(true)}>全部操作<small>搜索完整功能目录，查看用途与入口</small></button>
                {featureSections.map(section=><div className="enigma-feature-section" key={section.label}><div className="enigma-menu-section-title">{section.label}</div>{section.items.map(({id,description}) => (
                  <button
                    key={id}
                    data-tooltip={description}
                    onClick={(event) => {
                      openGroup(id);
                      event.currentTarget
                        .closest("details")
                        ?.removeAttribute("open");
                    }}
                  >
                    {groups.find((group) => group.id === id)!.label}
                    <small>{description}</small>
                  </button>
                ))}</div>)}
                <div className="enigma-feature-section"><div className="enigma-menu-section-title">对话设置</div>
                  <button data-tooltip="为新任务或当前对话设置规划、执行与复核模型" onClick={() => setModelsOpen(true)}>模型分工<small>按阶段选择模型与请求预算</small></button>
                  <button data-tooltip="为当前对话重新选择工程目录" onClick={() => useEngineering.setState({ connectOpen: true })}>切换工程工作区<small>选择本地目录与工程记忆设置</small></button>
                  <button data-tooltip="创建独立的管家对话，用于安排与监控多个工作任务" onClick={() => void engineeringRequest('/conductor/new', sessionPath, {}).then(result => switchSession(result.sessionPath)).catch(error => useEngineering.setState({ error: String(error) }))}>新建任务管家<small>安排多个对话、模型与依赖</small></button>
                </div>
            </SurfaceMenu>
          </>
        )}
        <AppearanceMenu />
      </div>
      {snapshot?.connected && (
        <div className="enigma-progress" role="status">
          <span className={busy ? "enigma-live" : ""} />
          <span>
            {operation?.state === "running"
              ? operation.title
              : busy
                ? "Agent 正在运行"
                : operation?.state === "failed"
                  ? "操作失败，可查看详情"
                  : "任务就绪"}
          </span>
          <span>{snapshot.overview?.repositories?.length || 0} 个仓库</span>
          {snapshot.modelSelection?.state === "pending" && (
            <span>下一请求 → {snapshot.modelSelection.id}</span>
          )}
          {snapshot.modelSelection?.state === "failed" && (
            <span title={snapshot.modelSelection.error}>
              模型切换未生效，当前模型继续
            </span>
          )}
          {snapshot.overview?.blockers?.length > 0 && (
            <button onClick={() => openGroup("observer")}>
              {snapshot.overview.blockers.length} 项待核对
            </button>
          )}
          {busy && (
            <button
              data-tooltip="请求停止当前工程操作；已完成的修改保留"
              onClick={() =>
                void engineeringRequest("/cancel", sessionPath, {}).catch(
                  (error) => useEngineering.setState({ error: String(error) }),
                )
              }
            >
              停止
            </button>
          )}
        </div>
      )}
      <ConnectDialog /> <ActionDialog /> <ApprovalDialog />
      {catalogOpen && <ActionCatalog close={()=>setCatalogOpen(false)}/>}
      {modelsOpen && <ModelPolicyDialog close={() => setModelsOpen(false)} />}
    </>
  );
}

export function EngineeringSidebar() {
  const snapshot = useEngineering((s) => s.snapshot);
  const switching=useStore(s=>!!s.pendingSessionSwitchPath);
  const [conductorOpen, setConductorOpen] = useState(false);
  if (switching||!snapshot?.connected) return null;
  return (
    <div className="enigma-sidebar-tools" aria-label="工程项目功能">
      <button data-tooltip="管理本任务的仓库、角色、依赖和检查命令" onClick={() => openGroup("project")}>
        <AppIcon name="project" size={17}/> 项目 <span>{snapshot.overview?.repositories?.length || 0}</span>
      </button>
      <div>
        <button data-tooltip="检索工程经验、查看来源与适用范围，整理记忆候选" onClick={() => openGroup("memory")}><AppIcon name="memory" size={17}/>记忆</button>
        <button data-tooltip="查看可用技能与可复用的工程操作配方" onClick={() => openGroup("skills")}><AppIcon name="skill" size={17}/>技能</button>
      </div>
      {snapshot.kind !== "manager" && (
        <button data-tooltip="交代目标与允许范围，由管家编排多个工作对话" onClick={() => setConductorOpen(true)}><AppIcon name="team" size={17}/>新建管家任务</button>
      )}
      {conductorOpen && (
        <ConductorCreateDialog close={() => setConductorOpen(false)} />
      )}
    </div>
  );
}

export function EngineeringPanel({embedded=false}:{embedded?:boolean}={}) {
  const state = useEngineering();
  const [query, setQuery] = useState("");
  const active = state.tabs.find((tab) => tab.id === state.active);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(()=>setQuery(''),[state.sessionPath,state.connectionId,state.active]);
  useEffect(()=>{refs.current[state.active]?.scrollIntoView?.({block:'nearest',inline:'nearest',behavior:'auto'});},[state.active,state.tabs.length]);
  if (!state.snapshot?.connected || !state.paneOpen || !active) return null;
  const actions: Action[] = (state.snapshot.actions || []).filter(
    (action: Action) => action.group === active.group,
  );
  const searchable=['materials','memory','skills'].includes(active.group)&&!(active.group==='skills'&&state.sections?.skills==='recipes');
  const close = (id: string) => {
    const tabs = state.tabs.filter((tab) => tab.id !== id),
      next = state.active === id ? tabs.at(-1) : active;
    useEngineering.setState({
      tabs,
      active: next?.id || "",
      paneOpen: tabs.length > 0,
    });
    if (!tabs.length) useStore.setState({ jianOpen: false, jianAutoCollapsed: false });
    localStorage.setItem(
      tabStorageKey(state.sessionPath),
      JSON.stringify(tabs),
    );
    rememberEngineeringView();
    if (next) void loadEngineeringTab(next);
  };
  const switchTab = (tab: Tab) => {
    useEngineering.setState({ active: tab.id });
    rememberEngineeringView();
    void loadEngineeringTab(tab);
  };
  const key = (event: React.KeyboardEvent, index: number) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? state.tabs.length - 1
          : (index +
              (event.key === "ArrowRight" ? 1 : -1) +
              state.tabs.length) %
            state.tabs.length;
    switchTab(state.tabs[next]);
    refs.current[state.tabs[next].id]?.focus();
  };
  return (
    <section
      className="enigma-panel enigma-surface-card"
      aria-label="工程内容工作区"
      data-testid="engineering-panel"
      data-glass-frame="workspace" data-glass-controls=""
      aria-busy={state.loading}
    >
      {!embedded&&<div className="enigma-tabs-row"><div className="enigma-tabbar" role="tablist" aria-label="已打开内容" data-glass-segmented=""><GlassSelection selection={state.active || ""} selector=".enigma-tab[data-active='true']"/>
        {state.tabs.map((tab, index) => (
          <div
            className="enigma-tab"
            key={tab.id}
            data-active={tab.id === state.active}
          >
            <button
              ref={(element) => {
                refs.current[tab.id] = element;
              }}
              role="tab"
              data-tooltip={tab.file ? `${tab.repo} / ${tab.file}` : featureHint(tab.group)}
              aria-selected={tab.id === state.active}
              tabIndex={tab.id === state.active ? 0 : -1}
              onKeyDown={(event) => key(event, index)}
              onClick={() => switchTab(tab)}
            >
              {tab.title}
            </button>
            <button
              aria-label={`关闭 ${tab.title}`}
              onClick={() => close(tab.id)}
            >
              ×
            </button>
          </div>
        ))}
        </div><button
          className="enigma-close-pane"
          aria-label="收起工程面板"
          data-tooltip="收起右侧内容，保留已打开的标签页"
          onClick={() => {useEngineering.setState({ paneOpen: false });useStore.setState({jianOpen:false,jianAutoCollapsed:false});rememberEngineeringView();}}
        >
          ⇥
        </button>
      </div>}
      {embedded&&state.tabs.filter(t=>t.group===active.group).length>1&&<SurfaceMenu label="相关页面">{state.tabs.filter(t=>t.group===active.group).map(tab=><button key={tab.id} onClick={()=>switchTab(tab)}>{tab.title}</button>)}</SurfaceMenu>}
      <div className="enigma-panel-head">
        <div>
          <small>
            {active.file
              ? `${active.repo} / ${active.file}`
              : state.snapshot.kind === "manager"
                ? "管家任务群"
                : "项目工作区"}
          </small>
          <h2>{active.title}</h2>
        </div>
        <button
          aria-label="刷新当前内容"
          data-tooltip={state.loading ? '正在核对来源，请稍候' : '重新读取当前来源，更新此面板的内容'}
          disabled={state.loading}
          onClick={() => void loadEngineeringTab(active, query)}
        >
          ↻
        </button>
      </div>
      {!active.file &&
        !active.resource &&
        !active.artifact &&
        ![
          "conductor",
          "observer",
          "documents",
          "acceptance",
          "timeline",
          ...(!active.repo ? ["reading"] : []),
        ].includes(active.group) && (
          <div className="enigma-panel-controls">
            {searchable&&<>
            <input
              aria-label="查询当前内容"
              placeholder="按关键词查找"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter")
                  void loadEngineeringTab(active, query);
              }}
            />
            <button onClick={() => void loadEngineeringTab(active, query)}>
              查询
            </button>
            </>}
            {actions.length>0&&
            <SurfaceMenu label="可用操作">
                {actions.map((action) => (
                  <button
                    key={action.id}
                    data-tooltip={action.description}
                    onClick={() => void showAction(action)}
                  >
                    {action.title}
                    <small>{action.description}</small>
                  </button>
                ))}
            </SurfaceMenu>
            }
          </div>
        )}
      <div
        className="enigma-content"
        role="tabpanel"
        key={`${state.connectionId}:${state.sessionPath}:${active.id}`}
      >
        {state.error && (
          <div className="enigma-error" role="alert">
            {state.error}
          </div>
        )}
        {state.refreshError && <details className="enigma-error"><summary>工程状态暂未更新，显示最近记录</summary><p>{state.refreshError}</p></details>}
        {state.results[active.id] && <OperationResult value={state.results[active.id]} details={<Evidence value={state.results[active.id]}/>}/> }
        {state.loading ? (
          <div className="enigma-empty" role="status">正在核对当前来源…</div>
        ) : (
          <Content tab={active} value={state.data} query={query} />
        )}
        {state.snapshot?.state?.notices?.length > 0 && (
          <details className="enigma-result">
            <summary>操作回执</summary>
            {state.snapshot.state.notices
              .slice(-5)
              .map((notice: any, index: number) => (
                <p key={index}>{notice.text}</p>
              ))}
          </details>
        )}
        {state.snapshot?.state?.operation?.error && state.operationTabs[state.snapshot.state.operation.id]===active.id && !state.results[active.id] && (
          <div className="enigma-error">
            {state.snapshot.state.operation.error}
          </div>
        )}
      </div>
    </section>
  );
}

function Content({
  tab,
  value,
  query,
}: {
  tab: Tab;
  value: any;
  query: string;
}) {
  const overview = useEngineering((s) => s.snapshot?.overview);
  if(tab.group==='plan')return <PlanPanel initial={value} evidence={value=><Evidence value={value}/>}/>;
  if (value == null)
    return (
      <div className="enigma-empty">还没有相关记录。通过“操作”添加或运行。</div>
    );
  if (tab.group === "conductor") return <ConductorTasks value={value} />;
  if (tab.group === "memory") return <MemoryPanel value={value} searchText={query}/>;
  if (tab.group === "documents" && !tab.file)
    return <DocumentsPanel value={value} />;
  if (tab.group === "acceptance") return <AcceptancePanel initial={value} evidence={value=><Evidence value={value}/>}/>;
  if (tab.resource && value.resource) return <MaterialDocument value={value} evidence={value=><Evidence value={value}/>}/>;
  if (tab.artifact && value.record) return <ArtifactDocument value={value} evidence={value=><Evidence value={value}/>}/>;
  if (tab.file || tab.resource || tab.artifact)
    return (
      <div className="enigma-document">
        <div className="enigma-source-note">
          {value.sourceCurrent === false || value.current === false
            ? "历史版本 · 当前来源已变化"
            : tab.resource
              ? `保存的资料修订 · ${value.freshness || "按来源记录核对"}`
              : "已重新读取当前来源"}{" "}
          {value.version && `· ${String(value.version).slice(0, 12)}`}
        </div>
        {tab.file?.match(/\.md$/i) ||
        tab.resource ||
        (tab.artifact && value.record?.extension === ".md") ? (
          <MarkdownContent html={renderMarkdown(value.content || "")} />
        ) : (
          <pre>{value.content || ""}</pre>
        )}
      </div>
    );
  if (tab.group === "project") return <ProjectPanel value={overview} evidence={value=><Evidence value={value}/>}/>;
  if (tab.group === "reading")
    return tab.repo ? (
      <FileTree repo={tab.repo} />
    ) : (
      <Changes value={value} files={<FileTree />} />
    );
  if (tab.group === "observer")
    return (
      <div className="enigma-observer-card">
        <RuntimeStatus evidence={status=><Evidence value={status}/>}/>
        <GuardianPanel />
      </div>
    );
  if (tab.group === "timeline") return <TimeMachine value={value} details={<Evidence value={{tree:value.tree,operations:value.operations}}/>}/>;
  if (tab.group === 'collaboration') return <CollaborationPanel initial={value} evidence={value=><Evidence value={value}/>}/>;
  if (['handoff','skills'].includes(tab.group)) return <GuidedRecords group={tab.group} value={value} details={<Evidence value={value}/>} evidence={value=><Evidence value={value}/>}/>;
  if (tab.group === "environment") return <EnvironmentPanel initial={value} evidence={value=><Evidence value={value}/>}/>;
  if (tab.group === "materials") return <MaterialsPanel value={value}/>;
  if (tab.group === "artifacts")
    return <ArtifactsPanel value={value}/>;
  if (tab.group === "review") return <ReviewPanel initial={value} evidence={value=><Evidence value={value}/>}/>;
  return <Evidence value={value} />;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
function EmptyFeature({title,description,action}:{title:string;description:string;action?:string}){
  const definition=useEngineering(state=>state.snapshot?.actions?.find((item:Action)=>item.id===action));
  return <section className="enigma-empty-feature"><span className="enigma-empty-feature-icon" aria-hidden>◇</span><h3>{title}</h3><p>{description}</p>{definition&&<button className="enigma-primary" data-tooltip={definition.description} onClick={()=>void showAction(definition)}>{definition.title}</button>}</section>;
}

const labels: Record<string, string> = {
  goal: "目标",
  steps: "任务步骤",
  phase: "阶段",
  status: "状态",
  evidence: "验收证据",
  checks: "原检查",
  gaps: "待补齐",
  blockers: "待核对",
  note: "说明",
  sources: "源码依据",
  repositories: "仓库",
  graph: "关系",
  answer: "观察结论",
  facts: "已观察事实",
  warnings: "注意事项",
  checkpoints: "代码检查点",
  operations: "操作记录",
  tree: "会话树",
  services: "服务",
  background: "后台任务",
  waits: "等待条件",
  delegations: "隔离协作",
  experiments: "方案实验",
  plan: "计划",
  result: "结果",
  error: "错误",
  title: "名称",
  id: "记录",
  content: "正文",
  valid: "当前有效",
  sourceCurrent: "来源仍有效",
  details: "详情",
  requirements: "原始要求",
  coverage: "覆盖",
  entries: "会话条目",
  packages: "任务包",
  search: "召回结果",
  items: "条目",
  enabled: "已启用",
};
function Evidence({ value, depth = 0 }: { value: any; depth?: number }) {
  if (value == null) return null;
  if (typeof value !== "object")
    return (
      <span className="enigma-value">
        {typeof value === "boolean" ? (value ? "是" : "否") : String(value)}
      </span>
    );
  if (Array.isArray(value))
    return (
      <div className="enigma-evidence-list">
        {value.length ? (
          value.map((item, index) => (
            <div key={index}>
              <Evidence value={item} depth={depth + 1} />
            </div>
          ))
        ) : (
          <span className="enigma-muted">暂无记录</span>
        )}
      </div>
    );
  if (value.sessionPath && value.sessionId)
    return (
      <button
        className="enigma-source-link"
        onClick={() => void switchSession(value.sessionPath)}
      >
        打开新会话 {String(value.sessionId).slice(-8)}
      </button>
    );
  if (depth > 5)
    return (
      <details>
        <summary>更多详情</summary>
        <pre>{JSON.stringify(value, null, 2)}</pre>
      </details>
    );
  const sourceButton =
    value.repo && value.file ? (
      <button
        className="enigma-source-link"
        onClick={() =>
          openEngineering({
            id: `file:${value.repo}:${value.file}`,
            group: "reading",
            repo: value.repo,
            file: value.file,
            title: value.file.split("/").pop(),
          })
        }
      >
        {value.repo} / {value.file}
        {value.line ? `:${value.line}` : ""}
      </button>
    ) : null;
  return (
    <article className="enigma-evidence">
      {sourceButton}
      {Object.entries(value)
        .filter(
          ([key]) =>
            ![
              "schema",
              "sessionFile",
              "sessionPath",
              "path",
              "observation",
              "snapshot",
              "fingerprint",
            ].includes(key),
        )
        .map(([key, item]) => (
          <div className="enigma-fact" key={key}>
            <span>{labels[key] || key}</span>
            <div>
              <Evidence value={item} depth={depth + 1} />
            </div>
          </div>
        ))}
    </article>
  );
}

export function ConnectDialog() {
  const open = useEngineering(s => s.connectOpen);
  const sessionPath = useEngineering(s => s.sessionPath);
  const connection = useStore(s => s.activeServerConnectionId);
  const snapshot = useEngineering(s => s.snapshot);
  const server = resolveServerConnection(useStore.getState());
  const nativePicker = !!window.hana && server?.kind === 'local' && (!connection || server.connectionId === connection) && typeof window.platform?.selectFolder === 'function';
  const action = useSideAction(sessionPath, open ? 'connect-open' : 'connect-closed');
  const close = () => useEngineering.setState({ connectOpen: false });
  if (!open) return null;
  return <Modal title="选择工程工作区" close={close}>
    <WorkspaceChooser key={JSON.stringify([sessionPath, connection, nativePicker])}
      initialRoot={snapshot?.root || ''} initialMemory={snapshot?.memory === true}
      nativePicker={nativePicker} busy={!!action.busy} error={action.error} canConnect={!!sessionPath}
      onCancel={close} onConnect={(root, memory) => {
        void action.run('connect', () => engineeringRequest('/connect', sessionPath, { root, memory }), value => {
          useEngineering.setState({ snapshot: value, connectOpen: false });
          openGroup('project');
        });
      }}/>
  </Modal>;
}

function defaults(fields: Field[]) {
  return resolveFieldValues(fields);
}
export function ActionDialog() {
  const permissionMode = useStore(s=>s.sessionPermissionMode);
  const formLoading = useEngineering(s => s.formLoading);
  const formError = useEngineering(s => s.formError);
  const formKey=useEngineering(s=>s.formKey);
  const form = useEngineering((s) => s.form),
    choices = useEngineering((s) => s.choices),
    sessionPath = useEngineering((s) => s.sessionPath),
    formSession = useEngineering((s) => s.formSession);
  const [args, setArgs] = useState<Record<string, any>>({}),[validation,setValidation]=useState('');
  const action=useSideAction(sessionPath,form?`form:${formSession}:${form.id}:${formKey}`:'closed'),busy=!!action.busy,error=validation||action.error;
  useEffect(() => {
    setArgs(form ? defaults(form.fields) : {});
    setValidation('');
  }, [form?.id,formSession,formKey]);
  if (!form || sessionPath !== formSession) return null;
  const writeBlocked=permissionMode==='read_only'&&!!form.effect&&form.effect!=='read';
  return (
    <Modal
      key={`${formSession}:${form.id}`}
      title={form.title}
      close={() => useEngineering.setState({ form: undefined })}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if(writeBlocked){setValidation('当前对话为只读模式，不能执行此操作。');return;}
          const invalid=validateFields(form.fields,args);if(invalid){setValidation(invalid);return;}
          setValidation('');void action.run('submit',()=>submitAction(form,args));
        }}
      >
        <p>{form.description}</p>
        {writeBlocked&&<p role="status" className="enigma-source-note">当前对话为只读模式，可以查看配置，但不能提交这个会改变状态的操作。</p>}
        {formLoading && <p role="status">正在加载可选项目…</p>}
        {formError && <div role="alert" className="enigma-error">选项加载失败：{formError}<button type="button" onClick={() => void showAction(form,true)}>重新加载选项</button></div>}
        {(form.id==='repo-dependencies'?dependencyFields(form.fields,choices,args.repo):form.fields).map((field) => (
          <FieldInput
            key={field.name}
            field={field}
            values={resolveFieldValues(form.fields,args)}
            choices={choices}
            change={(value) => setArgs(previous => ({ ...previous, [field.name]: value,...(form.id==='repo-dependencies'&&field.name==='repo'?{dependsOn:[...((choices.repos||choices.repositories||[]).find((repo:any)=>repo.id===value)?.dependsOn||[])]}:{}) }))}
          />
        ))}
        {error && (
          <p className="enigma-error" role="alert">
            {error}
          </p>
        )}
        <button className="enigma-primary" data-tooltip={writeBlocked?'当前对话只读，操作不可执行':busy ? '操作已提交，请等待回执' : formLoading ? '正在加载可选项目' : formError ? '请先重新加载操作选项' : form.description} disabled={writeBlocked || busy || formLoading || !!formError}>
          {busy ? "提交中…" : form.title}
        </button>
      </form>
    </Modal>
  );
}

function choiceItems(
  source: string,
  choices: any,
): Array<{ value: string; label: string }> {
  const aliases: Record<string, string> = {
    repos: "repositories",
    delegations: "delegates",
    materials: "materials",
  };
  const records = choices[source] || choices[aliases[source]] || [];
  return (Array.isArray(records) ? records : [])
    .map((item) => {
      if (typeof item === "string") return { value: item, label: item };
      const record = [item.spec, item.resource, item.record,item.service].find(value => value && typeof value === 'object') || item;
      return {
        value: String(record.id || record.reference || ""),
        label: source === "checkpoints" ? checkpointChoice(record) : source === 'mergePreviews' ? `${record.changes?.length || 0} 个文件 · ${new Date(record.createdAt).toLocaleString()} · ${record.id.slice(-8)}` : String(
          record.title ||
            record.label ||
            record.name ||
            record.goal ||
            record.text ||
            record.id ||
            "",
        ),
      };
    })
    .filter((item) => item.value);
}

function FieldInput({
  field,
  values,
  choices,
  change,
}: {
  field: Field;
  values: Record<string, any>;
  choices: any;
  change: (value: any) => void;
}) {
  if (
    field.when &&
    !field.when.values.includes(String(values[field.when.field]))
  )
    return null;
  const value = values[field.name] ?? field.value,
    kind = field.kind || "text";
  const options = field.items || (field.source
    ? choiceItems(field.source, choices)
    : (field.options || []).map((option) => ({ value: option, label: enumLabel(option) })));
  if (kind === "multi") return <><MultiChoice label={field.label} options={options} value={Array.isArray(value)?value:[]} change={change}/>{field.help&&<small className="enigma-source-note">{field.help}</small>}</>;
  if (kind === "boolean")
    return (
      <label className="enigma-check">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => change(e.target.checked)}
        />
        {field.label}
        {field.help && <small>{field.help}</small>}
      </label>
    );
  if (kind === "rows" || kind === "object") {
    const records: Record<string, any>[] =
      (kind === "object" ? [value || {}] : Array.isArray(value) ? value : []).map(row=>resolveFieldValues(field.fields||[],row));
    return (
      <fieldset className="enigma-nested">
        <legend>{field.label}</legend>
        {field.help&&<p className="enigma-source-note">{field.help}</p>}
        {records.map((row, index) => (
          <div key={index}>
            {(field.fields || []).map((child) => (
              <FieldInput
                key={child.name}
                field={child}
                values={row}
                choices={choices}
                change={(next) => {
                  const updated = { ...row, [child.name]: next };
                  change(
                    kind === "object"
                      ? updated
                      : records.map((item, i) =>
                          i === index ? updated : item,
                        ),
                  );
                }}
              />
            ))}
            {kind === "rows" && <div className="enigma-inline-actions"><button type="button" aria-label={`上移${field.label}第 ${index+1} 项`} disabled={index===0} onClick={()=>{const next=[...records];[next[index-1],next[index]]=[next[index],next[index-1]];change(next);}}>上移</button><button type="button" aria-label={`下移${field.label}第 ${index+1} 项`} disabled={index===records.length-1} onClick={()=>{const next=[...records];[next[index],next[index+1]]=[next[index+1],next[index]];change(next);}}>下移</button></div>}
            {kind === "rows" && (
              <button
                type="button"
                onClick={() => change(records.filter((_, i) => i !== index))}
              >
                移除此项
              </button>
            )}
          </div>
        ))}
        {kind === "rows" && (
          <button
            type="button"
            onClick={() => change([...records, defaults(field.fields || [])])}
          >
            ＋ 添加一项
          </button>
        )}
      </fieldset>
    );
  }
  return (
    <label className="enigma-field">
      <span>
        {field.label}
        {field.required ? " *" : ""}
      </span>
      {kind === 'record' ? <span className="enigma-fixed-record">{field.displayValue || String(value || '')}</span> : kind === "select" || kind === "multi" ? (
        <FormSelectControl label={field.label} value={value||''} onChange={change} options={[{value:'',label:field.source&&!options.length?'暂无可选记录':'请选择'},...options]}/>

      ) : kind==='lines'||kind==='pairs' ? <StructuredTextInput label={field.label} kind={kind} value={value} required={field.required} change={change}/> : kind==='textarea' ? (
        <textarea
          aria-label={field.label}
          required={field.required}
          rows={4}
          value={value||''}
          onChange={event=>change(event.target.value)}
        />
      ) : (
        <input
          aria-label={field.label}
          type={kind === "number" ? "number" : "text"}
          required={field.required}
          value={value ?? ""}
          onChange={(e) =>
            change(
              kind === "number"
                ? e.target.value === ""
                  ? undefined
                  : Number(e.target.value)
                : e.target.value,
            )
          }
        />
      )}
      {field.help && <small>{field.help}</small>}
    </label>
  );
}

function ApprovalDialog() {
  const sessionPath = useEngineering((s) => s.sessionPath),
    dialogs = useEngineering((s) => s.snapshot?.dialogs || EMPTY_LIST),
    dialog = dialogs[0];
  const [value, setValue] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    setValue(dialog?.value || "");
    setError("");
  }, [dialog?.id]);
  if (!dialog) return null;
  const answer = async (confirmed: boolean) => {
    try {
      await hanaFetch(`/api/confirm/${encodeURIComponent(dialog.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: confirmed ? "confirmed" : "rejected",
          value,
          sessionPath,
        }),
      });
      await refreshEngineering(sessionPath);
    } catch (error) {
      setError(String(error));
    }
  };
  return (
    <Modal
      key={dialog.id}
      title={dialog.title}
      close={() => void answer(false)}
    >
      <p>{dialog.message}</p>
      {dialog.kind === "select" ? (
        <FormSelectControl label="选择答案" value={value} onChange={setValue} options={[{value:'',label:'请选择'},...(dialog.options||[]).map((option:string)=>({value:option,label:option}))]}/>

      ) : (
        dialog.kind !== "confirm" && (
          <textarea
            aria-label="输入答案"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        )
      )}
      {error && <p role="alert">{error}</p>}
      <div className="enigma-dialog-actions">
        <button onClick={() => void answer(false)}>拒绝</button>
        <button className="enigma-primary" onClick={() => void answer(true)}>
          确认
        </button>
      </div>
    </Modal>
  );
}

function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current
      ?.querySelector<HTMLElement>("input,textarea,select,button")
      ?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      }
      if (event.key !== "Tab") return;
      const items = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)",
          ) || [],
        ),
        first = items[0],
        last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      if(previous?.isConnected&&previous!==document.body&&!previous.closest('[inert]'))previous.focus();else document.querySelector<HTMLElement>('.enigma-drawer .enigma-close-pane')?.focus();
    };
  }, []);
  return (
    <SurfaceModal><div className="enigma-modal-backdrop">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="enigma-modal enigma-surface-card" data-glass-frame="sheet" data-glass-controls=""
      >
        <header>
          <h2>{title}</h2>
          <button aria-label={`关闭 ${title}`} onClick={close}>
            ×
          </button>
        </header>
        {children}
      </div>
    </div></SurfaceModal>
  );
}
