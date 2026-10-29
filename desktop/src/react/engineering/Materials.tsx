import type { ReactNode } from 'react';
import { useStore } from '../stores';
import { openEngineering, openGroup, readRecordAction, showRecordAction, useEngineering } from './state';
import { useSideAction } from './useSideAction';
import { displayTime } from './interaction-copy';
import { MarkdownContent } from '../components/chat/MarkdownContent';
import { renderMarkdown } from '../utils/markdown';

function sourceLabel(source: any) {
  return source?.kind === 'file' ? '仓库文件' : source?.kind === 'note' ? '项目笔记' : source?.capture?.provider === 'lark' ? '飞书资料' : '网页资料';
}
function freshness(value: any) {
  return value.current === false ? '来源已变化，请更新资料' : value.current === true ? '当前版本有效' : '远端来源尚未重新核对';
}
const scopeLabels: Record<string, string> = { full: '完整正文', outline: '仅目录', keyword: '关键词片段', section: '指定章节', range: '指定区间' };
export function MaterialsPanel({ value }: { value: any }) {
  const items = Array.isArray(value) ? value : value?.items || [], query = value?.query?.trim();
  return <section>
    <h3>任务的参考资料</h3>
    <p className="enigma-feature-intro">保存需求、接口说明或背景笔记，供阅读和交接时引用。资料中的文字作为参考，不会替代你给助手的要求。</p>
    <p className="enigma-source-note">{value?.truncated ? `显示前 ${items.length} / ${value.totalMatches || '更多'} 份匹配资料；可用上方关键词缩小范围。` : `${items.length} 份${query ? '匹配' : '可见'}资料`} · 仅此任务的资料不会显示在其他任务中。</p>
    {!items.length && <div className="enigma-empty-feature"><h3>{query ? '没有找到匹配的资料' : '让背景资料跟着任务走'}</h3><p>{query ? '试试其他关键词，或清空查询查看全部可见资料。' : '从上方“可用操作”添加项目笔记、关联仓库文件，或获取网页与飞书内容。'}</p></div>}
    <div className="enigma-record-grid">{items.map((item: any) => {
      const resource = item.resource || item;
      return <button className="enigma-record" key={resource.id} data-tooltip="打开保存的资料正文，查看来源、适用范围和版本状态" onClick={() => openEngineering({ id: `resource:${resource.id}`, group: 'materials', resource: resource.id, title: resource.title })}>
        <span aria-hidden="true">▤</span><strong>{resource.title}</strong>
        <small>{sourceLabel(resource.source)} · 修订 {resource.revision} · {resource.task ? '仅此任务' : '项目共享'}</small>
        <small>{freshness(item)}{resource.source?.capture?.scope && ` · ${scopeLabels[resource.source.capture.scope] || '部分来源'}`}</small>
      </button>;
    })}</div>
  </section>;
}

export function MaterialDocument({ value, evidence }: { value: any; evidence: (value: any) => ReactNode }) {
  const snapshot = useEngineering(s => s.snapshot), sessionPath = useEngineering(s => s.sessionPath);
  const action = useSideAction(sessionPath), readOnly = useStore(s => s.sessionPermissionMode === 'read_only');
  const resource = value.resource, source = resource.source, capture = source.capture;
  const busy = !!action.busy || snapshot?.state?.idle === false || snapshot?.state?.operation?.state === 'running';
  const has = (id: string) => snapshot?.actions?.some((item: any) => item.id === id);
  return <section className="enigma-document">
    <button data-tooltip="返回可搜索的资料列表" onClick={() => openGroup('materials')}>返回资料列表</button>
    <div className="enigma-chips"><span>{sourceLabel(source)}</span><span>修订 {resource.revision}</span><span>{resource.task ? '仅此任务' : '项目共享'}</span><span>{freshness(value)}</span></div>
    <p className="enigma-source-note">保存于 {displayTime(resource.createdAt)}。{source.kind === 'note' ? '这是手动添加的笔记，没有自动刷新的外部来源。' : '下方是保存时的正文；点击右上角刷新只重新读取本地记录。更新来源请用下方按钮。'}</p>
    {source.kind === 'file' && <p>来源文件：<button data-tooltip="读取仓库文件当前内容，与保存的资料对照" onClick={() => openEngineering({ id: `file:${source.repo}:${source.file}`, group: 'reading', repo: source.repo, file: source.file, title: source.file })}>{source.repo} / {source.file}</button></p>}
    {source.kind === 'imported' && <p>来源：<a href={source.uri} target="_blank" rel="noreferrer">{source.uri}</a></p>}
    {capture && <p className="enigma-source-note">获取范围：{scopeLabels[capture.scope] || capture.scope}。{capture.scope !== 'full' && '当前只保存局部内容，不能视为完整文档。'}{capture.selector?.keyword && ` 关键词：${capture.selector.keyword}`}</p>}
    <div className="enigma-inline-actions">
      {source.kind !== 'note' && has('material-refresh') && <button disabled={readOnly || busy} data-tooltip={readOnly ? '当前对话只读，不能更新资料' : '重新读取原文件或远端内容，保存新修订；关联旧来源的证据可能失效'} onClick={() => void showRecordAction('material-refresh', { id: resource.id }, { id: resource.title })}>从来源更新资料</button>}
      {capture && has('material-raw') && <button disabled={busy} data-tooltip="只读取保存的原始响应，不会向远端重新请求" onClick={() => void action.run('raw', () => readRecordAction('material-raw', { id: resource.id }))}>查看原始获取记录</button>}
      {has('material-remove') && <button disabled={readOnly || busy} data-tooltip={readOnly ? '当前对话只读，不能移除资料' : '确认后停止在未来任务上下文中使用这份资料，原文件和原网页保留'} onClick={() => void showRecordAction('material-remove', { id: resource.id }, { id: resource.title })}>移除这份资料</button>}
    </div>
    {action.error && <p className="enigma-error" role="alert">{action.error}</p>}
    <MarkdownContent html={renderMarkdown(value.content || '')} />
    <details className="enigma-result"><summary>来源、版本与适用范围</summary>{evidence(resource)}</details>
  </section>;
}
