import { FormSelectControl } from './FormSelect';
import { AUTO_LIGHT_DEFAULT, AUTO_DARK_DEFAULT, THEMES, type ThemeId } from '../../shared/theme-registry';
import { persistAppearancePreferences, readBrowserAppearancePreferences } from '../services/appearance-sync';
import { switchSession } from '../stores/session-actions';
import { renderMarkdown } from '../utils/markdown';
import { useEffect, useState, useRef, type PointerEvent } from 'react';
import { useStore } from '../stores';
import { hanaFetch } from '../hooks/use-hana-fetch';
import { MarkdownContent } from '../components/chat/MarkdownContent';
import { groups, useEngineering, refreshEngineering, restoreTabs, openGroup, openEngineering, loadEngineeringTab, showAction, submitAction, engineeringRequest,
  tabStorageKey, type Field, type Action, type Tab } from './state';
import './engineering.css';
import { Changes } from './Changes';
import { ModelPolicyDialog } from './ModelPolicy';
import { ConductorCreateDialog } from './ConductorCreate';
import { ConductorTasks } from './ConductorTasks';
import { GuardianPanel } from './Guardian';
const EMPTY_LIST: any[] = [];

function pointer(event: PointerEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty('--glass-x', `${event.clientX - rect.left}px`);
  event.currentTarget.style.setProperty('--glass-y', `${event.clientY - rect.top}px`);
}

