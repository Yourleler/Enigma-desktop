import { create } from "zustand";
import { hanaFetch } from "../hooks/use-hana-fetch";
import { useStore } from "../stores";
import { presentAction } from './interaction-copy';
import { activeFieldValues } from './form-fields';

export interface Field {
  name: string;
  label: string;
  kind?: string;
  required?: boolean;
  options?: string[];
  items?: Array<{value:string;label:string}>;
  source?: string;
  help?: string;
  value?: unknown;
  displayValue?: string;
  fields?: Field[];
  when?: { field: string; values: string[] };
}
export interface Action {
  id: string;
  group: string;
  title: string;
  description: string;
  effect?: string;
  fields: Field[];
}
export interface Tab {
  id: string;
  title: string;
  group: string;
  repo?: string;
  file?: string;
  resource?: string;
  artifact?: string;
}
export interface EngineeringState {
  sessionPath: string;
  connectionId: string;
  operationTabs: Record<string, string>;
  snapshot: any;
  tabs: Tab[];
  active: string;
  data: any;
  loading: boolean;
  error: string;
  refreshError?: string;
  form?: Action;
  formKey?: number;
  formSession?: string;
  choices: any;
  formLoading?: boolean;
  formError?: string;
  connectOpen: boolean;
  paneOpen: boolean;
  results: Record<string, any>;
  sections: Record<string,string>;
}
export const useEngineering = create<EngineeringState>(() => ({
  sessionPath: "",
  connectionId: "",
  operationTabs: {},
  snapshot: null,
  tabs: [],
  active: "",
  data: null,
  loading: false,
  error: "",
  refreshError: "",
  choices: {},
  connectOpen: false,
  paneOpen: false,
  results: {},
  sections: {},
}));

export const groups = [
  { id: "conductor", label: "任务群" },
  { id: "project", label: "项目与仓库" },
  { id: "plan", label: "任务计划" },
  { id: "collaboration", label: "协作" },
  { id: "timeline", label: "时光机" },
  { id: "observer", label: "运行状态" },
  { id: "reading", label: "变更与阅读" },
  { id: "materials", label: "资料" },
  { id: "artifacts", label: "成果" },
  { id: "environment", label: "环境" },
  { id: "review", label: "审查" },
  { id: "memory", label: "记忆" },
  { id: "skills", label: "技能与配方" },
  { id: "handoff", label: "背景交接" },
  { id: "documents", label: "文档维护" },
  { id: "acceptance", label: "要求与验收" },
];
export const featureSections=[
  {label:'任务与协作',items:[{id:'acceptance',description:'核对原要求、有效证据与未完成项'},{id:'collaboration',description:'查看独立工作对话和方案比较'},{id:'handoff',description:'沿用背景，或将任务交给其他 Agent'}]},
  {label:'知识与交付',items:[{id:'materials',description:'阅读当前任务的资料和背景'},{id:'documents',description:'维护文档来源，运行文档示例'}]},
  {label:'运行与质量',items:[{id:'environment',description:'服务、后台命令与等待结果'},{id:'review',description:'独立检查当前改动和源码依据'}]},
];

export async function engineeringRequest(
  route: string,
  sessionPath: string,
  body?: unknown,
  signal?: AbortSignal,
) {
  const res = await hanaFetch(
    `/api/enigma${route}${route.includes("?") ? "&" : "?"}sessionPath=${encodeURIComponent(sessionPath)}`,
    {
      ...(body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...(body as object), sessionPath }),
          }),
      signal,
      throwOnHttpError: false,
      timeout: 30000,
    },
  );
  let parseFailed = false;
  const value = await res.json().catch(() => { parseFailed = true; return { error: `服务返回了无法读取的内容（HTTP ${res.status}）` }; });
  if (!res.ok || parseFailed) {
    const error = new Error(typeof value?.error === 'string' ? value.error : '工程操作失败') as Error & {status:number};
    error.status=res.status;
    throw error;
  }
  return value;
}

