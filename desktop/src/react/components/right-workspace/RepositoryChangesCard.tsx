import { useCallback, useEffect, useRef, useState } from 'react';
import { useChangesPanel } from '../../stores/changes-panel-store';
import { useStore } from '../../stores';
import { hanaFetch } from '../../hooks/use-hana-fetch';
import { useEngineering, rememberEngineeringView } from '../../engineering/state';
import { Changes } from '../../engineering/Changes';
import { DockIcon } from './DockIcon';
import { openPreview } from '../../stores/preview-actions';
import { AppIcon } from '../../ui/app-icons';
import styles from './RepositoryChangesCard.module.css';

type Repository = { id: string; root: string; name: string; branch: string; files: number; added: number; removed: number; untracked: number; binary: number; conflicts: number; error?: string };
const keyFor = (session: string, connection: string) => `${connection}:${session}`;

async function request(sessionPath: string, kind?: 'working'|'staged', signal?: AbortSignal) {
  const response = await hanaFetch(`/api/enigma/changes${kind ? '/read' : ''}?sessionPath=${encodeURIComponent(sessionPath)}`, {
    ...(kind ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, sessionPath }) } : {}),
    signal, timeout: kind ? 95000 : 30000, throwOnHttpError: false,
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || '无法读取代码变更');
  return value;
}

export function RepositoryChangesCard() {
  const session = useStore(s => s.currentSessionPath);
  const connection = useStore(s => s.activeServerConnectionId || 'local');
  const deskRoot = useStore(s => s.deskBasePath);
  const engineeringRoot = useEngineering(s => s.snapshot?.root);
  const [state, setState] = useState<{ key: string; repositories?: Repository[]; error?: string }>({ key: '' });
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController(), key = keyFor(session, connection);
    let pending = false;
    const load = async () => {
      if (pending || controller.signal.aborted || document.hidden) return;
      pending = true;
      try {
        const result = await request(session, undefined, controller.signal);
        if (!controller.signal.aborted) setState({ key, repositories: result.repositories });
      } catch (error) {
        if (!controller.signal.aborted) setState({ key, error: error instanceof Error ? error.message : '变更统计暂不可用' });
      } finally { pending = false; }
    };
    void load();
    const timer = setInterval(load, 8000);
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', load);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus', load); document.removeEventListener('visibilitychange', load); };
  }, [session, connection, deskRoot, engineeringRoot]);
  if (!session) return null;
  const current = state.key === keyFor(session, connection) ? state : null;
  const repositories = current?.repositories;
  const open = () => {
    useEngineering.setState({ paneOpen: false }); rememberEngineeringView();
    useChangesPanel.setState({ session, connection, open: true });
  };
  return <section className={styles.card} aria-label="代码变更">
    <div className={styles.heading}><AppIcon name="file" size={17}/><strong>代码变更</strong></div>
    {current?.error ? <p role="status">{current.error}</p> : !repositories ? <p>正在读取仓库状态…</p> : repositories.length === 0 ? <p>当前文件夹未启用 Git，可在“对话文件”查看生成的文件。</p> : repositories.map(repo => <button key={repo.id} className={styles.repo} onClick={open} aria-label={`查看 ${repo.name} 的变更`} title="打开同一版本的智能阅读与全量 diff">
      <span className={styles.repoName}>{repo.name}</span>
      {!repo.error && <span className={styles.totals}><span className={styles.added}>+{repo.added.toLocaleString()}</span><span className={styles.removed}>−{repo.removed.toLocaleString()}</span></span>}
      <span className={styles.detail}>{repo.error || `${repo.branch} · ${repo.files} 个文件${repo.untracked ? ` · ${repo.untracked} 个新文件` : ''}${repo.binary ? ` · ${repo.binary} 个非文本或大文件未计行数` : ''}${repo.conflicts ? ` · ${repo.conflicts} 个冲突` : ''}`}</span>
    </button>)}
    {!!repositories?.length && <button className={styles.open} onClick={open}>智能阅读与全量 diff <AppIcon name="chevronRight" size={14}/></button>}
  </section>;
}

export function RepositoryChangesPanel({embedded=false}:{embedded?:boolean}={}) {
  const session = useStore(s => s.currentSessionPath);
  const connection = useStore(s => s.activeServerConnectionId || 'local');
  const [kind, setKind] = useState<'working'|'staged'>('working');
  const [value, setValue] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [noRepository,setNoRepository]=useState(false);
  const generation = useRef(0), requestController = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    if (!session) return;
    const current = ++generation.current;
    requestController.current?.abort();
    const controller = new AbortController(); requestController.current = controller;
    setLoading(true); setError('');setNoRepository(false);
    try {
      const overview=await request(session,undefined,controller.signal);
      if(!overview.git){if(current===generation.current){setNoRepository(true);setValue(null);}return;}
      const data = await request(session, kind, controller.signal);
      if (current === generation.current) setValue(data);
    } catch (err) {
      if (current === generation.current && !controller.signal.aborted) setError(err instanceof Error ? err.message : '读取失败');
    } finally { if (current === generation.current) setLoading(false); }
  }, [session, connection, kind]);
  useEffect(() => {
    setValue(null); void load();
    return () => { generation.current++; requestController.current?.abort(); };
  }, [load]);
  const openSource = async (source: any) => {
    const current = generation.current;
    try {
      const params = new URLSearchParams({ sessionPath: session || '', repo: source.repo, file: source.file });
      const response = await hanaFetch(`/api/enigma/changes/source?${params}`, { throwOnHttpError: false });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '无法读取当前源码');
      if (current !== generation.current) return;
      openPreview({ id: `change-source:${connection}:${source.repo}:${source.file}`, type: 'code', title: `${source.file} · 当前源码`, content: data.content, language: source.file.split('.').pop(), ext: source.file.split('.').pop() }, { anchor: `L${source.line}` });
    } catch (err) { if (current === generation.current) setError(err instanceof Error ? err.message : '无法读取当前源码'); }
  };
  return <section className={`${styles.panel} enigma-changes-surface`} aria-label="代码变更">
    <header className="enigma-changes-heading"><DockIcon name="changes"/><div><strong>代码变更</strong><small>智能阅读与完整差异，共用同一个源码版本</small></div></header>
    {noRepository?<div className="enigma-changes-empty"><DockIcon name="changes"/><h3>这个文件夹还没有 Git 记录</h3><p>选择代码仓库后，便可查看改动、影响范围和完整差异。当前文件仍可在“文件”中阅读。</p></div>:<>
    {!embedded&&<header className={styles.header}><button onClick={() => useChangesPanel.setState({ open: false })}><AppIcon name="chevronLeft" size={16}/>返回工作台</button><strong>变更与阅读</strong></header>}
    <div className={styles.source}><label>查看范围 <select value={kind} onChange={event => setKind(event.target.value as 'working'|'staged')}><option value="working">全部未提交改动</option><option value="staged">已暂存的改动</option></select></label><small>包含当前仓库的全部改动，不只属于这个对话。</small></div>
    {loading && <p className={styles.progress} role="status">正在保存同一版本的差异并分析源码关系…<button onClick={() => { generation.current++; requestController.current?.abort(); setLoading(false); }}>取消</button></p>}
    {error && <div className={styles.error} role="alert">{error}<button onClick={() => void load()}>重试</button></div>}
    {value ? <Changes value={value} files={null} standalone={{ refresh: () => void load(), loading, openSource }}/> : !loading && !error && <button onClick={() => void load()}>读取当前变更</button>}
    </>}
  </section>;
}