export function EngineeringToolbar() {
  const sessionPath = useStore(s => s.currentSessionPath) || '';
  const connection = useStore(s => s.activeServerConnectionId);
  const snapshot = useEngineering(s => s.snapshot);
  const activeTab = useEngineering(s => s.active);
  const [modelsOpen,setModelsOpen]=useState(false);
  const [appearance, setAppearance] = useState(() => {
    try { return { glass: true, motion: true, ...JSON.parse(localStorage.getItem('enigma-appearance') || '{}') }; }
    catch { return { glass: true, motion: true }; }
  });
  useEffect(() => {
    restoreTabs(sessionPath);
    if (!sessionPath) return;
    const controller = new AbortController();
    let stopped = false;
    const poll = async () => {
      try { await refreshEngineering(sessionPath, controller.signal); }
      catch (error) { if (!stopped) useEngineering.setState({ error: String(error) }); }
    };
    void poll();
    const timer = setInterval(() => { if (!document.hidden) void poll(); }, 1500);
    return () => { stopped = true; controller.abort(); clearInterval(timer); };
  }, [sessionPath, connection]);
  useEffect(() => {
    if (!snapshot?.connected) return;
    const resize = () => {
      const width = Math.max(300, Math.min(640, window.innerWidth - (window.innerWidth < 1000 ? 0 : 240) - 420));
      document.documentElement.style.setProperty('--jian-sidebar-width', `${width}px`);
      if (window.innerWidth < 1000) useStore.setState({ sidebarOpen: false, sidebarAutoCollapsed: false });
    };
    window.addEventListener('resize',resize);
    return () => window.removeEventListener('resize',resize);
  }, [snapshot?.connected]);
  useEffect(() => {
    const tone=()=>{const selected=document.documentElement.getAttribute('data-theme') as ThemeId,background=THEMES[selected]?.backgroundColor || THEMES[AUTO_LIGHT_DEFAULT].backgroundColor;const red=parseInt(background.slice(1,3),16),green=parseInt(background.slice(3,5),16),blue=parseInt(background.slice(5,7),16);document.body.dataset.enigmaTone=0.2126*red+0.7152*green+0.0722*blue<128?'dark':'light';};
    tone();const observer=new MutationObserver(tone);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});return ()=>observer.disconnect();
  },[]);
  useEffect(() => {
    document.body.classList.toggle('enigma-engineering', !!snapshot?.connected);
    document.body.classList.add('enigma-surface');
    document.body.classList.toggle('enigma-glass-off', !appearance.glass);
    document.body.classList.toggle('enigma-motion-off', !appearance.motion);
    localStorage.setItem('enigma-appearance', JSON.stringify(appearance));
    return () => document.body.classList.remove('enigma-engineering','enigma-surface');
  }, [snapshot?.connected, appearance]);
  if (!sessionPath) return <><div className="enigma-new-task-settings"><button onClick={()=>setModelsOpen(true)}>新任务模型分工</button></div>{modelsOpen&&<ModelPolicyDialog close={()=>setModelsOpen(false)} />}</>;
  const operation = snapshot?.state?.operation;
  const busy = operation?.state === 'running' || snapshot?.state?.idle === false;
  return <>
    <svg width="0" height="0" aria-hidden="true" className="enigma-glass-definition"><defs><filter id="enigma-liquid-refraction" x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.008 0.018" numOctaves="1" seed="4" result="noise" /><feGaussianBlur in="noise" stdDeviation="3" result="smooth" /><feDisplacementMap in="SourceGraphic" in2="smooth" scale="24" xChannelSelector="R" yChannelSelector="G" /></filter></defs></svg>
    <div className="enigma-toolbar enigma-glass" onPointerMove={pointer} data-testid="engineering-toolbar">
      <button className="enigma-project-button" onClick={() => snapshot?.connected ? openGroup('project') : useEngineering.setState({ connectOpen: true })}>
        <span className="enigma-mark">E</span><span>{snapshot?.connected ? snapshot.root.split('/').pop() : '选择工程工作区'}</span>
      </button>
      {snapshot?.connected && <><nav aria-label="当前任务功能">{(snapshot.kind==='manager'?[['conductor','任务群'],['artifacts','汇总成果'],['timeline','恢复记录']]:[['plan','任务'],['reading','变更'],['artifacts','成果'],['timeline','时光机']]).map(([id,label]) => <button key={id} data-active={activeTab === `group:${id}`} onClick={() => openGroup(id)}>{label}</button>)}</nav>
        <button className="enigma-runtime-button" onClick={() => openGroup('observer')}><span className={busy ? 'enigma-live' : ''}>●</span>{busy ? '运行中' : '运行状态'}</button>
        <details className="enigma-more"><summary>更多</summary><div className="enigma-action-menu enigma-glass">{['collaboration','materials','environment','review','handoff'].map(id => <button key={id} onClick={() => openGroup(id)}>{groups.find(group => group.id === id)!.label}</button>)}</div></details></>}
      <details className="enigma-appearance"><summary aria-label="工作台外观">◐</summary><div className="enigma-glass">
        <label><input type="checkbox" checked={appearance.glass} onChange={e => setAppearance({ ...appearance, glass: e.target.checked })} />玻璃效果</label>
        <label><input type="checkbox" checked={appearance.motion} onChange={e => setAppearance({ ...appearance, motion: e.target.checked })} />界面动效</label>
        <div className="enigma-theme-choice">{[[AUTO_LIGHT_DEFAULT,'浅色'],[AUTO_DARK_DEFAULT,'深色']].map(([theme,label]) => <button key={theme} onClick={() => { window.setTheme?.(theme); void persistAppearancePreferences(readBrowserAppearancePreferences()).catch(error => useEngineering.setState({ error: String(error) })); }}>{label}</button>)}</div>
        <button onClick={() => useEngineering.setState({ connectOpen: true })}>切换工程工作区</button>
        <button onClick={()=>setModelsOpen(true)}>模型分工</button>
        <button onClick={()=>void engineeringRequest('/conductor/new',sessionPath,{}).then(result=>switchSession(result.sessionPath)).catch(error=>useEngineering.setState({error:String(error)}))}>新建任务编排管家</button>
      </div></details>
    </div>
    {snapshot?.connected && <div className="enigma-progress" role="status"><span className={busy ? 'enigma-live' : ''} />
      <span>{operation?.state === 'running' ? operation.title : busy ? 'Agent 正在运行' : operation?.state === 'failed' ? '操作失败，可查看详情' : '任务就绪'}</span>
      <span>{snapshot.overview?.repositories?.length || 0} 个仓库</span>
      {snapshot.modelSelection?.state === 'pending' && <span>下一请求 → {snapshot.modelSelection.id}</span>}
      {snapshot.modelSelection?.state === 'failed' && <span title={snapshot.modelSelection.error}>模型切换未生效，当前模型继续</span>}
      {snapshot.overview?.blockers?.length > 0 && <button onClick={() => openGroup('observer')}>{snapshot.overview.blockers.length} 项待核对</button>}
      {busy && <button onClick={() => void engineeringRequest('/cancel', sessionPath, {}).catch(error => useEngineering.setState({ error: String(error) }))}>停止</button>}
    </div>}
    <ConnectDialog /> <ActionDialog /> <ApprovalDialog />
    {modelsOpen&&<ModelPolicyDialog close={()=>setModelsOpen(false)} />}
  </>;
}