let contentGeneration = 0;
let refreshGeneration = 0;
function activeConversationMatches(allowPending=false){
  const native=useStore.getState(),engineering=useEngineering.getState();
  return (allowPending||!native.pendingSessionSwitchPath)&&(!native.currentSessionPath||native.currentSessionPath===engineering.sessionPath)&&(!native.activeServerConnectionId||native.activeServerConnectionId===engineering.connectionId);
}
export async function refreshEngineering(
  sessionPath: string,
  signal?: AbortSignal,
) {
  const generation = ++refreshGeneration;
  const connectionId = useEngineering.getState().connectionId;
  const value = await engineeringRequest("", sessionPath, undefined, signal);
  if (
    generation !== refreshGeneration ||
    useEngineering.getState().sessionPath !== sessionPath ||
    useEngineering.getState().connectionId !== connectionId
  )
    return;
  const operation = value.state?.operation;
  const previous = useEngineering.getState().snapshot?.state?.operation;
  const results = { ...useEngineering.getState().results };
  let removedActive = false;
  let nextTabs = useEngineering.getState().tabs;
  if (
    operation &&
      ["completed", "failed", "cancelled", "unknown"].includes(
        operation.state,
      ) &&
      (operation.id !== previous?.id || operation.state !== previous?.state)
  ) {
    const active = useEngineering.getState().operationTabs[operation.id];
    if (active)
      results[active] = operation.result ?? {
        state: operation.state,
        error: operation.error,
      };
    if (operation.state === 'completed' && typeof operation.result?.removedResource === 'string') {
      const removed = operation.result.removedResource;
      removedActive = nextTabs.some(tab => tab.id === useEngineering.getState().active && tab.resource === removed);
      nextTabs = nextTabs.filter(tab => tab.resource !== removed);
      results['group:materials'] = operation.result;
    }
    if (!removedActive && active === useEngineering.getState().active) {
      const tab = useEngineering
        .getState()
        .tabs.find((item) => item.id === active);
      if (tab) void loadEngineeringTab(tab);
    }
  }
  useEngineering.setState({ snapshot: value, results, tabs: nextTabs, refreshError: '' });
  if (removedActive) { openGroup('materials'); return; }
  if (
    value.kind === "manager" &&
    !useEngineering.getState().loading &&
    useEngineering.getState().active === "group:conductor" &&
    JSON.stringify(value.conductorSummary) !==
      JSON.stringify(useEngineering.getState().data?.summary)
  ) {
    const tab = useEngineering
      .getState()
      .tabs.find((tab) => tab.id === "group:conductor");
    if (tab) void loadEngineeringTab(tab);
  }
}

export function openEngineering(tab: Tab) {
  if(!activeConversationMatches()){useStore.getState().addToast('正在切换对话，请稍后打开这个功能。','info');return;}
  const state = useEngineering.getState();
  const tabs = state.tabs.some((item) => item.id === tab.id)
    ? state.tabs.map(item=>item.id===tab.id?{...item,title:tab.title}:item)
    : [...state.tabs, tab].slice(-20);
  useEngineering.setState({
    tabs,
    active: tab.id,
    paneOpen: true,
    form: undefined,
  });
  try {
    localStorage.setItem(
      tabStorageKey(state.sessionPath),
      JSON.stringify(tabs),
    );
  } catch {
    /* descriptors are optional UI state */
  }
  useStore.setState({
    jianOpen: true,
    jianAutoCollapsed: false,
    ...(window.innerWidth < 861
      ? { sidebarOpen: false, sidebarAutoCollapsed: false }
      : {}),
  });
  rememberEngineeringView();
  void loadEngineeringTab(tab);
}

export function openGroup(group: string) {
  openEngineering({
    id: `group:${group}`,
    group,
    title: groups.find((item) => item.id === group)?.label || group,
  });
}
export function openRecipes(){
  useEngineering.setState(state=>({sections:{...state.sections,skills:'recipes'}}));
  openGroup('skills');
}
export function openTaskMaps(){
  useEngineering.setState(state=>({sections:{...state.sections,reading:'maps'}}));openGroup('reading');
}

export async function loadEngineeringTab(tab: Tab, query = "") {
  const generation = ++contentGeneration,
    sessionPath = useEngineering.getState().sessionPath;
  const connectionId=useEngineering.getState().connectionId;
  useEngineering.setState({ loading: true, data: null, error: "" });
  try {
    let value: any;
    if (tab.group==='reading' && tab.repo && !tab.file) value={};
    else if (tab.file || tab.resource || tab.artifact) {
      const params = new URLSearchParams();
      for (const key of ["repo", "file", "resource", "artifact"] as const)
        if (tab[key]) params.set(key, tab[key]!);
      value = await engineeringRequest(`/content?${params}`, sessionPath);
    } else
      value = await engineeringRequest(
        `/data/${tab.group}?query=${encodeURIComponent(query)}`,
        sessionPath,
      );
    if (
      generation !== contentGeneration ||
      sessionPath !== useEngineering.getState().sessionPath ||
      connectionId !== useEngineering.getState().connectionId ||
      tab.id !== useEngineering.getState().active
    )
      return;
    useEngineering.setState({ data: value, loading: false });
  } catch (error) {
    if (
      generation === contentGeneration &&
      sessionPath === useEngineering.getState().sessionPath
      && connectionId === useEngineering.getState().connectionId
    )
      useEngineering.setState({ loading: false, error: String(error) });
  }
}

