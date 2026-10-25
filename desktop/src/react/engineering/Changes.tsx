import { useState } from 'react';
import { useEngineering, showAction, openEngineering } from './state';

export function Changes({ value, files }: { value: any; files: React.ReactNode }) {
  const [view, setView] = useState<'diff' | 'smart' | 'files'>('smart');
  const [selected, setSelected] = useState('');
  const state = useEngineering(), publication = value?.changeReading, record = publication?.record;
  const changes = record?.changes || [], reading = record?.reading;
  const file = changes.find((file: any) => `${file.repo}:${file.file}` === selected) || changes[0];
  const start = () => {
    const action = state.snapshot?.actions?.find((item: any) => item.id === 'changes-build');
    if (action) void showAction(action);
  };
  return <div className="enigma-changes">
    <div className="enigma-change-toolbar">
      <div className="enigma-view-tabs" role="tablist" aria-label="变更阅读方式">
        <button role="tab" aria-selected={view === 'diff'} onClick={() => setView('diff')}>全量 diff</button>
        <button role="tab" aria-selected={view === 'smart'} onClick={() => setView('smart')}>智能阅读</button>
        <button role="tab" aria-selected={view === 'files'} onClick={() => setView('files')}>项目文件</button>
      </div>
      <button className="enigma-primary" onClick={start}>生成阅读</button>
      <details className="enigma-more"><summary>阅读工具</summary><div className="enigma-action-menu enigma-glass">{(state.snapshot?.actions||[]).filter((action:any)=>action.group==='reading'&&action.id!=='changes-build').map((action:any)=><button key={action.id} onClick={()=>void showAction(action)}>{action.title}<small>{action.description}</small></button>)}</div></details>
    </div>
    {view === 'files' ? files : !record ? <div className="enigma-welcome-card"><span className="enigma-feature-icon">⌘</span><h3>把代码变更读成一条清楚的路线</h3><p>暂存、提交或 MR 产生后，Agent 可以生成同版本的全量 diff 和智能阅读。按职责与行为展开，也可直接核对每一处源码。</p><button className="enigma-primary" onClick={start}>选择变更来源</button></div> : <>
      <div className="enigma-version-line"><span>{({ working:'工作区变更', staged:'暂存变更', commit:'提交变更', 'merge-request':'MR / PR 变更' } as any)[record.input.kind]}</span><span>{changes.length} 个文件</span><span>版本 {record.version.slice(0, 10)}</span><span data-current={publication.matchesWorkspace}>{publication.matchesWorkspace ? '与当前源码一致' : '固定历史版本 · 当前源码不同'}</span></div>
      {record.status !== 'ready' && <div className="enigma-empty">{record.status === 'reading' ? '正在生成有源码依据的阅读…' : record.error || '已保存全量 diff，智能阅读尚未完成'}</div>}
      {view === 'diff' ? <div className="enigma-diff-layout"><nav aria-label="变更文件">{changes.map((item: any) => <button key={`${item.repo}:${item.file}`} data-active={file === item} onClick={() => setSelected(`${item.repo}:${item.file}`)}><span>{item.change === 'added' ? '+' : item.change === 'deleted' ? '−' : 'M'}</span><div><strong>{item.file.split('/').pop()}</strong><small>{item.repo} / {item.file}</small></div></button>)}</nav>
        {file && <section className="enigma-diff-document"><header><strong>{file.repo} / {file.file}</strong><small>此处显示保存版本，后续编辑不会改写它</small></header><pre>{(file.patch || file.after?.omitted || file.before?.omitted || '只有文件模式发生变化').split('\n').map((line: string,index: number) => <span key={index} className={line.startsWith('+') ? 'enigma-diff-add' : line.startsWith('-') ? 'enigma-diff-delete' : line.startsWith('@@') ? 'enigma-diff-range' : ''}>{line || ' '} {'\n'}</span>)}</pre></section>}
      </div> : reading && <div className="enigma-smart-reading"><div className="enigma-reading-intro"><h3>{record.input.goal}</h3><p>先看这次行为变化，再沿源码关系阅读。说明是分析结果，验收仍以原检查为准。</p></div>
        {(reading.chapters || []).map((chapter: any,index: number) => <details className="enigma-reading-chapter" key={chapter.id} open={index === 0}><summary><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{chapter.title}</strong><small>{chapter.nodes.length} 个源码锚点</small></div><span>⌄</span></summary><p>{chapter.summary}</p>
          {chapter.nodes.map((id: string) => reading.nodes.find((node: any) => node.id === id)).filter(Boolean).map((node: any) => <details className="enigma-source-anchor" key={node.id}><summary><span>{node.source.repo} / {node.source.file}:{node.source.line}</span><strong>{node.source.symbol}</strong></summary><pre>{node.source.snippet}</pre><button onClick={() => openEngineering({ id:`file:${node.source.repo}:${node.source.file}`,title:node.source.file.split('/').pop(),group:'reading',repo:node.source.repo,file:node.source.file })}>打开当前源码</button><small>上方片段来自固定版本；当前源码可能不同</small></details>)}
        </details>)}
        {reading.insights?.length > 0 && <section><h3>变更解释与待核对项</h3>{reading.insights.map((insight: any,index: number) => <article className="enigma-insight" key={index}><strong>{insight.title}</strong><p>{insight.text}</p><small>{insight.anchors.length} 个来源 · 模型分析</small></article>)}</section>}
        <details className="enigma-reading-chapter"><summary><strong>跨仓关系与阅读缺口</strong></summary>{reading.architecture.map((item: any) => <p key={item.repo}><strong>{item.repo}</strong> · {item.responsibility || '职责待补充'}{item.dependsOn.length ? ` · 依赖 ${item.dependsOn.join('、')}` : ''}</p>)}{record.gaps.map((gap: string,index: number) => <p key={index}>{gap}</p>)}</details>
      </div>}
    </>}
  </div>;
}