export function EngineeringSidebar() {
  const snapshot = useEngineering(s => s.snapshot);
  const [conductorOpen,setConductorOpen]=useState(false);
  if (!snapshot?.connected) return null;
  return <div className="enigma-sidebar-tools" aria-label="工程项目功能">
    <button onClick={() => openGroup('project')}>◇ 项目与仓库 <span>{snapshot.overview?.repositories?.length || 0}</span></button>
    <div><button onClick={() => openGroup('memory')}>记忆</button><button onClick={() => openGroup('skills')}>技能与配方</button></div>
    {snapshot.kind!=='manager'&&<button onClick={()=>setConductorOpen(true)}>＋ 新建管家任务</button>}
    {conductorOpen&&<ConductorCreateDialog close={()=>setConductorOpen(false)}/>}
  </div>;
}

export function EngineeringPanel() {
  const state = useEngineering();
  const [query, setQuery] = useState('');
  const active = state.tabs.find(tab => tab.id === state.active);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  if (!state.snapshot?.connected || !state.paneOpen || !active) return null;
  const actions: Action[] = (state.snapshot.actions || []).filter((action: Action) => action.group === active.group);
  const close = (id: string) => {
    const tabs = state.tabs.filter(tab => tab.id !== id), next = state.active === id ? tabs.at(-1) : active;
    useEngineering.setState({ tabs, active: next?.id || '', paneOpen: tabs.length > 0 });
    localStorage.setItem(tabStorageKey(state.sessionPath), JSON.stringify(tabs));
    if (next) void loadEngineeringTab(next);
  };
  const switchTab = (tab: Tab) => { useEngineering.setState({ active: tab.id }); void loadEngineeringTab(tab); };
  const key = (event: React.KeyboardEvent, index: number) => {
    if (!['ArrowRight','ArrowLeft','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? state.tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + state.tabs.length) % state.tabs.length;
    switchTab(state.tabs[next]); refs.current[state.tabs[next].id]?.focus();
  };
  return <section className="enigma-panel enigma-glass" onPointerMove={pointer} aria-label="工程内容工作区" data-testid="engineering-panel">
    <div className="enigma-tabbar" role="tablist" aria-label="已打开内容">{state.tabs.map((tab, index) => <div className="enigma-tab" key={tab.id} data-active={tab.id === state.active}>
      <button ref={element => { refs.current[tab.id] = element; }} role="tab" aria-selected={tab.id === state.active} tabIndex={tab.id === state.active ? 0 : -1} onKeyDown={event => key(event, index)} onClick={() => switchTab(tab)}>{tab.title}</button>
      <button aria-label={`关闭 ${tab.title}`} onClick={() => close(tab.id)}>×</button>
    </div>)}<button className="enigma-close-pane" aria-label="收起工程面板" onClick={() => useEngineering.setState({ paneOpen: false })}>⇥</button></div>
    <div className="enigma-panel-head"><div><small>{active.file ? `${active.repo} / ${active.file}` : state.snapshot.kind==='manager'?'管家任务群':'项目工作区'}</small><h2>{active.title}</h2></div>
      <button aria-label="刷新当前内容" onClick={() => void loadEngineeringTab(active, query)}>↻</button></div>
    {!active.file && !active.resource && !active.artifact && !['conductor','observer',...(!active.repo?['reading']:[])].includes(active.group) && <div className="enigma-panel-controls">
      <input aria-label="查询当前内容" placeholder="按关键词查找" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void loadEngineeringTab(active, query); }} />
      <button onClick={() => void loadEngineeringTab(active, query)}>查询</button>
      <details><summary>操作 <span>{actions.length}</span></summary><div className="enigma-action-menu enigma-glass">{actions.map(action => <button key={action.id} onClick={() => void showAction(action)}>{action.title}<small>{action.description}</small></button>)}</div></details>
    </div>}
    <div className="enigma-content" role="tabpanel" key={`${state.sessionPath}:${active.id}`}>
      {state.error && <div className="enigma-error" role="alert">{state.error}</div>}
      {state.loading ? <div className="enigma-empty">正在核对当前来源…</div> : <Content tab={active} value={state.data} query={query} />}
      {state.snapshot?.state?.notices?.length > 0 && <details className="enigma-result"><summary>操作回执</summary>{state.snapshot.state.notices.slice(-5).map((notice: any,index: number) => <p key={index}>{notice.text}</p>)}</details>}
      {state.results[active.id] && <details className="enigma-result" open><summary>最近操作结果</summary><Evidence value={state.results[active.id]} /></details>}
      {state.snapshot?.state?.operation?.error && <div className="enigma-error">{state.snapshot.state.operation.error}</div>}
    </div>
  </section>;
}