let formGeneration = 0;
export function showRecordAction(id: string, values: Record<string, unknown>, labels: Record<string, string> = {}) {
  const action = useEngineering.getState().snapshot?.actions?.find((item:Action)=>item.id===id);
  if (action) return showAction({...action,fields:action.fields.map((field:Field)=>field.name in values?{...field,value:values[field.name],...(labels[field.name]?{kind:'record',source:undefined,displayValue:labels[field.name],help:'已选择这份记录；提交时仍会核对所属任务和当前版本。'}:{})}:field)});
}
export async function showAction(input: Action, preserveFields=false):Promise<void> {
  if(!activeConversationMatches()){useStore.getState().addToast('对话正在切换，请在目标对话中重新打开操作。','info');return;}
  if(input.id==='package-restore'&&!input.fields.some(field=>field.name==='expectedManifest'&&typeof field.value==='string')){
    const inspect=useEngineering.getState().snapshot?.actions?.find((action:Action)=>action.id==='package-inspect');
    if(inspect)return showAction({...inspect,title:'先检查要复现的任务包',description:'输入任务包目录，先核对内容和包内仓库，再选择目标目录及写权限。'});
    useStore.getState().addToast('请先检查任务包，核对包内仓库后再复现。','info');return;
  }
  if(input.id==='recipe-run'&&!input.fields.some(field=>field.name==='version'&&typeof field.value==='string')){
    openRecipes();useStore.getState().addToast('从配方卡片选择运行，先核对步骤与参数。','info');return;
  }
  const generation = ++formGeneration;
  const action = presentAction(input);
  const sessionPath = useEngineering.getState().sessionPath;
  const connectionId=useEngineering.getState().connectionId;
  const sources = new Set<string>();
  const collect = (fields: Field[]) => fields.forEach(field=>{if(field.source)sources.add(field.source);collect(field.fields||[]);});
  collect(action.fields);
  const loading = sources.size > 0;
  useEngineering.setState({
    form: action,
    ...(!preserveFields?{formKey:generation}:{}),
    formSession: sessionPath,
    error: "",
    choices: {},
    formLoading: loading,
    formError: '',
  });
  if (!loading) return;
  const current = () => generation === formGeneration && useEngineering.getState().formSession === sessionPath && useEngineering.getState().form?.id===action.id && useEngineering.getState().connectionId===connectionId;
  try {
    let choices;
    try { choices = await engineeringRequest(`/choices?sources=${encodeURIComponent([...sources].join(','))}`, sessionPath); }
    catch(error) {
      // An older running server may serve the freshly built renderer. Only an
      // absent endpoint uses the legacy route; access failures never fall back.
      if ((error as {status?:number}).status !== 404) throw error;
      choices = await engineeringRequest('/data/choices',sessionPath);
    }
    if (action.id === 'delegate-preview') choices = { ...choices, delegations: (choices.delegations || []).filter((item:any) => item.terminal && item.status === 'completed') };
    if (action.id === 'delegate-cancel') choices = { ...choices, delegations: (choices.delegations || []).filter((item:any) => !item.terminal) };
    if (action.id === 'material-refresh') choices = { ...choices, materials: (choices.materials || []).filter((item:any) => (item.resource || item).source?.kind !== 'note') };
    if (current()) useEngineering.setState({ choices, formLoading: false });
  } catch (error) {
    if (current()) useEngineering.setState({ formError: String(error), formLoading: false });
  }
}

export async function submitAction(
  action: Action,
  args: Record<string, unknown>,
) {
  const state = useEngineering.getState(),
    sessionPath = state.formSession;
  if (!activeConversationMatches() || !sessionPath || sessionPath !== state.sessionPath)
    throw new Error("会话已切换，请重新打开操作表单");
  await runAction(action, args, state, sessionPath);
}

/** A snapshot row already identifies both revisions. Preview is read-only and
 * can go straight to the result; writes still go through the action form. */
