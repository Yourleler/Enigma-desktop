import { create } from 'zustand';
import { hanaFetch } from '../hooks/use-hana-fetch';
import { useStore } from '../stores';

export interface Field {
  name: string; label: string; kind?: string; required?: boolean; options?: string[]; source?: string; help?: string;
  value?: unknown; fields?: Field[]; when?: { field: string; values: string[] };
}
export interface Action { id: string; group: string; title: string; description: string; effect?: string; fields: Field[] }
export interface Tab { id: string; title: string; group: string; repo?: string; file?: string; resource?: string; artifact?: string }
export interface EngineeringState {
  sessionPath: string; connectionId: string; operationTabs: Record<string,string>; snapshot: any; tabs: Tab[]; active: string; data: any; loading: boolean; error: string;
  form?: Action; formSession?: string; choices: any; connectOpen: boolean; paneOpen: boolean; results: Record<string, any>;
}
export const useEngineering = create<EngineeringState>(() => ({ sessionPath: '', connectionId: '', operationTabs: {}, snapshot: null, tabs: [], active: '', data: null,
  loading: false, error: '', choices: {}, connectOpen: false, paneOpen: false, results: {} }));

export const groups = [
  { id: 'project', label: '项目与仓库' }, { id: 'plan', label: '计划' }, { id: 'collaboration', label: '协作' },
  { id: 'timeline', label: '时光机' }, { id: 'observer', label: '运行状态' }, { id: 'reading', label: '代码' },
  { id: 'materials', label: '资料' }, { id: 'artifacts', label: '产物' }, { id: 'environment', label: '环境' },
  { id: 'review', label: '审查' }, { id: 'memory', label: '记忆' }, { id: 'skills', label: '技能' }, { id: 'handoff', label: '背景交接' },
];

export async function engineeringRequest(route: string, sessionPath: string, body?: unknown, signal?: AbortSignal) {
  const res = await hanaFetch(`/api/enigma${route}${route.includes('?') ? '&' : '?'}sessionPath=${encodeURIComponent(sessionPath)}`, {
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(body as object), sessionPath }) }),
    signal, throwOnHttpError: false, timeout: 30000,
  });
  const value = await res.json();
  if (!res.ok) throw new Error(typeof value.error === 'string' ? value.error : '工程操作失败');
  return value;
}

let contentGeneration = 0;
let refreshGeneration = 0;
export async function refreshEngineering(sessionPath: string, signal?: AbortSignal) {
  const generation = ++refreshGeneration;
  const connectionId = useEngineering.getState().connectionId;
  const value = await engineeringRequest('', sessionPath, undefined, signal);
  if (generation !== refreshGeneration || useEngineering.getState().sessionPath !== sessionPath || useEngineering.getState().connectionId !== connectionId) return;
  const operation = value.state?.operation;
  const previous = useEngineering.getState().snapshot?.state?.operation;
  const results = { ...useEngineering.getState().results };
  if (operation && ['completed', 'failed', 'cancelled', 'unknown'].includes(operation.state) && operation.id !== previous?.id ||
      operation?.state === 'completed' && previous?.state !== 'completed') {
    const active = useEngineering.getState().operationTabs[operation.id];
    if (active) results[active] = operation.result ?? { state: operation.state, error: operation.error };
    if (active === useEngineering.getState().active) { const tab = useEngineering.getState().tabs.find(item => item.id === active); if (tab) void loadEngineeringTab(tab); }
  }
  useEngineering.setState({ snapshot: value, results });
}

export function openEngineering(tab: Tab) {
  const state = useEngineering.getState();
  const tabs = state.tabs.some(item => item.id === tab.id) ? state.tabs : [...state.tabs, tab].slice(-20);
  useEngineering.setState({ tabs, active: tab.id, paneOpen: true, form: undefined });
  try { localStorage.setItem(tabStorageKey(state.sessionPath), JSON.stringify(tabs)); } catch { /* descriptors are optional UI state */ }
  const width = Math.max(300, Math.min(640, window.innerWidth - (window.innerWidth < 1000 ? 0 : 240) - 420));
  document.documentElement.style.setProperty('--jian-sidebar-width', `${width}px`);
  useStore.setState({ jianOpen: true, jianAutoCollapsed: false, ...(window.innerWidth < 1000 ? { sidebarOpen: false, sidebarAutoCollapsed: false } : {}) });
  void loadEngineeringTab(tab);
}

export function openGroup(group: string) { openEngineering({ id: `group:${group}`, group, title: groups.find(item => item.id === group)?.label || group }); }

export async function loadEngineeringTab(tab: Tab, query = '') {
  const generation = ++contentGeneration, sessionPath = useEngineering.getState().sessionPath;
  useEngineering.setState({ loading: true, data: null, error: '' });
  try {
    let value: any;
    if (tab.file || tab.resource || tab.artifact) {
      const params = new URLSearchParams();
      for (const key of ['repo', 'file', 'resource', 'artifact'] as const) if (tab[key]) params.set(key, tab[key]!);
      value = await engineeringRequest(`/content?${params}`, sessionPath);
    } else value = await engineeringRequest(`/data/${tab.group}?query=${encodeURIComponent(query)}`, sessionPath);
    if (generation !== contentGeneration || sessionPath !== useEngineering.getState().sessionPath || tab.id !== useEngineering.getState().active) return;
    useEngineering.setState({ data: value, loading: false });
  } catch (error) {
    if (generation === contentGeneration && sessionPath === useEngineering.getState().sessionPath) useEngineering.setState({ loading: false, error: String(error) });
  }
}

export async function showAction(action: Action) {
  const sessionPath = useEngineering.getState().sessionPath;
  useEngineering.setState({ form: action, formSession: sessionPath, error: '' });
  try {
    const choices = await engineeringRequest('/data/choices', sessionPath);
    if (useEngineering.getState().formSession === sessionPath) useEngineering.setState({ choices });
  } catch (error) { if (useEngineering.getState().sessionPath === sessionPath) useEngineering.setState({ error: String(error) }); }
}

export async function submitAction(action: Action, args: Record<string, unknown>) {
  const state = useEngineering.getState(), sessionPath = state.formSession;
  if (!sessionPath || sessionPath !== state.sessionPath) throw new Error('会话已切换，请重新打开操作表单');
  const result = await engineeringRequest('/action', sessionPath, { action: action.id, args });
  if (useEngineering.getState().sessionPath !== sessionPath) return;
  const operationTabs = { ...useEngineering.getState().operationTabs, [result.operation.id]:state.active };
  useEngineering.setState({ form: undefined, operationTabs, results: { ...state.results, [state.active]: result } });
  await refreshEngineering(sessionPath);
}

export function tabStorageKey(sessionPath: string) { return `enigma-tabs:${useStore.getState().activeServerConnectionId}:${sessionPath}`; }

export function restoreTabs(sessionPath: string) {
  ++contentGeneration; ++refreshGeneration;
  let tabs: Tab[] = [];
  try {
    const saved = JSON.parse(localStorage.getItem(tabStorageKey(sessionPath)) || '[]');
    if (Array.isArray(saved)) tabs = saved.filter(item => item && typeof item.id === 'string' && typeof item.group === 'string' && typeof item.title === 'string').slice(-20);
  } catch { /* invalid descriptors do not carry authority */ }
  useEngineering.setState({ sessionPath, connectionId:useStore.getState().activeServerConnectionId || '', operationTabs:{}, connectOpen:false, snapshot: null, tabs, active: tabs[0]?.id || '', data: null, results: {}, form: undefined, formSession: undefined, error: '' });
  if (tabs[0]) void loadEngineeringTab(tabs[0]);
}