function Content({ tab, value, query }: { tab: Tab; value: any; query: string }) {
  const overview = useEngineering(s => s.snapshot?.overview);
  if (value == null) return <div className="enigma-empty">还没有相关记录。通过“操作”添加或运行。</div>;
  if(tab.group==='conductor')return <ConductorTasks value={value}/>;
  if (tab.file || tab.resource || tab.artifact) return <div className="enigma-document">
    <div className="enigma-source-note">{value.sourceCurrent === false || value.current === false ? '历史版本 · 当前来源已变化' : tab.resource ? `保存的资料修订 · ${value.freshness || '按来源记录核对'}` : '已重新读取当前来源'} {value.version && `· ${String(value.version).slice(0,12)}`}</div>
    {tab.file?.match(/\.md$/i) || tab.resource || tab.artifact&&value.record?.extension==='.md' ? <MarkdownContent html={renderMarkdown(value.content || '')} /> : <pre>{value.content || ''}</pre>}
    {tab.artifact && <button onClick={() => void downloadArtifact(tab.artifact!)}>下载这个版本</button>}
  </div>;
  if (tab.group === 'project') return <>
    <div className="enigma-stat-grid"><Stat label="仓库" value={overview?.repositories?.length || 0} /><Stat label="原检查" value={overview?.checks?.length || 0} /><Stat label="待核对" value={overview?.blockers?.length || 0} /></div>
    {(overview?.repositories || []).map((repo: any) => <article className="enigma-repo" key={repo.id}><span className="enigma-repo-mark">⌘</span><div><strong>{repo.id}</strong><p>{repo.role || '尚未填写职责'}</p><small>{repo.root}</small><div className="enigma-chips">{repo.dependsOn.map((id: string) => <span key={id}>依赖 {id}</span>)}<span>{repo.access === 'write' ? '可写' : '只读'}</span></div></div><button onClick={() => openEngineering({ id: `repo:${repo.id}`, title: repo.id, group: 'reading', repo: repo.id })}>浏览代码</button></article>)}
    <Evidence value={{ checks: overview?.checks, blockers: overview?.blockers }} />
  </>;
  if (tab.group === 'reading') return tab.repo ? <FileTree repo={tab.repo} query={query} /> : <Changes value={value} files={<FileTree query={query} />} />;
  if (tab.group === 'plan' && value.plan) return <>
    <div className="enigma-task-heading"><span>当前目标</span><h3>{value.plan.goal}</h3><div className="enigma-plan-meter"><div style={{ width:`${value.total ? value.completed/value.total*100 : 0}%` }} /></div><small>{value.completed} / {value.total} 步骤已验收 · 修订 {value.plan.revision}</small></div>
    {(value.steps || []).map((step: any) => <article className="enigma-step" key={step.id}><span data-phase={step.phase}>{step.phase === 'verified' ? '✓' : step.phase === 'running' ? '◌' : '○'}</span><div><strong>{step.goal}</strong><div className="enigma-chips"><span>{step.repo}</span><span>{({ready:'可以开始',pending:'待开始',blocked:'等待前置任务',running:'正在执行',failed:'执行失败',verified:'已验收',stale:'需要重新验证'} as any)[step.state || step.phase] || step.state || step.phase}</span>{step.checks.map((check: string) => <span key={check}>检查 {check}</span>)}</div>{step.blockedBy?.length > 0 && <p>等待 {step.blockedBy.join('、')}</p>}</div></article>)}
    <details className="enigma-result"><summary>计划依赖与完整证据</summary><Evidence value={value} /></details>
  </>;
  if (tab.group === 'observer') return <div className="enigma-observer-card"><GuardianPanel/><span className="enigma-eyebrow">旁路观察</span><h3>{value.available ? '当前运行状态' : '暂时没有可用观测'}</h3><p>{value.answer}</p>{value.status && <><div className="enigma-chips"><span>{value.status.state}</span><span>来源进程 {value.status.sourceProcess?.liveness}</span><span>观测 {value.status.observation}</span></div><details className="enigma-result"><summary>可回查的事实与时间记录</summary><Evidence value={value.status} /></details></>}</div>;
  if (tab.group === 'timeline') return <>
    <p className="enigma-source-note">切换会话分支与恢复代码分别操作。恢复先预览冲突，保护当前修改并重新验收。</p>
    <h3 className="enigma-section-title">Agent 主动回溯</h3>
    <p className="enigma-source-note">模型走歪时可调用时光机，带着经验回到较早上下文并自动继续；当前文件保留。</p>
    {[...(value.modelRewinds || [])].reverse().map((rewind: any) => <article className="enigma-step" key={rewind.id}><span>↶</span><div><strong>{rewind.reason}</strong><p>{rewind.lesson}</p><small>下一步：{rewind.nextStep}</small><div className="enigma-chips"><span>上下文已回溯</span><span>文件保留</span><span>{rewind.requests} 次累计请求</span></div></div></article>)}
    {!value.modelRewinds?.length && <div className="enigma-source-note">尚无主动回溯记录 · {value.contextCheckpoints?.length || 0} 个当前可用上下文检查点</div>}
    <h3 className="enigma-section-title">代码检查点</h3>
    {[...(value.checkpoints || [])].reverse().map((checkpoint: any) => <article className="enigma-checkpoint" key={checkpoint.id}><span>◈</span><div><strong>{checkpoint.label}</strong><small>{checkpoint.createdAt}</small><div className="enigma-chips">{checkpoint.repos.map((repo: any) => <span key={repo.repo.id}>{repo.repo.id}</span>)}</div></div><button onClick={() => { const action=useEngineering.getState().snapshot.actions.find((action: Action) => action.id === 'restore-preview'); void showAction({...action,fields:action.fields.map((field: Field) => field.name === 'target' ? {...field,value:checkpoint.id}:field)}); }}>预览恢复</button></article>)}
    <details className="enigma-result"><summary>会话树与未结算操作</summary><Evidence value={{tree:value.tree,operations:value.operations}} /></details>
  </>;
  if (tab.group === 'environment') return <>
    <h3 className="enigma-section-title">项目服务</h3>{(value.services || []).map((item: any) => <article className="enigma-step" key={item.service.id}><span>{item.ready ? '●' : '○'}</span><div><strong>{item.service.label}</strong><div className="enigma-chips"><span>{item.status}</span><span>{item.service.repo}</span>{item.url && <span>{item.url}</span>}</div></div></article>)}
    <h3 className="enigma-section-title">后台任务</h3>{(value.background || []).map((item: any) => <article className="enigma-step" key={item.spec.id}><span>{item.state.status==='running'?'◌':'○'}</span><div><strong>{item.spec.label}</strong><div className="enigma-chips"><span>{item.state.status}</span><span>{item.spec.repo}</span></div><details className="enigma-result"><summary>运行回执与日志</summary><Evidence value={item} /></details></div></article>)}
    {!value.services?.length && !value.background?.length && <div className="enigma-empty">添加项目服务或启动有界后台任务。</div>}
    <details className="enigma-result"><summary>等待条件与浏览器验收场景</summary><Evidence value={{waits:value.waits,scenarios:value.scenarios}} /></details>
  </>;
  if (tab.group === 'materials') return <div className="enigma-record-grid">{(Array.isArray(value) ? value : []).map((item: any) => {
    const resource = item.resource || item;
    return <button className="enigma-record" key={resource.id} onClick={() => openEngineering({ id: `resource:${resource.id}`, group: 'materials', resource: resource.id, title: resource.title })}><span>▤</span><strong>{resource.title}</strong><small>{resource.source?.kind} · 修订 {resource.revision}</small></button>;
  })}</div>;
  if (tab.group === 'artifacts') return <div className="enigma-record-grid">{(Array.isArray(value) ? value : []).map((record: any) => <button className="enigma-record" key={record.id} onClick={() => openEngineering({ id: `artifact:${record.id}`, group: 'artifacts', artifact: record.id, title: record.title })}><span>↗</span><strong>{record.title}</strong><small>{record.kind} · {record.bytes} 字节</small></button>)}</div>;
  return <Evidence value={value} />;
}