export async function previewCheckpoint(target: string, expected: string) {
  const state = useEngineering.getState();
  const action = state.snapshot?.actions?.find((item: Action) => item.id === 'restore-preview');
  if (!state.sessionPath || !action) throw new Error('当前对话暂不能预览，请刷新后重试');
  await runAction(action, { target, expected }, state, state.sessionPath);
}

export async function runDocumentExample(document: string, example: string) {
  const state = useEngineering.getState();
  const action = state.snapshot?.actions?.find((item: Action) => item.id === 'document-example');
  if (!state.sessionPath || !action) throw new Error('当前服务尚不支持可跟踪的文档验证，请更新服务后重试');
  await runAction(action, { selection: `${document}/${example}` }, state, state.sessionPath);
}

export async function readRecordAction(id: string, args: Record<string, unknown>) {
  if(!['skills-read','memory-read','package-inspect','handoff-inspect','material-raw','recipe-report','reading-open','browser-report'].includes(id))throw new Error('该操作需要先填写并确认表单');
  const state=useEngineering.getState(),action=state.snapshot?.actions?.find((item:Action)=>item.id===id);
  if(!state.sessionPath||!action)throw new Error('当前记录暂不可读，请刷新后重试');
  await runAction(action,args,state,state.sessionPath);
}

async function runAction(action: Action, args: Record<string, unknown>, state: EngineeringState, sessionPath: string) {
  if(!activeConversationMatches())throw new Error('对话已切换，请在目标对话重新打开这个操作。');
  const result = await engineeringRequest("/action", sessionPath, {
    action: action.id,
    args: activeFieldValues(action.fields,args),
  });
  if (!activeConversationMatches(true) || useEngineering.getState().sessionPath !== sessionPath || useEngineering.getState().connectionId !== state.connectionId) return;
  const current = useEngineering.getState();
  const operationTabs = {
    ...useEngineering.getState().operationTabs,
    [result.operation.id]: state.active,
  };
  useEngineering.setState({
    ...(current.form === action ? { form: undefined } : {}),
    operationTabs,
    results: { ...current.results, [state.active]: result },
  });
  await refreshEngineering(sessionPath);
}

export function tabStorageKey(sessionPath: string) {
  return `enigma-tabs:${useStore.getState().activeServerConnectionId}:${sessionPath}`;
}
export function rememberEngineeringView(){
  const state=useEngineering.getState();
  try{localStorage.setItem(tabStorageKey(state.sessionPath),JSON.stringify(state.tabs));localStorage.setItem(`${tabStorageKey(state.sessionPath)}:view`,JSON.stringify({active:state.active,paneOpen:state.paneOpen,sections:state.sections}));}catch{/* Optional UI persistence never prevents navigation. */}
}

export function restoreTabs(sessionPath: string) {
  ++contentGeneration;
  ++refreshGeneration;
  useEngineering.setState({refreshError:''});
  let tabs: Tab[] = [];
  let view:{active?:string;paneOpen?:boolean;sections?:Record<string,string>}={};
  try {
    const saved = JSON.parse(
      localStorage.getItem(tabStorageKey(sessionPath)) || "[]",
    );
    if (Array.isArray(saved))
      tabs = saved
        .filter(
          (item) =>
            item &&
            typeof item.id === "string" &&
            typeof item.group === "string" &&
            typeof item.title === "string",
        )
        .slice(-20);
    view=JSON.parse(localStorage.getItem(`${tabStorageKey(sessionPath)}:view`)||'{}')||{};
  } catch {
    /* invalid descriptors do not carry authority */
  }
  useEngineering.setState({
    sessionPath,
    sections:{...(view.sections?.skills==='recipes'?{skills:'recipes'}:{}),...(['diff','smart','files','maps'].includes(view.sections?.reading||'')?{reading:view.sections!.reading}:{})},
    connectionId: useStore.getState().activeServerConnectionId || "",
    operationTabs: {},
    connectOpen: false,
    snapshot: null,
    tabs,
    active: tabs.find(tab=>tab.id===view.active)?.id||tabs[0]?.id||"",
    paneOpen:typeof view.paneOpen==='boolean'?view.paneOpen:false,
    loading:false,
    data: null,
    results: {},
    form: undefined,
    formSession: undefined,
    error: "",
  });
  const active=tabs.find(tab=>tab.id===useEngineering.getState().active);
  if(active&&useEngineering.getState().paneOpen){useStore.setState({jianOpen:true,jianAutoCollapsed:false});void loadEngineeringTab(active);}
}
