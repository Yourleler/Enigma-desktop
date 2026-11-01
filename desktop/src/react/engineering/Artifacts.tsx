import {SearchField} from '../ui/SearchField';
import { useEffect, useState, type ReactNode } from 'react';
import { hanaFetch } from '../hooks/use-hana-fetch';
import { openEngineering, showAction, useEngineering } from './state';
import { useStore } from '../stores';
import { useSideAction } from './useSideAction';
import { displayTime } from './interaction-copy';
import { MarkdownContent } from '../components/chat/MarkdownContent';
import { renderMarkdown } from '../utils/markdown';

const rasterTypes = new Set(['image/png','image/jpeg','image/gif','image/webp','image/bmp']);
const kindLabels: Record<string, string> = { document: '文档', code: '代码', report: '报告', screenshot: '截图', trace: '运行记录', package: '任务包' };
const formatBytes = (bytes:number) => bytes < 1024 ? `${bytes} 字节` : bytes < 1_048_576 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`;
export function ArtifactsPanel({value}:{value:any}) {
  const snapshot=useEngineering(s=>s.snapshot),readOnly=useStore(s=>s.sessionPermissionMode==='read_only');
  const [query,setQuery]=useState('');
  const records=[...(Array.isArray(value)?value:value.items||[])].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  const visible=records.filter(record=>`${record.title} ${kindLabels[record.kind]||record.kind}`.toLowerCase().includes(query.toLowerCase().trim()));
  const add=snapshot?.actions?.find((item:any)=>item.id==='artifact-add'),busy=snapshot?.state?.idle===false||snapshot?.state?.operation?.state==='running';
  return <section><h3>任务成果与保存的版本</h3><p className="enigma-feature-intro">查看本任务保存的报告、文档、截图和代码。打开后可以预览或下载，历史版本会保留。</p>
    {add&&<button disabled={readOnly||busy} data-tooltip={readOnly?'当前对话只读，不能登记成果':busy?'等待当前操作结束':'选择仓库文件或运行产物，保存一份可核对的版本'} onClick={()=>void showAction(add)}>登记已有成果</button>}
    {records.length>5&&<SearchField className="enigma-timeline-search" aria-label="筛选任务成果" placeholder="按名称或类型筛选" value={query} onChange={event=>setQuery(event.target.value)}/>}
    {!!value.unavailable?.length&&<div className="enigma-error" role="status"><p>{value.unavailable.length} 份成果暂不可用，其他记录仍可查看。</p>{value.unavailable.map((item:any,index:number)=><p key={item.id||index}>{item.title}：{item.reason}</p>)}</div>}
    {!records.length&&!value.unavailable?.length&&<p className="enigma-empty-feature">还没有保存成果。可以让助手登记本轮产物，或从这里选择已有文件。</p>}
    {records.length>0&&!visible.length&&<p>没有匹配的成果，请换个关键词。</p>}
    <div className="enigma-record-grid">{visible.map((record:any)=><button className="enigma-record" key={record.id} data-tooltip="查看这份成果的保存版本、原始来源和下载入口" onClick={()=>openEngineering({id:`artifact:${record.id}`,group:'artifacts',artifact:record.id,title:record.title})}>
      <span aria-hidden="true">↗</span><strong>{record.title}</strong><small>{kindLabels[record.kind]||'成果'} · {formatBytes(record.bytes)}</small><small>{displayTime(record.createdAt)}{record.sourceCurrent===false?' · 来源已变化':''}</small>
    </button>)}</div>
  </section>;
}
export async function fetchArtifactBlob(id: string, sessionPath: string, signal?: AbortSignal) {
  const controller = new AbortController(), abort = () => controller.abort();
  const timer = setTimeout(abort, 60_000);
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await hanaFetch(`/api/enigma/artifact/${encodeURIComponent(id)}?sessionPath=${encodeURIComponent(sessionPath)}`, { signal: controller.signal, throwOnHttpError: false });
    if (!response.ok) throw new Error(response.status === 403 ? '当前对话没有读取这份成果的权限。' : `读取成果失败（HTTP ${response.status}），请重试或刷新当前内容。`);
    const blob = await response.blob(); controller.signal.throwIfAborted();
    if (blob.size > 32_000_000) throw new Error('成果超过单文件读取上限，请核对来源文件。');
    return blob;
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw new Error('成果读取超时，请重试。');
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

export function ArtifactDocument({ value, evidence }: { value: any; evidence: (value: any) => ReactNode }) {
  const sessionPath = useEngineering(s => s.sessionPath), connection = useEngineering(s => s.connectionId);
  const record = value.record, preview = value.preview;
  const scope = JSON.stringify([connection,sessionPath,record.id,record.hash]);
  const imageType = preview?.kind === 'image' && rasterTypes.has(preview.mediaType) ? preview.mediaType : undefined;
  const [image, setImage] = useState({ scope, url: '', loading: false, error: '' }), [retry, setRetry] = useState(0), [zoom, setZoom] = useState(false);
  const download = useSideAction(sessionPath, `artifact:${record.id}:${record.hash}`);
  const downloadName = preview?.downloadName || `${record.id}${record.extension || ''}`;
  useEffect(() => {
    setZoom(false); const controller = new AbortController(); let url = '';
    setImage({ scope, url: '', loading: !!imageType, error: '' });
    if (imageType) void fetchArtifactBlob(record.id,sessionPath,controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      if (blob.type.split(';')[0] !== imageType) throw new Error('文件格式与预览记录不一致，请刷新当前内容。');
      url = URL.createObjectURL(blob); setImage({ scope, url, loading: true, error: '' });
    }).catch(error => { if (!controller.signal.aborted) setImage({ scope, url: '', loading: false, error: error instanceof Error ? error.message : '图片读取失败，请重试。' }); });
    return () => { controller.abort(); if(url)URL.revokeObjectURL(url); };
  }, [scope,imageType,retry]);
  const current = image.scope === scope ? image : { url: '', loading: !!imageType, error: '' };
  const save = () => download.run('download', () => fetchArtifactBlob(record.id,sessionPath), blob => {
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = downloadName; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const unsupported = preview?.kind === 'download' || !preview && !value.content;
  return <section className="enigma-document enigma-artifact">
    <div className="enigma-chips"><span>{kindLabels[record.kind] || '成果文件'}</span><span>{formatBytes(record.bytes)}</span><span>{value.sourceCurrent ? '来源未变化' : '来源已变化或不可用'}</span></div>
    <p className="enigma-source-note">保存于 {displayTime(record.createdAt)}。这里展示保存的版本，源文件变化不会覆盖它。{value.evidence?.some((item:any) => !item.current) && ' 部分验收依据已过期。'}</p>
    <div className="enigma-inline-actions"><button disabled={!!download.busy} data-tooltip={`保存原文件：${downloadName}`} onClick={() => void save()}>{download.busy ? '正在准备下载…' : '下载这个版本'}</button>
      {imageType && current.url && !current.error && <button aria-pressed={zoom} data-tooltip={zoom ? '缩放到面板宽度，查看完整图片' : '按图片原始尺寸查看细节，可在图内滚动'} onClick={() => setZoom(value => !value)}>{zoom ? '适应宽度' : '原始尺寸'}</button>}
    </div>
    {download.error && <p className="enigma-error" role="alert">下载未完成：{download.error}</p>}
    {imageType ? <>
      {current.loading && <p role="status">正在加载图片…</p>}
      {current.error && <div className="enigma-error" role="alert">{current.error}<button onClick={() => setRetry(value => value + 1)}>重试图片预览</button></div>}
      {current.url && !current.error && <div className="enigma-artifact-image" data-original={zoom} tabIndex={0} aria-label={`${record.title} 图片预览${zoom ? '，可滚动查看原图' : ''}`}><img src={current.url} alt={record.title} onLoad={() => setImage(value => value.scope === scope ? { ...value,loading:false } : value)} onError={() => setImage(value => value.scope === scope ? { ...value,loading:false,error:'无法解码这份图片，可重试或下载原文件。' } : value)} /></div>}
    </> : unsupported ? <p className="enigma-empty-feature">{preview?.reason || '当前没有可显示的正文，请下载保存的文件查看。'}</p> : record.extension?.toLowerCase() === '.md' ? <MarkdownContent html={renderMarkdown(value.content || '')}/> : <pre>{value.content || ''}</pre>}
    <details className="enigma-result"><summary>来源与验收记录</summary>{evidence({ record, sourceCurrent: value.sourceCurrent, evidence: value.evidence })}</details>
  </section>;
}