function Stat({ label, value }: { label: string; value: number }) { return <div><strong>{value}</strong><span>{label}</span></div>; }

function FileTree({ repo, query }: { repo?: string; query: string }) {
  const repositories = useEngineering(s => s.snapshot?.overview?.repositories || EMPTY_LIST);
  const [selected, setSelected] = useState(repo || repositories[0]?.id || ''), [files, setFiles] = useState<string[]>([]), [error, setError] = useState('');
  const sessionPath = useEngineering(s => s.sessionPath);
  useEffect(() => {
    const controller = new AbortController(); setFiles([]); setError('');
    if (selected) void engineeringRequest(`/files/${encodeURIComponent(selected)}`, sessionPath, undefined, controller.signal).then(value => setFiles(value.files)).catch(error => { if (!controller.signal.aborted) setError(String(error)); });
    return () => controller.abort();
  }, [selected, sessionPath]);
  const filtered = files.filter(file => file.toLowerCase().includes(query.toLowerCase()));
  return <div className="enigma-files"><div className="enigma-repo-picker" aria-label="代码仓库">{repositories.map((item: any) => <button key={item.id} data-active={item.id === selected} onClick={() => setSelected(item.id)}>{item.id}</button>)}</div>
    <div className="enigma-source-note">文件路径来自已注册仓库，依赖和凭证目录按原规则排除。</div>
    {error && <div role="alert">{error}</div>}
    <div className="enigma-file-list" role="tree" aria-label={`${selected} 文件树`}><FileBranches files={filtered.slice(0,1500)} repo={selected} expanded={!!query} /></div>
    {filtered.length === 0 && <div className="enigma-empty">没有匹配的文件</div>}
  </div>;
}

