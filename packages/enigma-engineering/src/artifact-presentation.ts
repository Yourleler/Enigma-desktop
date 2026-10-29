import type { ArtifactRecord } from './artifacts.js';

export function artifactDownloadName(record: ArtifactRecord) {
  const origin = record.origin.file || record.origin.runtime || '';
  const name = origin.split(/[\\/]/).at(-1)?.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').trim();
  const extension = /^\.[a-z0-9]{1,16}$/i.test(record.extension) ? record.extension : '';
  return name && name !== '.' && name !== '..' ? name.endsWith(extension) && extension ? name.slice(0,-extension.length).slice(0,180-extension.length)+extension : name.slice(0,180) : `${record.id}${extension}`;
}

/** Detect raster bytes, not the user-supplied artifact kind or filename. HTML,
 * SVG and unknown binary files are never embedded as active documents. */
export function artifactPresentation(record: ArtifactRecord, bytes: Uint8Array) {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), first = data.subarray(0, 16);
  const imageType = first.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
    : first[0] === 255 && first[1] === 216 && first[2] === 255 ? 'image/jpeg'
    : ['GIF87a', 'GIF89a'].includes(first.toString('ascii', 0, 6)) ? 'image/gif'
    : first.toString('ascii', 0, 4) === 'RIFF' && first.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp'
    : first.toString('ascii', 0, 2) === 'BM' ? 'image/bmp' : undefined;
  const downloadName = artifactDownloadName(record);
  if (imageType) return { kind: 'image' as const, mediaType: imageType, downloadName };
  if (['document','code','report','trace'].includes(record.kind) && data.length <= 1_048_576 && !data.includes(0)) {
    try { return { kind: 'text' as const, mediaType: 'text/plain; charset=utf-8', downloadName, content: new TextDecoder('utf-8', { fatal: true }).decode(data) }; }
    catch { /* Non-UTF-8 results remain downloadable with original bytes. */ }
  }
  return { kind: 'download' as const, mediaType: first.toString('ascii', 0, 5) === '%PDF-' ? 'application/pdf' : 'application/octet-stream', downloadName,
    reason: data.length > 1_048_576 ? '文件超过文本预览大小，可下载完整版本查看。' : record.kind === 'screenshot' ? '这份文件不是可内嵌预览的 PNG、JPEG、GIF、WebP 或 BMP 图片，可下载原文件查看。' : '此格式暂不支持内嵌预览，可下载完整版本查看。' };
}

export function artifactContentDisposition(record: ArtifactRecord) {
  const extension = /^\.[a-z0-9]{1,16}$/i.test(record.extension) ? record.extension : '';
  const encoded = encodeURIComponent(artifactDownloadName(record)).replace(/['()*]/g, value => `%${value.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${record.id}${extension}"; filename*=UTF-8''${encoded}`;
}