function FileBranches({ files, repo, prefix = '', expanded = false }: { files: string[]; repo: string; prefix?: string; expanded?: boolean }) {
  const folders = new Map<string,string[]>(), leaves: string[] = [];
  for (const file of files) {
    const relative = file.slice(prefix.length), slash = relative.indexOf('/');
    if (slash < 0) leaves.push(file);
    else { const folder = relative.slice(0,slash); folders.set(folder,[...(folders.get(folder) || []),file]); }
  }
  return <>{[...folders.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([folder, children]) => <details key={folder} className="enigma-file-folder" open={expanded || undefined}>
    <summary role="treeitem" aria-label={folder}>▱ {folder} <small>{children.length}</small></summary>
    <div role="group"><FileBranches files={children} repo={repo} prefix={`${prefix}${folder}/`} expanded={expanded} /></div>
  </details>)}{leaves.sort().map(file => <button role="treeitem" aria-label={file} key={file} onClick={() => openEngineering({ id: `file:${repo}:${file}`, title: file.split('/').pop()!, group: 'reading', repo, file })}><span>▧</span><span>{file.slice(prefix.length)}</span><small>打开</small></button>)}</>;
}

const labels: Record<string, string> = { goal:'目标', steps:'任务步骤', phase:'阶段', status:'状态', evidence:'验收证据', checks:'原检查', gaps:'待补齐', blockers:'待核对', note:'说明', sources:'源码依据', repositories:'仓库', graph:'关系', answer:'观察结论', facts:'已观察事实', warnings:'注意事项', checkpoints:'代码检查点', operations:'操作记录', tree:'会话树', services:'服务', background:'后台任务', waits:'等待条件', delegations:'隔离协作', experiments:'方案实验', plan:'计划', result:'结果', error:'错误', title:'名称', id:'记录', content:'正文', valid:'当前有效', sourceCurrent:'来源仍有效', details:'详情', requirements:'原始要求', coverage:'覆盖', entries:'会话条目', packages:'任务包', search:'召回结果', items:'条目', enabled:'已启用' };
function Evidence({ value, depth = 0 }: { value: any; depth?: number }) {
  if (value == null) return null;
  if (typeof value !== 'object') return <span className="enigma-value">{typeof value === 'boolean' ? value ? '是' : '否' : String(value)}</span>;
  if (Array.isArray(value)) return <div className="enigma-evidence-list">{value.length ? value.map((item, index) => <div key={index}><Evidence value={item} depth={depth + 1} /></div>) : <span className="enigma-muted">暂无记录</span>}</div>;
  if (value.sessionPath && value.sessionId) return <button className="enigma-source-link" onClick={() => void switchSession(value.sessionPath)}>打开新会话 {String(value.sessionId).slice(-8)}</button>;
  if (depth > 5) return <details><summary>更多详情</summary><pre>{JSON.stringify(value,null,2)}</pre></details>;
  const sourceButton = value.repo && value.file ? <button className="enigma-source-link" onClick={() => openEngineering({ id: `file:${value.repo}:${value.file}`, group:'reading', repo:value.repo, file:value.file, title:value.file.split('/').pop() })}>{value.repo} / {value.file}{value.line ? `:${value.line}` : ''}</button> : null;
  return <article className="enigma-evidence">{sourceButton}{Object.entries(value).filter(([key]) => !['schema','sessionFile','sessionPath','path','observation','snapshot','fingerprint'].includes(key)).map(([key, item]) => <div className="enigma-fact" key={key}><span>{labels[key] || key}</span><div><Evidence value={item} depth={depth + 1} /></div></div>)}</article>;
}

function ConnectDialog() {
  const open = useEngineering(s => s.connectOpen), sessionPath = useEngineering(s => s.sessionPath);
  const [root, setRoot] = useState(''), [memory, setMemory] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  if (!open) return null;
  return <Modal title="选择工程工作区" close={() => useEngineering.setState({ connectOpen: false })}><form onSubmit={event => { event.preventDefault(); setBusy(true); setError('');
    void engineeringRequest('/connect', sessionPath, { root, memory }).then(value => {
      if (sessionPath !== useEngineering.getState().sessionPath) return;
      useEngineering.setState({ snapshot: value, connectOpen: false }); openGroup('project');
    }).catch(error => setError(String(error))).finally(() => setBusy(false)); }}>
    <p>选择项目或多仓库协调目录，后续在项目面板加入其他仓库。</p><label className="enigma-field"><span>本地目录</span><input required aria-label="工程工作区目录" placeholder="/Users/…/code/my-project" value={root} onChange={e => setRoot(e.target.value)} /></label>
    <label className="enigma-check"><input type="checkbox" checked={memory} onChange={e => setMemory(e.target.checked)} />启用有来源的工程记忆</label>
    {error && <p role="alert" className="enigma-error">{error}</p>}<button className="enigma-primary" disabled={busy || !sessionPath}>{busy ? '正在连接…' : '连接工作区'}</button>
  </form></Modal>;
}

function defaults(fields: Field[]) { return Object.fromEntries(fields.filter(field => field.value !== undefined).map(field => [field.name, field.value])); }
function ActionDialog() {
  const form = useEngineering(s => s.form), choices = useEngineering(s => s.choices), sessionPath = useEngineering(s => s.sessionPath), formSession = useEngineering(s => s.formSession);
  const [args, setArgs] = useState<Record<string, any>>({}), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { setArgs(form ? defaults(form.fields) : {}); setError(''); }, [form?.id]);
  if (!form || sessionPath !== formSession) return null;
  return <Modal key={`${formSession}:${form.id}`} title={form.title} close={() => useEngineering.setState({ form: undefined })}><form onSubmit={event => { event.preventDefault(); setBusy(true); setError(''); void submitAction(form,args).catch(error => setError(String(error))).finally(() => setBusy(false)); }}>
    <p>{form.description}</p>{form.fields.map(field => <FieldInput key={field.name} field={field} values={args} choices={choices} change={value => setArgs({ ...args, [field.name]: value })} />)}
    {error && <p className="enigma-error" role="alert">{error}</p>}<button className="enigma-primary" disabled={busy}>{busy ? '提交中…' : form.title}</button>
  </form></Modal>;
}

function choiceItems(source: string, choices: any): Array<{ value: string; label: string }> {
  const aliases: Record<string,string> = { repos:'repositories', delegations:'delegates', materials:'materials' };
  const records = choices[source] || choices[aliases[source]] || [];
  return (Array.isArray(records) ? records : []).map(item => {
    if (typeof item === 'string') return { value:item, label:item };
    const record = item.spec || item.resource || item.record || item;
    return { value:String(record.id || record.reference || ''), label:String(record.title || record.label || record.name || record.text?.slice(0,70) || record.id || '') };
  }).filter(item => item.value);
}

function FieldInput({ field, values, choices, change }: { field: Field; values: Record<string, any>; choices: any; change: (value: any) => void }) {
  if (field.when && !field.when.values.includes(String(values[field.when.field]))) return null;
  const value = values[field.name] ?? field.value, kind = field.kind || 'text';
  const options = field.source ? choiceItems(field.source,choices) : (field.options || []).map(option => ({ value:option, label:option }));
  if (kind === 'boolean') return <label className="enigma-check"><input type="checkbox" checked={value === true} onChange={e => change(e.target.checked)} />{field.label}</label>;
  if (kind === 'rows' || kind === 'object') {
    const records: Record<string,any>[] = kind === 'object' ? [value || {}] : Array.isArray(value) ? value : [];
    return <fieldset className="enigma-nested"><legend>{field.label}</legend>{records.map((row,index) => <div key={index}>{(field.fields || []).map(child => <FieldInput key={child.name} field={child} values={row} choices={choices} change={next => {
      const updated = { ...row, [child.name]:next }; change(kind === 'object' ? updated : records.map((item,i) => i === index ? updated : item));
    }} />)}{kind === 'rows' && <button type="button" onClick={() => change(records.filter((_,i) => i !== index))}>移除此项</button>}</div>)}{kind === 'rows' && <button type="button" onClick={() => change([...records,defaults(field.fields || [])])}>＋ 添加一项</button>}</fieldset>;
  }
  return <label className="enigma-field"><span>{field.label}{field.required ? ' *' : ''}</span>
    {kind === 'select' ? <FormSelectControl label={field.label} value={value||''} onChange={change} options={[{value:'',label:'请选择'},...options]}/> : (kind === 'select' || kind === 'multi') ? <select aria-label={field.label} multiple={kind === 'multi'} required={field.required} value={kind === 'multi' ? value || [] : value || ''} onChange={e => change(kind === 'multi' ? Array.from(e.target.selectedOptions).map(option => option.value) : e.target.value)}>
      {kind !== 'multi' && <option value="">请选择</option>}{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
    : ['textarea','lines','pairs'].includes(kind) ? <textarea aria-label={field.label} required={field.required} rows={kind === 'textarea' ? 4 : 3} value={kind === 'lines' ? (value || []).join('\n') : kind === 'pairs' ? Object.entries(value || {}).map(([key,item]) => `${key}=${item}`).join('\n') : value || ''} onChange={e => change(kind === 'lines' ? e.target.value.split('\n').filter(Boolean) : kind === 'pairs' ? Object.fromEntries(e.target.value.split('\n').filter(Boolean).map(line => { const split=line.indexOf('='); return split < 0 ? [line,''] : [line.slice(0,split),line.slice(split+1)]; })) : e.target.value)} />
    : <input aria-label={field.label} type={kind === 'number' ? 'number' : 'text'} required={field.required} value={value ?? ''} onChange={e => change(kind === 'number' ? e.target.value === '' ? undefined : Number(e.target.value) : e.target.value)} />}
    {field.help && <small>{field.help}</small>}
  </label>;
}

function ApprovalDialog() {
  const sessionPath = useEngineering(s => s.sessionPath), dialogs = useEngineering(s => s.snapshot?.dialogs || EMPTY_LIST), dialog = dialogs[0];
  const [value,setValue] = useState(''), [error,setError] = useState('');
  useEffect(() => { setValue(dialog?.value || ''); setError(''); }, [dialog?.id]);
  if (!dialog) return null;
  const answer = async (confirmed: boolean) => {
    try {
      await hanaFetch(`/api/confirm/${encodeURIComponent(dialog.id)}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:confirmed ? 'confirmed' : 'rejected', value, sessionPath }) });
      await refreshEngineering(sessionPath);
    } catch (error) { setError(String(error)); }
  };
  return <Modal key={dialog.id} title={dialog.title} close={() => void answer(false)}><p>{dialog.message}</p>{dialog.kind === 'select' ? <FormSelectControl label="选择答案" value={value} onChange={setValue} options={[{value:'',label:'请选择'},...(dialog.options||[]).map((option:string)=>({value:option,label:option}))]}/> : dialog.kind !== 'confirm' && <textarea aria-label="输入答案" value={value} onChange={event => setValue(event.target.value)} />}
    {error && <p role="alert">{error}</p>}<div className="enigma-dialog-actions"><button onClick={() => void answer(false)}>拒绝</button><button className="enigma-primary" onClick={() => void answer(true)}>确认</button></div></Modal>;
}

function Modal({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input,textarea,select,button')?.focus();
    const key = (event: KeyboardEvent) => {
      if(ref.current?.querySelector('[data-select-widget-trigger][aria-expanded="true"]'))return;
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key !== 'Tab') return;
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)') || []), first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown',key);
    return () => { document.removeEventListener('keydown',key); previous?.focus(); };
  }, []);
  return <div className="enigma-modal-backdrop"><div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="enigma-modal enigma-glass" onPointerMove={pointer}><header><h2>{title}</h2><button aria-label={`关闭 ${title}`} onClick={close}>×</button></header>{children}</div></div>;
}

async function downloadArtifact(id: string) {
  const sessionPath = useEngineering.getState().sessionPath;
  const response = await hanaFetch(`/api/enigma/artifact/${encodeURIComponent(id)}?sessionPath=${encodeURIComponent(sessionPath)}`);
  const blob = await response.blob(), url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = id; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
}
